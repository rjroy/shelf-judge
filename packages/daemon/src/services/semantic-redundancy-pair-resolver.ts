import type {
  Collection,
  GameWithScore,
  SemanticRedundancyGeneration,
  SemanticPublishedSignalJudgment,
  SemanticSourceIdentity,
} from "@shelf-judge/shared";
import type { RedundancySettings } from "@shelf-judge/shared";
import type { RedundancyPairTable, RedundancySimilarityStatus } from "./redundancy-engine.js";
import { redundancyPairKey } from "./redundancy-engine.js";
import { createRedundancyFactualContext } from "./redundancy-factual.js";
import {
  semanticDescriptionSourceFingerprint,
  semanticOwnerNoteSourceFingerprint,
} from "./semantic-redundancy-state-service.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import type { SemanticGenerationSourceIdentity } from "./source-vector.js";
import { isPublishedGenerationCurrent } from "./semantic-published-generation-validator.js";

export interface SemanticRedundancyPairResolverSupport {
  modelId: string;
  rubricVersion: number;
  scoringVersion: number;
  /** Current captured tournament/prediction/factual settings identity. */
  sourceIdentity: SemanticSourceIdentity;
}

export interface SemanticRedundancyPairResolverInput {
  /** One already validated capture; the resolver performs no storage or provider I/O. */
  collection: Collection;
  sourceIdentity: SemanticGenerationSourceIdentity;
  factualSettings: RedundancySettings;
  /** Complete scored eligible owned universe before redundancy adjustments. */
  universe: readonly GameWithScore[];
  generation: SemanticRedundancyGeneration | null;
  support: SemanticRedundancyPairResolverSupport;
}

const unavailableIdentity = {
  generationId: "",
  consentEpoch: "",
  settingsEpoch: "",
};

function fallback(
  status: Extract<RedundancySimilarityStatus, "factual" | "not-ready" | "stale">,
  weights: SemanticRedundancyGeneration["weights"],
): RedundancyPairTable {
  return {
    status,
    identity: unavailableIdentity,
    expectedIdentity: unavailableIdentity,
    weights,
    pairs: [],
  };
}

function sameSource(
  generationSource: SemanticSourceIdentity,
  expected: SemanticSourceIdentity,
  durable: SemanticGenerationSourceIdentity,
): boolean {
  return (
    generationSource.collectionId === durable.collectionId &&
    generationSource.collectionSchemaVersion === durable.collectionSchemaVersion &&
    generationSource.evidenceEpoch === durable.evidenceEpoch &&
    generationSource.consentEpoch === durable.consentEpoch &&
    generationSource.factualWeightsEpoch === durable.factualWeightsEpoch &&
    generationSource.factualWeightsFingerprint === durable.fencedFactualWeightsFingerprint &&
    generationSource.collectionId === expected.collectionId &&
    generationSource.collectionSchemaVersion === expected.collectionSchemaVersion &&
    generationSource.evidenceEpoch === expected.evidenceEpoch &&
    generationSource.consentEpoch === expected.consentEpoch &&
    generationSource.factualWeightsEpoch === expected.factualWeightsEpoch &&
    generationSource.factualWeightsFingerprint === expected.factualWeightsFingerprint &&
    generationSource.tournamentHash === expected.tournamentHash &&
    generationSource.predictionSettingsHash === expected.predictionSettingsHash &&
    generationSource.redundancySettingsHash === expected.redundancySettingsHash
  );
}

function validWeights(
  weights: SemanticRedundancyGeneration["weights"],
  settings: Collection["semanticRedundancy"]["settings"]["weights"],
): boolean {
  const values = [weights.factual, weights.description, weights.ownerNote];
  return (
    values.every((value) => Number.isFinite(value) && value >= 0) &&
    values.some((value) => value > 0) &&
    weights.factual === settings.factual &&
    weights.description === settings.description &&
    weights.ownerNote === settings.ownerNote
  );
}

