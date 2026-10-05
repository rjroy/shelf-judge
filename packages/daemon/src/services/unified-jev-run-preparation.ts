import type { GameWithScore, JevWishlistCandidateSelection } from "@shelf-judge/shared";
import type { JevPairCache } from "./jev-pair-cache-service.js";
import { encodeOwnedLocalMember, encodeWishlistBggMember } from "./jev-pair-identity.js";
import type { JevRunCapture, JevRunCurrentState } from "./jev-run-service.js";
import { createJevRunScopeFromExactPairs, type JevRunScope } from "./jev-run-scope.js";
import type { JevRunSourceAdapter } from "./jev-run-source-adapter.js";
import type { UnifiedScoringService, UnifiedSourceFrame } from "./unified-scoring-service.js";
import type {
  FrozenStagedSimilarityRun,
  StagedPredictionRequest,
  StagedRunBudget,
} from "./staged-similarity-scope.js";
import type { PreparedWishlistRun, FrozenWishlistRunPair } from "./wishlist-run-preparation.js";
import {
  validateWishlistCandidateCOnlyRow,
  type WishlistCandidateMembershipIndex,
} from "./wishlist-candidate-read-proof.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import { stagedRunBudgetIdentity, stagedRunSelectionIdentity } from "./staged-similarity-scope.js";

export interface PreparedUnifiedRun {
  readonly kind: "unified-run";
  readonly scopeKind: "collection" | "wishlist";
  readonly frame: UnifiedSourceFrame;
  readonly capture: JevRunCapture;
  readonly run: FrozenStagedSimilarityRun;
  readonly collectionScope?: JevRunScope;
  readonly wishlistPreparation?: PreparedWishlistRun;
  readonly isSourceCurrent: () => Promise<boolean>;
  readonly isAuthorized: () => boolean;
  readonly beginExecution: () => void;
}

export async function prepareUnifiedJevRun(options: {
  scoring: UnifiedScoringService;
  sourceAdapter: Pick<JevRunSourceAdapter, "readCurrent">;
  cache: JevPairCache;
  request: StagedPredictionRequest;
  budget: StagedRunBudget;
  wishlistSelection?: JevWishlistCandidateSelection;
}): Promise<PreparedUnifiedRun> {
  const wishlist = options.request.scope === "wishlist";
  const frame = await options.scoring.capture({ includeWishlist: wishlist });
  const selection = wishlist
    ? (options.wishlistSelection ?? selectionFromRequest(options.request))
    : undefined;
  const selectedWishlistIds = wishlist
    ? selection?.kind === "all"
      ? frame.wishlistEntries.map((entry) => entry.bggId)
      : (selection?.bggIds ?? [])
    : [];
  const request = wishlist
    ? {
        scope: "wishlist" as const,
        selectedBggIds: selectedWishlistIds.filter(
          (bggId) => !frame.sources.collection.games.some((game) => game.bggId === bggId),
        ),
      }
    : options.request;
  const requestIdentity = stagedRunSelectionIdentity(request);
  const budgetIdentity = stagedRunBudgetIdentity(options.budget);
  const policyIdentity = canonicalSha256({
    source: frame.capture.durableIdentity,
    externalEpoch: frame.externalEpoch,
    wishlistGeneration: frame.wishlistGeneration,
  });
  const authorizationReader = {
    readCurrent() {
      if (!frame.capture.isSourceCurrent()) return null;
      return {
        mutationGeneration: frame.sourceVector.changeToken,
        policyIdentity,
        selectionIdentity: requestIdentity,
        budgetIdentity,
      };
    },
  };
  const result = options.scoring.prepareRun(frame, request, options.budget, authorizationReader);
  const run = result.run;
  const sourceState = await options.sourceAdapter.readCurrent();
  const confirmedSourceState = await options.sourceAdapter.readCurrent();
  if (
    !(await options.scoring.isSourceCurrent(frame)) ||
    !sameSource(sourceState, confirmedSourceState)
  )
    throw new Error("Unified run sources changed during preparation");
  const predictionCapture = frame.sources.collection.games.map((game) => {
    const fitness = result.fitness.get(game.id) ?? null;
    return {
      game,
      score: fitness
        ? {
            score: fitness.score,
            vetoed: fitness.vetoed,
            ratedAxisCount: fitness.ratedAxisCount,
            predictionMeta: fitness.predictionMeta,
          }
        : null,
    } as unknown as GameWithScore;
  });
  const capture: JevRunCapture = Object.freeze({
    collection: frame.sources.collection,
    predictionCapture: Object.freeze(predictionCapture),
    captureIdentity: Object.freeze({
      sourceVectorIdentity: frame.capture.durableIdentity,
      tournamentIdentity: canonicalSha256(frame.sources.tournament),
      predictionCaptureIdentity: canonicalSha256(predictionCapture),
    }),
    factualWeights: frame.redundancySettings.componentWeights,
    sourceVectorIdentity: sourceState.sourceVectorIdentity,
    policyIdentity: sourceState.policyIdentity,
    ...(sourceState.eligibilityIdentity
      ? { eligibilityIdentity: sourceState.eligibilityIdentity }
      : {}),
  });
  const isSourceCurrent = async (): Promise<boolean> => {
    if (!(await options.scoring.isSourceCurrent(frame))) return false;
    const current = await options.sourceAdapter.readCurrent();
    return sameSource(sourceState, current);
  };
  const common = {
    kind: "unified-run" as const,
    scopeKind: wishlist ? ("wishlist" as const) : ("collection" as const),
    frame,
    capture,
    run,
    isSourceCurrent,
    isAuthorized: run.isAuthorized,
    beginExecution: run.beginExecution,
  };
  if (request.scope !== "wishlist") {
    const pairInputs = run.authorizedPairs.flatMap(({ pair, requiredSignals }) =>
      pair.domain === "collection"
        ? [
            {
              gameAId: pair.gameAId,
              gameBId: pair.gameBId,
              descriptionSignalRequired: requiredSignals.includes("C"),
              ownerNoteSignalRequired: requiredSignals.includes("D"),
            },
          ]
        : [],
    );
    return Object.freeze({
      ...common,
      collectionScope: createJevRunScopeFromExactPairs(frame.sources.collection, pairInputs),
    });
  }

  const preparation = createWishlistPreparation({
    frame,
    run,
    capture,
    cache: options.cache,
    selection: selection!,
    isSourceCurrent,
  });
  return Object.freeze({ ...common, wishlistPreparation: preparation });
}

