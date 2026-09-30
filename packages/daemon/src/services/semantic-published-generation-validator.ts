import type {
  Collection,
  SemanticRedundancyGeneration,
  SemanticSourceIdentity,
} from "@shelf-judge/shared";
import { redundancyPairKey } from "./redundancy-engine.js";
import {
  semanticDescriptionSourceFingerprint,
  semanticOwnerNoteSourceFingerprint,
} from "./semantic-redundancy-state-service.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";

export interface PublishedGenerationValidationOptions {
  collection: Collection;
  generation: SemanticRedundancyGeneration;
  modelId: string;
  rubricVersion: number;
  scoringVersion: number;
  /** Optional captured identity/universe fences used by the scored resolver. */
  sourceIdentity?: SemanticSourceIdentity;
  expectedSourceIdentity?: SemanticSourceIdentity;
  eligibleGameIds?: readonly string[];
}

/** Pure validation of immutable publication data against current collection facts. */
export function isPublishedGenerationCurrent({
  collection,
  generation,
  modelId,
  rubricVersion,
  scoringVersion,
  sourceIdentity,
  expectedSourceIdentity,
  eligibleGameIds,
}: PublishedGenerationValidationOptions): boolean {
  const state = collection.semanticRedundancy;
  const { weights } = generation;
  const configured = state.settings.weights;
  const ids = [...generation.eligibleGameIds];
  if (
    !state.settings.enabled ||
    !generation.id ||
    !generation.manifestDigest ||
    !Number.isFinite(Date.parse(generation.publishedAt)) ||
    generation.modelId !== modelId ||
    generation.rubricVersion !== rubricVersion ||
    generation.scoringVersion !== scoringVersion ||
    generation.evidenceEpoch !== state.evidenceEpoch ||
    generation.consentEpoch !== state.consentEpoch ||
    generation.sourceIdentity.collectionId !== collection.id ||
    generation.sourceIdentity.collectionSchemaVersion !== collection.schemaVersion ||
    generation.sourceIdentity.evidenceEpoch !== state.evidenceEpoch ||
    generation.sourceIdentity.consentEpoch !== state.consentEpoch ||
    (generation.weights.description > 0 && generation.signalScope === "owner-notes-only") ||
    ![weights.factual, weights.description, weights.ownerNote].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) ||
    (weights.factual <= 0 && weights.description <= 0 && weights.ownerNote <= 0) ||
    weights.factual !== configured.factual ||
    weights.description !== configured.description ||
    weights.ownerNote !== configured.ownerNote ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || id.length === 0)
  )
    return false;

  if (eligibleGameIds) {
    const current = [...eligibleGameIds].sort();
    const published = [...ids].sort();
    if (current.length !== published.length || current.some((id, i) => id !== published[i]))
      return false;
  }
  if (sourceIdentity && !sameIdentity(generation.sourceIdentity, sourceIdentity)) return false;
  if (expectedSourceIdentity && !sameIdentity(generation.sourceIdentity, expectedSourceIdentity))
    return false;

  const ordered = [...ids].sort();
  const expected = new Set<string>();
  for (let i = 0; i < ordered.length; i++)
    for (let j = i + 1; j < ordered.length; j++)
      expected.add(redundancyPairKey(ordered[i], ordered[j]));
  if (generation.pairOutcomes.length !== expected.size) return false;
  const games = new Map(collection.games.map((game) => [game.id, game]));
  const actual = new Set<string>();
  for (const outcome of generation.pairOutcomes) {
    const key = redundancyPairKey(outcome.gameA, outcome.gameB);
    if (outcome.gameA >= outcome.gameB || !expected.has(key) || actual.has(key)) return false;
    const a = games.get(outcome.gameA);
    const b = games.get(outcome.gameB);
    if (!a || !b || (weights.ownerNote > 0 && outcome.ownerNote === null)) return false;
    if (
      weights.ownerNote > 0 &&
      a.ownerNote.state === "present" &&
      b.ownerNote.state === "present" &&
      !state.settings.cachedOwnerNoteUse
    )
      return false;
    for (const [signal, description] of [
      [outcome.description, true],
      [outcome.ownerNote, false],
    ] as const) {
      const enabled = description ? weights.description > 0 : weights.ownerNote > 0;
      if (!enabled) {
        if (signal !== null) return false;
        continue;
      }
      if (!signal) return false;
      if (signal.modelId !== modelId || signal.rubricVersion !== rubricVersion) return false;
      const fpA = description
        ? semanticDescriptionSourceFingerprint(a)
        : semanticOwnerNoteSourceFingerprint(a);
      const fpB = description
        ? semanticDescriptionSourceFingerprint(b)
        : semanticOwnerNoteSourceFingerprint(b);
      const missing = (gameId: string) =>
        canonicalSha256({
          manifestDigest: generation.manifestDigest,
          gameId,
          signal: description ? "C" : "D",
          status: "missing-source",
        });
      const expectedA =
        fpA ??
        (signal.status === "unavailable" && signal.reason === "missing-source"
          ? missing(a.id)
          : null);
      const expectedB =
        fpB ??
        (signal.status === "unavailable" && signal.reason === "missing-source"
          ? missing(b.id)
          : null);
      if (
        expectedA === null ||
        expectedB === null ||
        signal.sourceFingerprintA !== expectedA ||
        signal.sourceFingerprintB !== expectedB
      )
        return false;
      if (signal.status === "unavailable") {
        if (signal.reason !== "missing-source" && signal.reason !== "insufficient-evidence")
          return false;
        if (signal.reason === "missing-source" && fpA !== null && fpB !== null) return false;
        if (signal.reason === "insufficient-evidence" && (!fpA || !fpB)) return false;
        continue;
      }
      if (!Number.isFinite(signal.score) || signal.score < 0 || signal.score > 1) return false;
      if (signal.requestContext.kind === "description-only") {
        if (!description || signal.noteVersionA !== null || signal.noteVersionB !== null)
          return false;
      } else if (signal.requestContext.kind === "owner-notes-only") {
        if (description || !state.settings.cachedOwnerNoteUse) return false;
      } else {
        if (
          !state.settings.cachedOwnerNoteUse ||
          a.ownerNote.state !== "present" ||
          b.ownerNote.state !== "present" ||
          a.ownerNote.version <= 0 ||
          b.ownerNote.version <= 0 ||
          signal.noteVersionA !== a.ownerNote.version ||
          signal.noteVersionB !== b.ownerNote.version ||
          signal.requestContext.descriptionFingerprintA !==
            semanticDescriptionSourceFingerprint(a) ||
          signal.requestContext.descriptionFingerprintB !== semanticDescriptionSourceFingerprint(b)
        )
          return false;
      }
      if (
        !description &&
        (a.ownerNote.state !== "present" ||
          b.ownerNote.state !== "present" ||
          a.ownerNote.version <= 0 ||
          signal.noteVersionA !== a.ownerNote.version ||
          signal.noteVersionB !== b.ownerNote.version)
      )
        return false;
    }
    actual.add(key);
  }
  return actual.size === expected.size;
}

function sameIdentity(a: SemanticSourceIdentity, b: SemanticSourceIdentity): boolean {
  return (
    a.collectionId === b.collectionId &&
    a.collectionSchemaVersion === b.collectionSchemaVersion &&
    a.collectionRevision === b.collectionRevision &&
    a.evidenceEpoch === b.evidenceEpoch &&
    a.consentEpoch === b.consentEpoch &&
    a.factualWeightsEpoch === b.factualWeightsEpoch &&
    a.factualWeightsFingerprint === b.factualWeightsFingerprint &&
    a.tournamentHash === b.tournamentHash &&
    a.predictionSettingsHash === b.predictionSettingsHash &&
    a.redundancySettingsHash === b.redundancySettingsHash
  );
}