function currentSignal(
  signal: SemanticPublishedSignalJudgment,
  a: Collection["games"][number],
  b: Collection["games"][number],
  modelId: string,
  rubricVersion: number,
  description: boolean,
  manifestDigest: string,
): number | null | undefined {
  if (signal.modelId !== modelId || signal.rubricVersion !== rubricVersion) return undefined;
  const fpA = description
    ? semanticDescriptionSourceFingerprint(a)
    : semanticOwnerNoteSourceFingerprint(a);
  const fpB = description
    ? semanticDescriptionSourceFingerprint(b)
    : semanticOwnerNoteSourceFingerprint(b);
  const missingFingerprint = (gameId: string) =>
    canonicalSha256({
      manifestDigest,
      gameId,
      signal: description ? "C" : "D",
      status: "missing-source",
    });
  if (signal.status === "unavailable" && signal.reason === "missing-source") {
    const expectedA = fpA ?? missingFingerprint(a.id);
    const expectedB = fpB ?? missingFingerprint(b.id);
    if (signal.sourceFingerprintA !== expectedA || signal.sourceFingerprintB !== expectedB)
      return undefined;
    return null;
  }
  if (
    fpA === null ||
    fpB === null ||
    signal.sourceFingerprintA !== fpA ||
    signal.sourceFingerprintB !== fpB
  )
    return undefined;
  if (signal.status === "scored") {
    if (!Number.isFinite(signal.score) || signal.score < 0 || signal.score > 1) return undefined;
    if (signal.requestContext.kind === "description-and-owner-notes") {
      if (
        a.ownerNote.state !== "present" ||
        b.ownerNote.state !== "present" ||
        a.ownerNote.version <= 0 ||
        b.ownerNote.version <= 0 ||
        signal.noteVersionA !== a.ownerNote.version ||
        signal.noteVersionB !== b.ownerNote.version
      )
        return undefined;
    }
    if (description) {
      if (signal.requestContext.kind === "description-only") {
        if (signal.noteVersionA !== null || signal.noteVersionB !== null) return undefined;
      } else if (
        signal.requestContext.kind !== "description-and-owner-notes" ||
        signal.requestContext.descriptionFingerprintA !== fpA ||
        signal.requestContext.descriptionFingerprintB !== fpB
      )
        return undefined;
    } else {
      if (
        a.ownerNote.state !== "present" ||
        b.ownerNote.state !== "present" ||
        a.ownerNote.version <= 0
      )
        return undefined;
      if (
        signal.requestContext.kind !== "owner-notes-only" &&
        (signal.requestContext.kind !== "description-and-owner-notes" ||
          signal.requestContext.descriptionFingerprintA !==
            semanticDescriptionSourceFingerprint(a) ||
          signal.requestContext.descriptionFingerprintB !== semanticDescriptionSourceFingerprint(b))
      )
        return undefined;
    }
    return signal.score;
  }
  // An unavailable outcome is terminal only for a currently present source pair and
  // carries no score. Keep it as null (rather than imputing a similarity).
  return signal.status === "unavailable" && signal.reason === "insufficient-evidence"
    ? null
    : undefined;
}

