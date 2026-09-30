import {
  SemanticRedundancyStateSchema,
  SemanticDisclosureManifestSchema,
  semanticDisclosureManifestDigest,
  type Collection,
  type SemanticPairJudgment,
  type SemanticRedundancySettings,
  type SemanticDisclosureManifest,
  type SemanticSourceIdentity,
  type SemanticExecution,
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

/** Internal capture produced from authoritative collection/profile inputs, never client data. */
export interface SemanticDisclosureCapture {
  manifest: SemanticDisclosureManifest;
  sourceIdentity: SemanticSourceIdentity;
}

export interface SemanticDisclosurePage {
  manifestId: string;
  manifestDigest: string;
  offset: number;
  limit: number;
}

export interface SemanticDisclosurePageResult {
  manifestId: string;
  manifestDigest: string;
  offset: number;
  nextOffset: number;
  complete: boolean;
  pairs: SemanticDisclosureManifest["pairs"];
  receipt: { pageIndex: number; nextOffset: number; complete: boolean };
}

export type SemanticExecutionStart = SemanticExecution & { disposition: "CREATED" | "REPLAYED" };

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

function isScored(
  judgment: SemanticPairJudgment["description"],
): judgment is Extract<NonNullable<SemanticPairJudgment["description"]>, { status: "scored" }> {
  return judgment?.status === "scored";
}

function missingFingerprint(manifestDigest: string, gameId: string, signal: "C" | "D"): string {
  return canonicalSha256({ manifestDigest, gameId, signal, status: "missing-source" });
}

function pairGames(
  collection: Collection,
  pair: SemanticPairJudgment,
): readonly [Collection["games"][number], Collection["games"][number]] | null {
  const gameA = collection.games.find(({ id }) => id === pair.gameA);
  const gameB = collection.games.find(({ id }) => id === pair.gameB);
  return gameA === undefined || gameB === undefined ? null : [gameA, gameB];
}

function descriptionJudgmentIsCurrent(
  judgment: SemanticPairJudgment["description"],
  gameA: Collection["games"][number],
  gameB: Collection["games"][number],
  cachedOwnerNoteUse: boolean,
): boolean {
  if (!isScored(judgment)) return false;
  const currentA = semanticDescriptionSourceFingerprint(gameA);
  const currentB = semanticDescriptionSourceFingerprint(gameB);
  if (currentA === null || currentB === null) return false;
  if (judgment.sourceFingerprintA !== currentA || judgment.sourceFingerprintB !== currentB)
    return false;
  const context = judgment.requestContext;
  if (context.kind === "description-only")
    return judgment.noteVersionA === null && judgment.noteVersionB === null;
  if (context.kind !== "description-and-owner-notes" || !cachedOwnerNoteUse) return false;
  return (
    judgment.sourceFingerprintA === context.descriptionFingerprintA &&
    judgment.sourceFingerprintB === context.descriptionFingerprintB &&
    gameA.ownerNote.state === "present" &&
    gameB.ownerNote.state === "present" &&
    gameA.ownerNote.version > 0 &&
    gameB.ownerNote.version > 0 &&
    judgment.noteVersionA === gameA.ownerNote.version &&
    judgment.noteVersionB === gameB.ownerNote.version
  );
}

function ownerNoteJudgmentIsCurrent(
  judgment: SemanticPairJudgment["ownerNote"],
  gameA: Collection["games"][number],
  gameB: Collection["games"][number],
  cachedOwnerNoteUse: boolean,
): boolean {
  if (!isScored(judgment) || !cachedOwnerNoteUse) return false;
  const currentA = semanticOwnerNoteSourceFingerprint(gameA);
  const currentB = semanticOwnerNoteSourceFingerprint(gameB);
  if (currentA === null || currentB === null) return false;
  if (
    judgment.sourceFingerprintA !== currentA ||
    judgment.sourceFingerprintB !== currentB ||
    gameA.ownerNote.state !== "present" ||
    gameB.ownerNote.state !== "present" ||
    judgment.noteVersionA !== gameA.ownerNote.version ||
    judgment.noteVersionB !== gameB.ownerNote.version
  )
    return false;
  if (judgment.requestContext.kind === "owner-notes-only") return true;
  if (judgment.requestContext.kind !== "description-and-owner-notes") return false;
  const descriptionA = semanticDescriptionSourceFingerprint(gameA);
  const descriptionB = semanticDescriptionSourceFingerprint(gameB);
  return (
    descriptionA !== null &&
    descriptionB !== null &&
    judgment.requestContext.descriptionFingerprintA === descriptionA &&
    judgment.requestContext.descriptionFingerprintB === descriptionB
  );
}

function reconcilePairJudgments(collection: Collection): void {
  const state = collection.semanticRedundancy;
  const reconciled: SemanticPairJudgment[] = [];
  for (const pair of state.pairJudgments) {
    const games = pairGames(collection, pair);
    if (games === null) continue;
    const [gameA, gameB] = games;
    const description = descriptionJudgmentIsCurrent(
      pair.description,
      gameA,
      gameB,
      state.settings.cachedOwnerNoteUse,
    )
      ? pair.description
      : null;
    const ownerNote = ownerNoteJudgmentIsCurrent(
      pair.ownerNote,
      gameA,
      gameB,
      state.settings.cachedOwnerNoteUse,
    )
      ? pair.ownerNote
      : null;
    if (description !== null || ownerNote !== null) {
      reconciled.push({ gameA: pair.gameA, gameB: pair.gameB, description, ownerNote });
    }
  }
  state.pairJudgments = reconciled;
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

function fenceActiveRun(collection: Collection): void {
  const state = collection.semanticRedundancy;
  state.disclosure = null;
  state.disclosureManifest = null;
  state.manifestDelivery = null;
  state.execution = null;
  if (state.authorization?.state === "active") {
    state.authorization = { ...state.authorization, state: "revoked" };
  }
  state.publishedGeneration = null;
}

/**
 * Called by the serialized collection mutation boundary. It intentionally ignores
 * semantic bookkeeping, collection revision/timestamps, and command receipts.
 */
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
  reconcilePairJudgments(candidate);
  fenceActiveRun(candidate);
}

export interface SemanticRedundancyStateService {
  createDisclosure(
    capture: SemanticDisclosureCapture,
    authoritativeSourceIdentityValidator?: (
      collection: Collection,
      expected: SemanticSourceIdentity,
    ) => boolean | Promise<boolean>,
  ): Promise<SemanticStateMutationResult<{ id: string; digest: string }>>;
  deliverDisclosurePage(
    page: SemanticDisclosurePage,
  ): Promise<SemanticStateMutationResult<SemanticDisclosurePageResult>>;
  startExecution(input: {
    commandId: string;
    manifestId: string;
    manifestDigest: string;
    /** Pair count acknowledged by the caller after manifest delivery. */
    pairCount?: number;
    sourceIdentity: SemanticSourceIdentity;
    transmissionAuthorized: boolean;
    noteTransmissionAuthorized: boolean;
    cachedOwnerNoteUseAuthorized: boolean;
    deadlineAt: string;
  }): Promise<SemanticStateMutationResult<SemanticExecutionStart>>;
  reserveExecutionAttempt(input: {
    commandId: string;
    manifestDigest: string;
    sourceIdentity: SemanticSourceIdentity;
    gameA: string;
    gameB: string;
    signalMode: "description-only" | "owner-notes-only" | "description-and-owner-notes";
    noteTransmissionAuthorized: boolean;
  }): Promise<SemanticStateMutationResult<number>>;
  finishExecution(input: {
    commandId: string;
    status: "completed" | "failed" | "interrupted" | "stale";
    sourceIdentity?: SemanticSourceIdentity;
  }): Promise<SemanticStateMutationResult<void>>;
  cancelExecution(commandId: string): Promise<SemanticStateMutationResult<void>>;
  updateSettings(
    expected: SemanticEpochIdentity,
    settings: SemanticRedundancySettings,
  ): Promise<SemanticStateMutationResult<void>>;
  checkpointJudgments(input: {
    expected: SemanticEpochIdentity;
    authorizationId: string;
    judgments: readonly SemanticPairJudgment[];
  }): Promise<SemanticStateMutationResult<void>>;
  publishGeneration(input: {
    expected: SemanticEpochIdentity;
    authorizationId: string;
    manifest: SemanticDisclosureManifest;
    eligibleGameIds: readonly string[];
    sourceIdentity: SemanticSourceIdentity;
    generation: Omit<
      import("@shelf-judge/shared").SemanticRedundancyGeneration,
      "weights" | "pairOutcomes" | "eligibleGameIds"
    >;
  }): Promise<SemanticStateMutationResult<void>>;
  invalidateForFactualWeights(fingerprint: string): Promise<SemanticStateMutationResult<void>>;
}

export function createSemanticRedundancyStateService(deps: {
  collectionMutationService: CollectionMutationService;
  /** Re-captures durable external source revisions while inside the coordinator. */
  validateSourceIdentity?: (
    collection: Collection,
    expected: SemanticSourceIdentity,
  ) => boolean | Promise<boolean>;
  now?: () => number;
}): SemanticRedundancyStateService {
  const now = deps.now ?? Date.now;
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
    async createDisclosure(capture, authoritativeSourceIdentityValidator) {
      return mutate<{ id: string; digest: string }>(
        "semantic-redundancy.disclosure.create",
        async (
          collection,
        ): Promise<
          CollectionMutationDecision<SemanticStateMutationResult<{ id: string; digest: string }>>
        > => {
          const state = collection.semanticRedundancy;
          if (state.execution?.status === "running")
            return { changed: false, value: { outcome: "not-authorized" } };
          const manifest = structuredClone(capture.manifest);
          const validateSourceIdentity =
            authoritativeSourceIdentityValidator ?? deps.validateSourceIdentity;
          const { id, digest: _untrustedDigest, ...digestInput } = manifest;
          void _untrustedDigest;
          const digest = semanticDisclosureManifestDigest(digestInput);
          if (state.execution?.manifestDigest === digest)
            return { changed: false, value: { outcome: "not-authorized" } };
          manifest.digest = digest;
          const pairs = manifest.pairs;
          const ordered = [...pairs].sort((a, b) =>
            a.gameA === b.gameA ? a.gameB.localeCompare(b.gameB) : a.gameA.localeCompare(b.gameA),
          );
          const identityMatches =
            canonicalSha256(capture.sourceIdentity) === canonicalSha256(manifest.sourceIdentity) &&
            capture.sourceIdentity.collectionId === collection.id &&
            capture.sourceIdentity.collectionSchemaVersion === collection.schemaVersion &&
            capture.sourceIdentity.evidenceEpoch === state.evidenceEpoch &&
            capture.sourceIdentity.consentEpoch === state.consentEpoch &&
            capture.sourceIdentity.factualWeightsEpoch === state.factualWeightsEpoch &&
            capture.sourceIdentity.factualWeightsFingerprint === state.factualWeightsFingerprint &&
            validateSourceIdentity !== undefined &&
            (await validateSourceIdentity(collection, capture.sourceIdentity));
          const pairOrderValid = pairs.every(
            (pair, index) => pair.gameA < pair.gameB && pair === ordered[index],
          );
          const digestValid = SemanticDisclosureManifestSchema.safeParse(manifest).success;
          if (!identityMatches)
            return {
              changed: false,
              value: { outcome: "stale", current: currentEpoch(collection) },
            };
          if (
            !state.settings.enabled ||
            !pairOrderValid ||
            !digestValid ||
            Date.parse(manifest.expiresAt) <= now()
          )
            return { changed: false, value: { outcome: "invalid-state" } };
          if (
            manifest.eligibleGameIds.some(
              (id, index) =>
                index > 0 && manifest.eligibleGameIds[index - 1].localeCompare(id) >= 0,
            )
          )
            return { changed: false, value: { outcome: "invalid-state" } };
          const notePairCount = pairs.filter(
            (pair) => pair.hasOwnerNoteA && pair.hasOwnerNoteB,
          ).length;
          state.disclosureManifest = manifest;
          state.disclosure = {
            id,
            manifestDigest: digest,
            evidenceEpoch: state.evidenceEpoch,
            consentEpoch: state.consentEpoch,
            pairCount: pairs.length,
            notePairCount,
            expiresAt: manifest.expiresAt,
          };
          state.manifestDelivery = {
            manifestDigest: manifest.digest,
            pageSize: 100,
            deliveredPageIndexes: [],
            complete: false,
          };
          state.authorization = null;
          state.execution = null;
          return {
            changed: true,
            value: {
              outcome: "accepted",
              value: { id, digest },
              current: currentEpoch(collection),
            },
          };
        },
      );
    },

    deliverDisclosurePage(page) {
      return mutate<SemanticDisclosurePageResult>(
        "semantic-redundancy.disclosure.deliver",
        async (
          collection,
        ): Promise<
          CollectionMutationDecision<SemanticStateMutationResult<SemanticDisclosurePageResult>>
        > => {
          const state = collection.semanticRedundancy;
          const manifest = state.disclosureManifest;
          const disclosure = state.disclosure;
          const delivery = state.manifestDelivery;
          if (
            !manifest ||
            !disclosure ||
            !delivery ||
            page.manifestId !== manifest.id ||
            page.manifestDigest !== manifest.digest ||
            disclosure.manifestDigest !== manifest.digest ||
            delivery.manifestDigest !== manifest.digest ||
            Date.parse(disclosure.expiresAt) <= now()
          )
            return { changed: false, value: { outcome: "invalid-state" } };
          const identityMatches =
            manifest.sourceIdentity.collectionId === collection.id &&
            manifest.sourceIdentity.collectionSchemaVersion === collection.schemaVersion &&
            manifest.sourceIdentity.evidenceEpoch === state.evidenceEpoch &&
            manifest.sourceIdentity.consentEpoch === state.consentEpoch &&
            manifest.sourceIdentity.factualWeightsEpoch === state.factualWeightsEpoch &&
            manifest.sourceIdentity.factualWeightsFingerprint === state.factualWeightsFingerprint;
          if (
            !identityMatches ||
            deps.validateSourceIdentity === undefined ||
            !(await deps.validateSourceIdentity(collection, manifest.sourceIdentity))
          )
            return {
              changed: false,
              value: { outcome: "stale", current: currentEpoch(collection) },
            };
          if (
            !Number.isSafeInteger(page.offset) ||
            page.offset < 0 ||
            page.limit !== delivery.pageSize ||
            page.offset % delivery.pageSize !== 0 ||
            page.offset > manifest.pairs.length ||
            (manifest.pairs.length > 0 && page.offset === manifest.pairs.length)
          )
            return { changed: false, value: { outcome: "invalid-state" } };
          const pageIndex = page.offset / delivery.pageSize;
          const expectedIndex = delivery.deliveredPageIndexes.length;
          if (pageIndex < expectedIndex && delivery.deliveredPageIndexes[pageIndex] === pageIndex) {
            const pairs = manifest.pairs.slice(page.offset, page.offset + delivery.pageSize);
            return {
              changed: false,
              value: {
                outcome: "accepted",
                value: {
                  manifestId: manifest.id,
                  manifestDigest: manifest.digest,
                  offset: page.offset,
                  nextOffset: page.offset + pairs.length,
                  complete: delivery.complete,
                  pairs,
                  receipt: {
                    pageIndex,
                    nextOffset: page.offset + pairs.length,
                    complete: delivery.complete,
                  },
                },
                current: currentEpoch(collection),
              },
            };
          }
          if (pageIndex !== expectedIndex)
            return { changed: false, value: { outcome: "invalid-state" } };
          const pairs = manifest.pairs.slice(page.offset, page.offset + delivery.pageSize);
          const nextOffset = page.offset + pairs.length;
          delivery.deliveredPageIndexes.push(pageIndex);
          delivery.complete = nextOffset >= manifest.pairs.length;
          const value = {
            manifestId: manifest.id,
            manifestDigest: manifest.digest,
            offset: page.offset,
            nextOffset,
            complete: delivery.complete,
            pairs,
            receipt: { pageIndex, nextOffset, complete: delivery.complete },
          };
          return {
            changed: true,
            value: { outcome: "accepted", value, current: currentEpoch(collection) },
          };
        },
      );
    },

    startExecution(input) {
      return mutate<SemanticExecutionStart>(
        "semantic-redundancy.execution.start",
        async (
          collection,
        ): Promise<
          CollectionMutationDecision<SemanticStateMutationResult<SemanticExecutionStart>>
        > => {
          const state = collection.semanticRedundancy;
          const manifest = state.disclosureManifest;
          const disclosure = state.disclosure;
          const existing = state.execution;
          if (existing?.commandId === input.commandId) {
            const sameAcknowledgement =
              input.commandId === input.manifestId &&
              input.transmissionAuthorized === true &&
              input.manifestId === existing.commandId &&
              input.manifestDigest === existing.manifestDigest &&
              canonicalSha256(input.sourceIdentity) === canonicalSha256(existing.sourceIdentity) &&
              input.noteTransmissionAuthorized === existing.noteTransmissionAuthorized &&
              input.cachedOwnerNoteUseAuthorized === existing.cachedOwnerNoteUseAuthorized &&
              input.deadlineAt === existing.deadlineAt &&
              (input.pairCount === undefined || input.pairCount === disclosure?.pairCount);
            if (!sameAcknowledgement)
              return { changed: false, value: { outcome: "not-authorized" } };
            return {
              changed: false,
              value: {
                outcome: "accepted",
                value: { ...structuredClone(existing), disposition: "REPLAYED" },
                current: currentEpoch(collection),
              },
            };
          }
          if (existing?.manifestDigest === input.manifestDigest)
            return { changed: false, value: { outcome: "not-authorized" } };
          const delivery = state.manifestDelivery;
          if (!manifest || !disclosure)
            return { changed: false, value: { outcome: "not-authorized" } };
          const { id: _manifestId, digest: _manifestDigest, ...manifestDigestInput } = manifest;
          void _manifestId;
          void _manifestDigest;
          const requiredPageCount =
            delivery === null
              ? 0
              : Math.max(1, Math.ceil(manifest.pairs.length / delivery.pageSize));
          const hasCompleteDelivery =
            delivery !== null &&
            delivery.complete &&
            delivery.deliveredPageIndexes.length === requiredPageCount &&
            delivery.deliveredPageIndexes.every((index, position) => index === position);
          if (
            input.commandId !== input.manifestId ||
            (input.pairCount !== undefined && input.pairCount !== disclosure.pairCount) ||
            disclosure.pairCount !== manifest.pairs.length ||
            canonicalSha256(manifest.sourceIdentity) !== canonicalSha256(input.sourceIdentity) ||
            semanticDisclosureManifestDigest(manifestDigestInput) !== manifest.digest ||
            !hasCompleteDelivery ||
            manifest.id !== input.manifestId ||
            manifest.digest !== input.manifestDigest ||
            disclosure.manifestDigest !== manifest.digest ||
            Date.parse(disclosure.expiresAt) <= now()
          )
            return { changed: false, value: { outcome: "not-authorized" } };
          const identityMatches =
            manifest.sourceIdentity.collectionId === collection.id &&
            manifest.sourceIdentity.collectionSchemaVersion === collection.schemaVersion &&
            manifest.sourceIdentity.evidenceEpoch === state.evidenceEpoch &&
            manifest.sourceIdentity.consentEpoch === state.consentEpoch &&
            manifest.sourceIdentity.factualWeightsEpoch === state.factualWeightsEpoch &&
            manifest.sourceIdentity.factualWeightsFingerprint === state.factualWeightsFingerprint;
          if (
            canonicalSha256(input.sourceIdentity) !== canonicalSha256(manifest.sourceIdentity) ||
            !identityMatches ||
            deps.validateSourceIdentity === undefined ||
            !(await deps.validateSourceIdentity(collection, manifest.sourceIdentity))
          )
            return {
              changed: false,
              value: { outcome: "stale", current: currentEpoch(collection) },
            };
          if (Date.parse(disclosure.expiresAt) <= now() || Date.parse(manifest.expiresAt) <= now())
            return { changed: false, value: { outcome: "not-authorized" } };
          if (
            !state.settings.enabled ||
            !input.transmissionAuthorized ||
            Date.parse(input.deadlineAt) <= now() ||
            Date.parse(input.deadlineAt) > now() + manifest.budget.maxDurationMs ||
            (manifest.signalScope === "owner-notes-only" && !input.noteTransmissionAuthorized) ||
            (manifest.signalScope === "description-only" && input.noteTransmissionAuthorized)
          )
            return { changed: false, value: { outcome: "not-authorized" } };
          if (!state.settings.cachedOwnerNoteUse && input.cachedOwnerNoteUseAuthorized)
            return { changed: false, value: { outcome: "not-authorized" } };
          const execution: SemanticExecution = {
            commandId: input.commandId,
            manifestDigest: manifest.digest,
            sourceIdentity: manifest.sourceIdentity,
            signalScope: manifest.signalScope,
            noteTransmissionAuthorized: input.noteTransmissionAuthorized,
            cachedOwnerNoteUseAuthorized: input.cachedOwnerNoteUseAuthorized,
            status: "running",
            attemptCount: 0,
            completedPairCount: 0,
            failedPairCount: 0,
            deadlineAt: input.deadlineAt,
            startedAt: new Date(now()).toISOString(),
            endedAt: null,
          };
          state.authorization = { ...disclosure, state: "active" };
          state.execution = execution;
          return {
            changed: true,
            value: {
              outcome: "accepted",
              value: { ...structuredClone(execution), disposition: "CREATED" },
              current: currentEpoch(collection),
            },
          };
        },
      );
    },

    reserveExecutionAttempt(input) {
      return mutate<number>("semantic-redundancy.execution.reserve-attempt", async (collection) => {
        const state = collection.semanticRedundancy;
        const execution = state.execution;
        const manifest = state.disclosureManifest;
        const authorization = state.authorization;
        if (
          !execution ||
          !manifest ||
          !authorization ||
          execution.commandId !== input.commandId ||
          execution.status !== "running" ||
          Date.parse(execution.deadlineAt) <= now() ||
          Date.parse(manifest.expiresAt) <= now() ||
          execution.manifestDigest !== input.manifestDigest ||
          manifest.digest !== input.manifestDigest ||
          authorization.manifestDigest !== input.manifestDigest ||
          authorization.state !== "active" ||
          canonicalSha256(execution.sourceIdentity) !== canonicalSha256(input.sourceIdentity) ||
          canonicalSha256(manifest.sourceIdentity) !== canonicalSha256(input.sourceIdentity) ||
          !manifest.pairs.some(
            ({ gameA, gameB }) => gameA === input.gameA && gameB === input.gameB,
          ) ||
          (input.signalMode !== "description-only" &&
            (manifest.signalScope === "description-only" ||
              !input.noteTransmissionAuthorized ||
              !execution.noteTransmissionAuthorized)) ||
          (input.signalMode !== "owner-notes-only" && manifest.signalScope === "owner-notes-only")
        )
          return { changed: false, value: { outcome: "not-authorized" } };
        const pair = manifest.pairs.find(
          ({ gameA, gameB }) => gameA === input.gameA && gameB === input.gameB,
        )!;
        const descriptionRequested =
          manifest.signalScope !== "owner-notes-only" &&
          pair.hasDescriptionA &&
          pair.hasDescriptionB;
        const notesRequested =
          manifest.signalScope !== "description-only" &&
          execution.noteTransmissionAuthorized &&
          pair.hasOwnerNoteA &&
          pair.hasOwnerNoteB;
        const expectedSignalMode =
          descriptionRequested && notesRequested
            ? "description-and-owner-notes"
            : descriptionRequested
              ? "description-only"
              : notesRequested
                ? "owner-notes-only"
                : null;
        if (
          expectedSignalMode === null ||
          input.signalMode !== expectedSignalMode ||
          deps.validateSourceIdentity === undefined ||
          !(await deps.validateSourceIdentity(collection, manifest.sourceIdentity))
        )
          return { changed: false, value: { outcome: "stale", current: currentEpoch(collection) } };
        if (execution.attemptCount >= manifest.budget.maxRequests)
          return { changed: false, value: { outcome: "invalid-state" } };
        execution.attemptCount += 1;
        return {
          changed: true,
          value: {
            outcome: "accepted",
            value: execution.attemptCount,
            current: currentEpoch(collection),
          },
        };
      });
    },

    finishExecution({ commandId, status, sourceIdentity }) {
      return mutate<void>("semantic-redundancy.execution.finish", async (collection) => {
        const execution = collection.semanticRedundancy.execution;
        if (!execution || execution.commandId !== commandId || execution.status !== "running")
          return { changed: false, value: { outcome: "invalid-state" } };
        if (status === "completed") {
          const completedExecutionIsExpired = () => {
            const state = collection.semanticRedundancy;
            return (
              Date.parse(execution.deadlineAt) <= now() ||
              !state.authorization ||
              state.authorization.state !== "active" ||
              Date.parse(state.authorization.expiresAt) <= now() ||
              !state.disclosureManifest ||
              Date.parse(state.disclosureManifest.expiresAt) <= now()
            );
          };
          if (completedExecutionIsExpired())
            return { changed: false, value: { outcome: "not-authorized" } };
          if (
            sourceIdentity === undefined ||
            canonicalSha256(sourceIdentity) !== canonicalSha256(execution.sourceIdentity) ||
            deps.validateSourceIdentity === undefined ||
            !(await deps.validateSourceIdentity(collection, execution.sourceIdentity))
          )
            return {
              changed: false,
              value: { outcome: "stale", current: currentEpoch(collection) },
            };
          if (completedExecutionIsExpired())
            return { changed: false, value: { outcome: "not-authorized" } };
        }
        execution.status = status;
        execution.endedAt = new Date(now()).toISOString();
        if (
          status === "completed" &&
          collection.semanticRedundancy.authorization?.state === "active"
        )
          collection.semanticRedundancy.authorization = {
            ...collection.semanticRedundancy.authorization,
            state: "consumed",
          };
        else if (
          status !== "completed" &&
          collection.semanticRedundancy.authorization?.state === "active"
        )
          collection.semanticRedundancy.authorization = {
            ...collection.semanticRedundancy.authorization,
            state: "revoked",
          };
        return {
          changed: true,
          value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
        };
      });
    },

    cancelExecution(commandId) {
      return mutate("semantic-redundancy.execution.cancel", (collection) => {
        const state = collection.semanticRedundancy;
        const execution = state.execution;
        if (!execution || execution.commandId !== commandId)
          return { changed: false, value: { outcome: "invalid-state" } };
        if (execution.status !== "running")
          return {
            changed: false,
            value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
          };
        execution.status = "cancelled";
        execution.endedAt = new Date(now()).toISOString();
        if (state.authorization?.state === "active")
          state.authorization = { ...state.authorization, state: "revoked" };
        return {
          changed: true,
          value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
        };
      });
    },

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
        reconcilePairJudgments(collection);
        fenceActiveRun(collection);
        return {
          changed: true,
          value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
        };
      });
    },

    checkpointJudgments({ expected, authorizationId, judgments }) {
      return mutate("semantic-redundancy.judgments.checkpoint", async (collection) => {
        const state = collection.semanticRedundancy;
        if (judgments.length === 0) return { changed: false, value: { outcome: "invalid-state" } };
        if (!epochsMatch(collection, expected))
          return { changed: false, value: { outcome: "stale", current: currentEpoch(collection) } };
        const execution = state.execution;
        const authorization = state.authorization;
        const executionIsAdmissible = () =>
          !!execution &&
          execution.status === "running" &&
          Date.parse(execution.deadlineAt) > now() &&
          !!authorization &&
          authorization.state === "active" &&
          authorization.id === authorizationId &&
          Date.parse(authorization.expiresAt) > now() &&
          !!state.disclosureManifest &&
          Date.parse(state.disclosureManifest.expiresAt) > now();
        if (!executionIsAdmissible())
          return { changed: false, value: { outcome: "not-authorized" } };
        if (
          state.authorization?.id !== authorizationId ||
          state.authorization.state !== "active" ||
          state.authorization.evidenceEpoch !== expected.evidenceEpoch ||
          state.authorization.consentEpoch !== expected.consentEpoch ||
          Date.parse(state.authorization.expiresAt) <= now()
        )
          return { changed: false, value: { outcome: "not-authorized" } };
        if (
          state.disclosure?.id !== authorizationId ||
          state.disclosure.manifestDigest !== state.authorization.manifestDigest ||
          state.disclosure.evidenceEpoch !== expected.evidenceEpoch ||
          state.disclosure.consentEpoch !== expected.consentEpoch
        )
          return { changed: false, value: { outcome: "invalid-state" } };
        if (
          execution!.manifestDigest !== state.disclosure.manifestDigest ||
          deps.validateSourceIdentity === undefined ||
          !(await deps.validateSourceIdentity(collection, execution!.sourceIdentity))
        )
          return { changed: false, value: { outcome: "stale", current: currentEpoch(collection) } };
        if (!executionIsAdmissible())
          return { changed: false, value: { outcome: "not-authorized" } };
        const ownerNoteUseAuthorized =
          state.settings.cachedOwnerNoteUse || state.execution?.noteTransmissionAuthorized === true;
        if (
          !ownerNoteUseAuthorized &&
          judgments.some(
            ({ description, ownerNote }) =>
              ownerNote !== null ||
              (description?.status === "scored" &&
                (description.noteVersionA !== null || description.noteVersionB !== null)),
          )
        )
          return { changed: false, value: { outcome: "not-authorized" } };
        const byPair = new Map(
          state.pairJudgments.map((pair) => [`${pair.gameA}\u0000${pair.gameB}`, pair]),
        );
        for (const judgment of judgments) {
          if (judgment.description === null && judgment.ownerNote === null)
            return { changed: false, value: { outcome: "invalid-state" } };
          const games = pairGames(collection, judgment);
          if (games === null) return { changed: false, value: { outcome: "invalid-state" } };
          if (
            state.execution?.status === "running" &&
            !state.disclosureManifest?.pairs.some(
              ({ gameA, gameB }) => gameA === judgment.gameA && gameB === judgment.gameB,
            )
          )
            return { changed: false, value: { outcome: "invalid-state" } };
          if (state.execution?.status === "running") {
            const manifestPair = state.disclosureManifest!.pairs.find(
              ({ gameA, gameB }) => gameA === judgment.gameA && gameB === judgment.gameB,
            )!;
            if (
              (judgment.description !== null &&
                (state.execution.signalScope === "owner-notes-only" ||
                  !manifestPair.hasDescriptionA ||
                  !manifestPair.hasDescriptionB)) ||
              (judgment.ownerNote !== null &&
                (state.execution.signalScope === "description-only" ||
                  !manifestPair.hasOwnerNoteA ||
                  !manifestPair.hasOwnerNoteB ||
                  (!state.execution.noteTransmissionAuthorized &&
                    !(
                      state.settings.cachedOwnerNoteUse &&
                      state.execution.cachedOwnerNoteUseAuthorized
                    ))))
            )
              return { changed: false, value: { outcome: "not-authorized" } };
          }
          const [gameA, gameB] = games;
          if (
            (judgment.description?.status === "scored" &&
              !descriptionJudgmentIsCurrent(
                judgment.description,
                gameA,
                gameB,
                ownerNoteUseAuthorized,
              )) ||
            (judgment.ownerNote?.status === "scored" &&
              !ownerNoteJudgmentIsCurrent(judgment.ownerNote, gameA, gameB, ownerNoteUseAuthorized))
          )
            return {
              changed: false,
              value: { outcome: "stale", current: currentEpoch(collection) },
            };
          const key = `${judgment.gameA}\u0000${judgment.gameB}`;
          const existing = byPair.get(key);
          const preserveCompleted = (
            incoming: SemanticPairJudgment["description"],
            previous: SemanticPairJudgment["description"],
          ) =>
            incoming === null ||
            (isScored(previous) && (incoming.status === "pending" || incoming.status === "failed"))
              ? previous
              : structuredClone(incoming);
          byPair.set(key, {
            gameA: judgment.gameA,
            gameB: judgment.gameB,
            description: preserveCompleted(judgment.description, existing?.description ?? null),
            ownerNote: preserveCompleted(judgment.ownerNote, existing?.ownerNote ?? null),
          });
        }
        state.pairJudgments = [...byPair.values()].sort((a, b) =>
          a.gameA === b.gameA ? a.gameB.localeCompare(b.gameB) : a.gameA.localeCompare(b.gameA),
        );
        if (state.execution?.status === "running" && state.disclosureManifest !== null) {
          const completed = new Set(
            state.pairJudgments
              .filter(({ description, ownerNote }) =>
                [description, ownerNote].some(
                  (judgment) =>
                    judgment !== null &&
                    judgment.status !== "pending" &&
                    judgment.status !== "failed",
                ),
              )
              .map(({ gameA, gameB }) => `${gameA}\u0000${gameB}`),
          );
          state.execution.completedPairCount = Math.min(
            completed.size,
            state.disclosureManifest.pairs.length,
          );
        }
        const validated = SemanticRedundancyStateSchema.safeParse(state);
        if (!validated.success) return { changed: false, value: { outcome: "invalid-state" } };
        return {
          changed: true,
          value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
        };
      });
    },

    publishGeneration({
      expected,
      authorizationId,
      manifest,
      eligibleGameIds,
      sourceIdentity,
      generation,
    }) {
      return mutate("semantic-redundancy.generation.publish", async (collection) => {
        const state = collection.semanticRedundancy;
        if (!epochsMatch(collection, expected))
          return { changed: false, value: { outcome: "stale", current: currentEpoch(collection) } };
        const execution = state.execution;
        const authorization = state.authorization;
        const persistedManifest = state.disclosureManifest;
        const expired = () =>
          Date.parse(execution?.deadlineAt ?? "") <= now() ||
          Date.parse(authorization?.expiresAt ?? "") <= now() ||
          Date.parse(persistedManifest?.expiresAt ?? "") <= now();
        if (
          !execution ||
          execution.commandId === "" ||
          execution.status !== "running" ||
          execution.manifestDigest !== manifest.digest ||
          execution.commandId.length === 0 ||
          !authorization ||
          authorization.id !== authorizationId ||
          authorization.state !== "active" ||
          authorization.manifestDigest !== manifest.digest ||
          !persistedManifest ||
          persistedManifest.digest !== manifest.digest ||
          canonicalSha256(persistedManifest) !== canonicalSha256(manifest) ||
          expired()
        )
          return { changed: false, value: { outcome: "not-authorized" } };
        if (
          execution.signalScope !== manifest.signalScope ||
          canonicalSha256(execution.sourceIdentity) !== canonicalSha256(sourceIdentity) ||
          canonicalSha256(manifest.sourceIdentity) !== canonicalSha256(sourceIdentity) ||
          sourceIdentity.evidenceEpoch !== expected.evidenceEpoch ||
          sourceIdentity.consentEpoch !== expected.consentEpoch ||
          sourceIdentity.factualWeightsEpoch !== state.factualWeightsEpoch ||
          sourceIdentity.factualWeightsFingerprint !== state.factualWeightsFingerprint ||
          canonicalSha256(eligibleGameIds) !== canonicalSha256(manifest.eligibleGameIds) ||
          deps.validateSourceIdentity === undefined ||
          !(await deps.validateSourceIdentity(collection, sourceIdentity))
        )
          return { changed: false, value: { outcome: "stale", current: currentEpoch(collection) } };
        const settings = state.settings;
        if (
          !settings.enabled ||
          generation.id.length === 0 ||
          generation.manifestDigest !== manifest.digest ||
          generation.modelId !== manifest.modelId ||
          generation.rubricVersion !== manifest.rubricVersion ||
          generation.scoringVersion !== manifest.scoringVersion ||
          generation.signalScope !== manifest.signalScope ||
          canonicalSha256(generation.sourceIdentity) !== canonicalSha256(sourceIdentity) ||
          generation.evidenceEpoch !== expected.evidenceEpoch ||
          generation.consentEpoch !== expected.consentEpoch ||
          !Number.isFinite(Date.parse(generation.publishedAt)) ||
          expired()
        )
          return { changed: false, value: { outcome: "invalid-state" } };

        const expectedPairs = manifest.pairs;
        const canonicalPairs: string[] = [];
        for (let i = 0; i < eligibleGameIds.length; i += 1) {
          for (let j = i + 1; j < eligibleGameIds.length; j += 1) {
            const [gameA, gameB] = [eligibleGameIds[i], eligibleGameIds[j]].sort();
            canonicalPairs.push(`${gameA}\u0000${gameB}`);
          }
        }
        const manifestPairKeys = expectedPairs.map(({ gameA, gameB }) => `${gameA}\u0000${gameB}`);
        if (
          expectedPairs.length !== canonicalPairs.length ||
          new Set(manifestPairKeys).size !== canonicalPairs.length ||
          canonicalSha256([...manifestPairKeys].sort()) !==
            canonicalSha256([...canonicalPairs].sort())
        )
          return { changed: false, value: { outcome: "invalid-state" } };
        const cache = new Map(
          state.pairJudgments.map((pair) => [`${pair.gameA}\u0000${pair.gameB}`, pair]),
        );
        const outcomes: SemanticPairJudgment[] = [];
        const terminalCurrent = (
          signal: SemanticPairJudgment["description"],
          a: Collection["games"][number],
          b: Collection["games"][number],
          description: boolean,
        ) => {
          if (signal === null || (signal.status !== "scored" && signal.status !== "unavailable"))
            return false;
          // Cached outcomes retain their original evaluation contract. A generation may
          // never relabel a judgment produced by another model or rubric.
          if (
            signal.modelId !== manifest.modelId ||
            signal.rubricVersion !== manifest.rubricVersion
          )
            return false;
          if (signal?.status === "scored")
            return description
              ? descriptionJudgmentIsCurrent(
                  signal,
                  a,
                  b,
                  state.settings.cachedOwnerNoteUse || execution.noteTransmissionAuthorized,
                )
              : ownerNoteJudgmentIsCurrent(
                  signal,
                  a,
                  b,
                  state.settings.cachedOwnerNoteUse || execution.noteTransmissionAuthorized,
                );
          if (signal.reason !== "insufficient-evidence") return false;
          const fpA = description
            ? semanticDescriptionSourceFingerprint(a)
            : semanticOwnerNoteSourceFingerprint(a);
          const fpB = description
            ? semanticDescriptionSourceFingerprint(b)
            : semanticOwnerNoteSourceFingerprint(b);
          const contextValid = description
            ? signal.requestContext.kind === "description-only" ||
              (signal.requestContext.kind === "description-and-owner-notes" &&
                signal.requestContext.descriptionFingerprintA ===
                  semanticDescriptionSourceFingerprint(a) &&
                signal.requestContext.descriptionFingerprintB ===
                  semanticDescriptionSourceFingerprint(b))
            : signal.requestContext.kind === "owner-notes-only" ||
              (signal.requestContext.kind === "description-and-owner-notes" &&
                signal.requestContext.descriptionFingerprintA ===
                  semanticDescriptionSourceFingerprint(a) &&
                signal.requestContext.descriptionFingerprintB ===
                  semanticDescriptionSourceFingerprint(b));
          return (
            fpA !== null &&
            fpB !== null &&
            contextValid &&
            signal.sourceFingerprintA === fpA &&
            signal.sourceFingerprintB === fpB
          );
        };
        for (const pair of expectedPairs) {
          const cached = cache.get(`${pair.gameA}\u0000${pair.gameB}`);
          const a = collection.games.find(({ id }) => id === pair.gameA);
          const b = collection.games.find(({ id }) => id === pair.gameB);
          if (!a || !b)
            return {
              changed: false,
              value: { outcome: "stale", current: currentEpoch(collection) },
            };
          let description = settings.weights.description > 0 ? (cached?.description ?? null) : null;
          let ownerNote = settings.weights.ownerNote > 0 ? (cached?.ownerNote ?? null) : null;
          if (
            settings.weights.description > 0 &&
            pair.hasDescriptionA &&
            pair.hasDescriptionB &&
            !terminalCurrent(description, a, b, true)
          )
            return { changed: false, value: { outcome: "invalid-state" } };
          if (settings.weights.description > 0 && (!pair.hasDescriptionA || !pair.hasDescriptionB))
            description = {
              status: "unavailable",
              reason: "missing-source",
              modelId: manifest.modelId,
              rubricVersion: manifest.rubricVersion,
              sourceFingerprintA:
                pair.descriptionFingerprintA ??
                missingFingerprint(manifest.digest, pair.gameA, "C"),
              sourceFingerprintB:
                pair.descriptionFingerprintB ??
                missingFingerprint(manifest.digest, pair.gameB, "C"),
              requestContext: { kind: "description-only", descriptionRepresentationVersion: 1 },
            };
          if (settings.weights.ownerNote > 0 && pair.hasOwnerNoteA && pair.hasOwnerNoteB) {
            const noteWasDisclosed =
              manifest.signalScope !== "description-only" && execution.noteTransmissionAuthorized;
            if (
              !noteWasDisclosed &&
              !(settings.cachedOwnerNoteUse && execution.cachedOwnerNoteUseAuthorized)
            )
              return { changed: false, value: { outcome: "not-authorized" } };
            if (!terminalCurrent(ownerNote, a, b, false))
              return { changed: false, value: { outcome: "invalid-state" } };
          } else if (settings.weights.ownerNote > 0) {
            ownerNote = {
              status: "unavailable",
              reason: "missing-source",
              modelId: manifest.modelId,
              rubricVersion: manifest.rubricVersion,
              sourceFingerprintA:
                pair.noteVersionA === null
                  ? missingFingerprint(manifest.digest, pair.gameA, "D")
                  : semanticOwnerNoteSourceFingerprint(a)!,
              sourceFingerprintB:
                pair.noteVersionB === null
                  ? missingFingerprint(manifest.digest, pair.gameB, "D")
                  : semanticOwnerNoteSourceFingerprint(b)!,
              requestContext: { kind: "owner-notes-only", ownerNoteRepresentationVersion: 1 },
            };
          }
          outcomes.push({ gameA: pair.gameA, gameB: pair.gameB, description, ownerNote });
        }
        const publishedGeneration = {
          ...generation,
          // The caller's input is checked against the frozen manifest above. Always
          // persist the authoritative set, never a field supplied on generation.
          eligibleGameIds: structuredClone(eligibleGameIds),
          weights: structuredClone(settings.weights),
          pairOutcomes: outcomes,
        };
        const parsed = SemanticRedundancyStateSchema.safeParse({
          ...state,
          publishedGeneration,
        });
        if (!parsed.success) return { changed: false, value: { outcome: "invalid-state" } };
        state.publishedGeneration = structuredClone(parsed.data.publishedGeneration);
        execution.status = "completed";
        execution.endedAt = new Date(now()).toISOString();
        state.authorization = { ...authorization, state: "consumed" };
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
        const sameFingerprint = state.factualWeightsFingerprint === fingerprint;
        const semanticWorkExists =
          state.disclosure !== null ||
          state.authorization?.state === "active" ||
          state.publishedGeneration !== null;
        if (sameFingerprint && !semanticWorkExists)
          return {
            changed: false,
            value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
          };
        if (!sameFingerprint && state.factualWeightsEpoch >= Number.MAX_SAFE_INTEGER)
          return { changed: false, value: { outcome: "invalid-state" } };
        if (!sameFingerprint) state.factualWeightsEpoch += 1;
        state.factualWeightsFingerprint = fingerprint;
        fenceActiveRun(collection);
        return {
          changed: true,
          value: { outcome: "accepted", value: undefined, current: currentEpoch(collection) },
        };
      });
    },
  };
}
