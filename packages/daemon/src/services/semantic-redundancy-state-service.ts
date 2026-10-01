import {
  SemanticRedundancyStateSchema,
  type Collection,
  type SemanticRedundancySettings,
} from "@shelf-judge/shared";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import type {
  CollectionMutationDecision,
  CollectionMutationContext,
  CollectionMutationService,
} from "./collection-mutation-service.js";

export interface SemanticEpochIdentity {
  evidenceEpoch: number;
  consentEpoch: number;
}

export type SemanticStateMutationResult<Value> =
  | { outcome: "accepted"; value: Value; current: SemanticEpochIdentity }
  | { outcome: "stale"; current: SemanticEpochIdentity }
  | { outcome: "not-authorized" }
  | { outcome: "invalid-state" };

/** Clear deprecated v9 semantic results and in-flight state before canonical edits validate. */
function discardLegacySemanticPayload(collection: Collection): void {
  const state = collection.semanticRedundancy;
  state.disclosure = null;
  state.disclosureManifest = null;
  state.manifestDelivery = null;
  state.execution = null;
  state.authorization = null;
  state.pairJudgments = [];
  state.publishedGeneration = null;
}

function axisEvidence(axis: Collection["axes"][number]): Record<string, unknown> {
  const {
    id,
    weight,
    enabled,
    source,
    derivedField,
    configuration,
    preferenceShape,
    idealValue,
    tolerance,
    toleranceWidth,
    leanDirection,
    veto,
    legacyField,
    reason,
  } = axis as Collection["axes"][number] & Record<string, unknown>;
  return Object.fromEntries(
    Object.entries({
      id,
      weight,
      enabled,
      source,
      derivedField,
      configuration,
      preferenceShape,
      idealValue,
      tolerance,
      toleranceWidth,
      leanDirection,
      veto,
      legacyField,
      reason,
    }).filter(([, value]) => value !== undefined),
  );
}

function evidenceRecord(value: {
  status: string;
  source?: string;
  observedAt?: string | null;
}): unknown {
  const { observedAt, ...evidence } = value;
  void observedAt;
  return evidence;
}

function amountEvidence(value: { hundredths: number; source: string }): unknown {
  return { hundredths: value.hundredths, source: value.source };
}

function benchmarkEvidence(collection: Collection): unknown {
  const benchmark = collection.entertainmentBenchmark;
  if (benchmark === null) return null;
  return benchmark.state === "configured"
    ? { state: benchmark.state, amount: amountEvidence(benchmark.amount) }
    : benchmark;
}

function gameEvidence(game: Collection["games"][number]): Record<string, unknown> {
  const note =
    game.ownerNote.state === "present"
      ? { state: game.ownerNote.state, version: game.ownerNote.version, text: game.ownerNote.text }
      : { state: game.ownerNote.state, version: game.ownerNote.version };
  const acquisition =
    game.acquisition.state === "purchase"
      ? { state: game.acquisition.state, amount: amountEvidence(game.acquisition.amount) }
      : game.acquisition;
  const manualValues = {
    playingTime:
      game.manualValues.playingTime === null
        ? null
        : {
            value: game.manualValues.playingTime.value,
            source: game.manualValues.playingTime.source,
          },
    playerCount:
      game.manualValues.playerCount === null
        ? null
        : {
            value: game.manualValues.playerCount.value,
            source: game.manualValues.playerCount.source,
          },
  };
  const bggData =
    game.bggData === null
      ? null
      : {
          communityRating: game.bggData.communityRating,
          bayesAverage: game.bggData.bayesAverage,
          weight: game.bggData.weight,
          numWeightVotes: game.bggData.numWeightVotes,
          description: game.bggData.description,
          mechanics: [...game.bggData.mechanics].sort((a, b) => a.id - b.id),
          categories: [...game.bggData.categories].sort((a, b) => a.id - b.id),
          families: [...game.bggData.families].sort((a, b) => a.id - b.id),
          subdomains: [...game.bggData.subdomains].sort((a, b) => a.id - b.id),
          bestPlayerCount: game.bggData.bestPlayerCount,
        };
  const suggestedPlayerPoll = {
    status: game.suggestedPlayerPoll.status,
    state: game.suggestedPlayerPoll.state,
    buckets: game.suggestedPlayerPoll.buckets,
    source: game.suggestedPlayerPoll.source,
    ...(game.suggestedPlayerPoll.status === "invalid"
      ? { evidence: game.suggestedPlayerPoll.evidence }
      : {}),
  };
  return {
    id: game.id,
    name: game.name,
    bggId: game.bggId,
    additionalBggIds: game.additionalBggIds ?? [],
    yearPublished: game.yearPublished,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    bestPlayers: game.bestPlayers,
    playingTime: game.playingTime,
    bggData,
    numPlays: game.numPlays,
    lastPlayedAt: game.lastPlayedAt ?? null,
    recentPlayCount: game.recentPlayCount ?? null,
    acquisition,
    playCountEvidence: evidenceRecord(game.playCountEvidence),
    durationEvidence: evidenceRecord(game.durationEvidence),
    playerRangeEvidence: evidenceRecord(game.playerRangeEvidence),
    suggestedPlayerPoll,
    bestPlayersInvalidEvidence: game.bestPlayersInvalidEvidence,
    manualValues,
    ownership: game.ownership,
    boxDimensions: game.boxDimensions,
    ratings: game.ratings,
    ownerNote: note,
  };
}