/** Build a pure pair table from a captured collection and immutable publication. */
export function resolveSemanticRedundancyPairTable(
  input: SemanticRedundancyPairResolverInput,
): RedundancyPairTable {
  const { collection, universe, generation, support, sourceIdentity } = input;
  const settings = collection.semanticRedundancy.settings;
  const weights = generation?.weights ?? settings.weights;
  const factualOnly = () => fallback(settings.enabled ? "factual" : "not-ready", weights);
  if (!settings.enabled) return factualOnly();
  if (!generation) return fallback("not-ready", weights);
  const stale = () => fallback("stale", generation.weights);

  const eligibleIds = universe.map(({ game }) => game.id);
  if (
    !isPublishedGenerationCurrent({
      collection,
      generation,
      modelId: support.modelId,
      rubricVersion: support.rubricVersion,
      scoringVersion: support.scoringVersion,
      expectedSourceIdentity: support.sourceIdentity,
      eligibleGameIds: eligibleIds,
    })
  )
    return stale();

  if (
    generation.id.length === 0 ||
    generation.evidenceEpoch !== sourceIdentity.evidenceEpoch ||
    generation.consentEpoch !== sourceIdentity.consentEpoch ||
    sourceIdentity.consentEpoch !== collection.semanticRedundancy.consentEpoch ||
    sourceIdentity.evidenceEpoch !== collection.semanticRedundancy.evidenceEpoch ||
    sourceIdentity.collectionId !== collection.id ||
    sourceIdentity.collectionSchemaVersion !== collection.schemaVersion ||
    generation.modelId !== support.modelId ||
    generation.rubricVersion !== support.rubricVersion ||
    generation.scoringVersion !== support.scoringVersion ||
    generation.manifestDigest.length === 0 ||
    !Number.isFinite(Date.parse(generation.publishedAt)) ||
    !settings.enabled ||
    !validWeights(generation.weights, settings.weights) ||
    !sameSource(generation.sourceIdentity, support.sourceIdentity, sourceIdentity) ||
    (generation.weights.description > 0 && generation.signalScope === "owner-notes-only")
  )
    return stale();

  const ids = universe.map(({ game }) => game.id);
  if (
    new Set(ids).size !== ids.length ||
    universe.some(
      ({ game, score }) =>
        game.ownership === "previously-owned" || score === null || score.vetoed || score.score <= 0,
    )
  )
    return stale();
  const orderedIds = [...ids].sort();
  const expected = new Set<string>();
  for (let i = 0; i < orderedIds.length; i += 1) {
    for (let j = i + 1; j < orderedIds.length; j += 1) {
      expected.add(redundancyPairKey(orderedIds[i], orderedIds[j]));
    }
  }
  if (generation.pairOutcomes.length !== expected.size) return stale();

  const byId = new Map(collection.games.map((game) => [game.id, game]));
  const outcomes = new Map<string, SemanticRedundancyGeneration["pairOutcomes"][number]>();
  for (const outcome of generation.pairOutcomes) {
    const key = redundancyPairKey(outcome.gameA, outcome.gameB);
    if (outcome.gameA >= outcome.gameB || !expected.has(key) || outcomes.has(key)) return stale();
    outcomes.set(key, outcome);
  }
  if (outcomes.size !== expected.size) return stale();

  const factual = createRedundancyFactualContext(
    collection.games,
    input.factualSettings.componentWeights,
  );
  const gamesById = new Map(universe.map(({ game }) => [game.id, game]));
  const pairs: RedundancyPairTable["pairs"] = [];
  for (const key of expected) {
    const outcome = outcomes.get(key)!;
    const a = byId.get(outcome.gameA);
    const b = byId.get(outcome.gameB);
    const universeA = gamesById.get(outcome.gameA);
    const universeB = gamesById.get(outcome.gameB);
    if (!a || !b || !universeA || !universeB) return stale();
    if (generation.weights.ownerNote > 0 && outcome.ownerNote === null) return stale();
    if (
      generation.weights.ownerNote > 0 &&
      a.ownerNote.state === "present" &&
      b.ownerNote.state === "present" &&
      !settings.cachedOwnerNoteUse
    )
      return stale();
    const description =
      generation.weights.description > 0 && outcome.description !== null
        ? currentSignal(
            outcome.description,
            a,
            b,
            generation.modelId,
            generation.rubricVersion,
            true,
            generation.manifestDigest,
          )
        : null;
    const ownerNote =
      generation.weights.ownerNote > 0 && outcome.ownerNote !== null
        ? currentSignal(
            outcome.ownerNote,
            a,
            b,
            generation.modelId,
            generation.rubricVersion,
            false,
            generation.manifestDigest,
          )
        : null;
    if (description === undefined || ownerNote === undefined) return stale();
    pairs.push({
      gameAId: outcome.gameA,
      gameBId: outcome.gameB,
      factual: factual.similarity(universeA, universeB),
      ...(generation.weights.description > 0 ? { description } : {}),
      ...(generation.weights.ownerNote > 0 ? { ownerNote } : {}),
    });
  }

  const identity = {
    generationId: generation.id,
    consentEpoch: String(generation.consentEpoch),
    settingsEpoch: String(sourceIdentity.factualWeightsEpoch),
  };
  return {
    status: "ready",
    identity,
    expectedIdentity: identity,
    weights: generation.weights,
    pairs,
  };
}