function createWishlistPreparation(options: {
  frame: UnifiedSourceFrame;
  run: FrozenStagedSimilarityRun;
  capture: JevRunCapture;
  cache: JevPairCache;
  selection: JevWishlistCandidateSelection;
  isSourceCurrent: () => Promise<boolean>;
}): PreparedWishlistRun {
  const selected = new Set(
    options.selection.kind === "all"
      ? options.frame.wishlistEntries.map((entry) => entry.bggId)
      : options.selection.bggIds,
  );
  const entries = options.frame.wishlistEntries.filter((entry) => selected.has(entry.bggId));
  const entriesByBggId = new Map(entries.map((entry) => [entry.bggId, entry]));
  const exactPairs = options.run.authorizedPairs.flatMap(({ pair, requiredSignals }) =>
    pair.domain === "wishlist-candidate"
      ? [{ pair, requiresDescription: requiredSignals.includes("C") }]
      : [],
  );
  const candidateBggIds = new Set(entries.map((entry) => entry.bggId));
  const referenceIds = new Set(exactPairs.map(({ pair }) => pair.ownedGameId));
  const membership: WishlistCandidateMembershipIndex = {
    candidateBggIds,
    eligibleOwnedIds: referenceIds,
  };
  const ownedById = new Map(options.capture.collection.games.map((game) => [game.id, game]));
  const pairs: FrozenWishlistRunPair[] = exactPairs.map(({ pair, requiresDescription }) => {
    const entry = entriesByBggId.get(pair.candidateBggId);
    const owned = ownedById.get(pair.ownedGameId);
    if (!entry || !owned) throw new Error("Frozen wishlist run pair lost a captured endpoint");
    const candidateMember = encodeWishlistBggMember(
      options.capture.collection.id,
      String(entry.bggId),
    );
    const ownedMember = encodeOwnedLocalMember(options.capture.collection.id, owned.id);
    const row = options.cache.lookup({
      gameAId: candidateMember,
      gameBId: ownedMember,
      signal: "C",
      pairDomain: "wishlist-candidate",
    });
    const proof = validateWishlistCandidateCOnlyRow(
      row,
      options.capture.collection.id,
      {
        candidate: { bggId: entry.bggId, name: entry.name, bggSource: entry.bggSource! },
        ownedGame: {
          id: owned.id,
          bggId: owned.bggId,
          name: owned.name,
          description: owned.bggData?.description ?? null,
        },
      },
      membership,
    );
    const candidateDescription = entry.bggSource?.description;
    const usable =
      requiresDescription &&
      typeof candidateDescription === "string" &&
      candidateDescription.trim().length > 0 &&
      typeof owned.bggData?.description === "string" &&
      owned.bggData.description.trim().length > 0;
    return Object.freeze({
      candidateEntryId: entry.id,
      candidateBggId: entry.bggId,
      ownedGameId: owned.id,
      gameAId: candidateMember,
      gameBId: ownedMember,
      state: proof.valid ? "cached-hit" : usable ? "sendable-miss" : "unavailable",
      cachedValue: proof.valid ? proof.value : null,
    });
  });
  const unavailableCandidateBggIds = options.run.disclosure.unavailableTargetIds.flatMap((id) => {
    const value = Number(id);
    return Number.isSafeInteger(value) && value > 0 ? [value] : [];
  });
  const eligibleOwnedIds = Object.freeze(
    [
      ...new Set(
        options.run.redundancyPairs.flatMap(({ pair }) =>
          pair.domain === "wishlist-candidate" ? [pair.ownedGameId] : [],
        ),
      ),
    ].sort(),
  );
  const allEntries = options.frame.wishlistEntries.length;
  const selectedCount = entries.length;
  const requestedCount = entries.filter(
    (entry) => !options.capture.collection.games.some((game) => game.bggId === entry.bggId),
  ).length;
  const ownedOverlap = selectedCount - requestedCount;
  const disclosure = Object.freeze({
    scope: "wishlist" as const,
    wishlistEntryCount: allEntries,
    selectedCandidateCount: selectedCount,
    unselectedEntryCount: allEntries - selectedCount,
    ownedOverlapCandidateCount: ownedOverlap,
    requestedCandidateCount: requestedCount,
    eligibleCandidateCount: options.run.targets.filter((target) => target.kind === "wishlist")
      .length,
    unavailableCandidateCount: unavailableCandidateBggIds.length,
    eligibleOwnedGameCount: eligibleOwnedIds.length,
    comparisonPairCount: pairs.length,
    cachedHitPairCount: pairs.filter((pair) => pair.state === "cached-hit").length,
    sendablePairCount: pairs.filter((pair) => pair.state === "sendable-miss").length,
  });
  const prep: PreparedWishlistRun = {
    scope: "wishlist",
    selection: options.selection,
    selectionIdentity: canonicalSha256(options.selection),
    capture: options.capture,
    entries: Object.freeze(entries),
    unavailableCandidateBggIds: Object.freeze(unavailableCandidateBggIds),
    eligibleOwnedIds,
    pairs: Object.freeze(pairs),
    disclosure,
    cacheRevision: null,
    wishlistMutationGeneration: options.frame.wishlistGeneration,
    identity: options.run.disclosure.authorizationIdentity,
    unifiedRun: options.run,
    isSourceCurrent: options.isSourceCurrent,
    isCurrent: options.isSourceCurrent,
  };
  return Object.freeze(prep);
}

function sameSource(left: JevRunCurrentState, right: JevRunCurrentState): boolean {
  return (
    left.sourceVectorIdentity === right.sourceVectorIdentity &&
    left.policyIdentity === right.policyIdentity &&
    left.eligibilityIdentity === right.eligibilityIdentity &&
    left.canTransmitNotes === right.canTransmitNotes
  );
}

function selectionFromRequest(request: StagedPredictionRequest): JevWishlistCandidateSelection {
  if (request.scope !== "wishlist") throw new TypeError("Wishlist run needs wishlist selection");
  return Object.freeze({ kind: "selected", bggIds: Object.freeze([...request.selectedBggIds]) });
}