// Retained for v9 pair-resolver/validator consumers until the schema alias cutover.
export function semanticDescriptionSourceFingerprint(
  game: Collection["games"][number],
): string | null {
  const description = game.bggData?.description;
  if (description === null || description === undefined || description.trim().length === 0)
    return null;
  return canonicalSha256({
    representationVersion: 1,
    gameName: game.name,
    bggDescription: description,
  });
}

// Retained for v9 pair-resolver/validator consumers until the schema alias cutover.
export function semanticOwnerNoteSourceFingerprint(
  game: Collection["games"][number],
): string | null {
  if (game.ownerNote.state !== "present" || game.ownerNote.version <= 0) return null;
  return canonicalSha256({
    representationVersion: 1,
    gameName: game.name,
    ownerNote: game.ownerNote.text,
  });
}

/** Stable collection-owned inputs that determine scoring or game eligibility. */
export function collectionRedundancyEvidenceIdentity(collection: Collection): string {
  return canonicalSha256({
    axes: collection.axes
      .map(axisEvidence)
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    games: collection.games
      .map(gameEvidence)
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    entertainmentBenchmark: benchmarkEvidence(collection),
    bggPlaySessions: (collection.bggPlaySessions ?? [])
      .map(({ playId, bggId, quantity, playedOn }) => ({ playId, bggId, quantity, playedOn }))
      .sort((a, b) => a.playId - b.playId),
  });
}

/** Called by the serialized collection mutation boundary before evidence changes are validated. */
export function applySemanticEvidenceTransition(prior: Collection, candidate: Collection): void {
  if (
    collectionRedundancyEvidenceIdentity(prior) === collectionRedundancyEvidenceIdentity(candidate)
  ) {
    return;
  }
  const currentEpoch = prior.semanticRedundancy.evidenceEpoch;
  if (currentEpoch >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Semantic evidence epoch cannot advance beyond the safe integer range");
  }
  candidate.semanticRedundancy.evidenceEpoch = currentEpoch + 1;
  discardLegacySemanticPayload(candidate);
}

export interface SemanticRedundancyStateService {
  updateSettings(
    expected: SemanticEpochIdentity,
    settings: SemanticRedundancySettings,
  ): Promise<SemanticStateMutationResult<void>>;
  invalidateForFactualWeights(fingerprint: string): Promise<SemanticStateMutationResult<void>>;
}

export function createSemanticRedundancyStateService(deps: {
  collectionMutationService: CollectionMutationService;
}): SemanticRedundancyStateService {
  function currentEpoch(collection: Collection): SemanticEpochIdentity {
    return {
      evidenceEpoch: collection.semanticRedundancy.evidenceEpoch,
      consentEpoch: collection.semanticRedundancy.consentEpoch,
    };
  }

  function epochsMatch(collection: Collection, expected: SemanticEpochIdentity): boolean {
    const current = currentEpoch(collection);
    return (
      current.evidenceEpoch === expected.evidenceEpoch &&
      current.consentEpoch === expected.consentEpoch
    );
  }

  async function mutate<Value>(
    operation: CollectionMutationContext["operation"],
    callback: (
      collection: Collection,
    ) =>
      | CollectionMutationDecision<SemanticStateMutationResult<Value>>
      | Promise<CollectionMutationDecision<SemanticStateMutationResult<Value>>>,
  ): Promise<SemanticStateMutationResult<Value>> {
    const result = await deps.collectionMutationService.mutate<SemanticStateMutationResult<Value>>(
      { operation, trigger: "semantic-redundancy" },
      callback,
    );
    if (result.value.outcome === "accepted") {
      return { ...result.value, current: currentEpoch(result.collection) };
    }
    return result.value;
  }

  return {
    updateSettings(expected, settings) {
      return mutate("semantic-redundancy.settings.update", (collection) => {
        const state = collection.semanticRedundancy;
        if (!epochsMatch(collection, expected))
          return { changed: false, value: { outcome: "stale", current: currentEpoch(collection) } };
        const parsed = SemanticRedundancyStateSchema.safeParse({ ...state, settings });
        if (!parsed.success) return { changed: false, value: { outcome: "invalid-state" } };
        const sameSettings =
          canonicalSha256(state.settings) === canonicalSha256(parsed.data.settings);
        const firstOptIn = parsed.data.settings.enabled && !state.firstOptInInitialized;
        if (sameSettings && !firstOptIn)
          return {
            changed: false,
            value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
          };
        if (state.consentEpoch >= Number.MAX_SAFE_INTEGER)
          return { changed: false, value: { outcome: "invalid-state" } };
        state.settings = parsed.data.settings;
        state.consentEpoch += 1;
        if (parsed.data.settings.enabled) state.firstOptInInitialized = true;
        discardLegacySemanticPayload(collection);
        return {
          changed: true,
          value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
        };
      });
    },

    invalidateForFactualWeights(fingerprint) {
      if (!/^[a-f0-9]{64}$/.test(fingerprint)) return Promise.resolve({ outcome: "invalid-state" });
      return mutate("semantic-redundancy.factual-weights.invalidate", (collection) => {
        const state = collection.semanticRedundancy;
        if (state.factualWeightsFingerprint === fingerprint)
          return {
            changed: false,
            value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
          };
        if (state.factualWeightsEpoch >= Number.MAX_SAFE_INTEGER)
          return { changed: false, value: { outcome: "invalid-state" } };
        state.factualWeightsEpoch += 1;
        state.factualWeightsFingerprint = fingerprint;
        discardLegacySemanticPayload(collection);
        return {
          changed: true,
          value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
        };
      });
    },
  };
}
