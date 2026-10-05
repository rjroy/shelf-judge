import { describe, expect, test } from "bun:test";
import type { Axis, Collection, DurableGame, TournamentData } from "@shelf-judge/shared";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";
import { canonicalSha256 } from "../../src/services/profile-source-coordinator.js";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../../src/services/redundancy-engine.js";
import { captureSimilaritySettings } from "../../src/services/unified-similarity.js";
import type { SourceVector } from "../../src/services/source-vector.js";
import { captureStagedSimilaritySources } from "../../src/services/staged-similarity-capture.js";
import type {
  StagedSimilaritySources,
  StagedWishlistCandidateSource,
} from "../../src/services/staged-similarity-capture.js";
import { createPreparedSimilarity } from "../../src/services/prepared-similarity.js";
import {
  deriveStagedActualAxisContext,
  prepareStagedSimilarityScope,
  stagedRunBudgetIdentity,
  stagedRunSelectionIdentity,
} from "../../src/services/staged-similarity-scope.js";
import type {
  InjectedFitnessInput,
  StagedSimilarityScopeObserver,
  StagedRunAuthorizationState,
  StagedRunBudget,
  StagedPredictionRequest,
} from "../../src/services/staged-similarity-scope.js";

const NOW = "2026-10-04T00:00:00.000Z";
const BUDGET: StagedRunBudget = {
  maxProviderAttempts: 1000,
  reportedTokenStopThreshold: 2_000_000,
  maxRunDurationMs: 30 * 60_000,
};

function game(
  id: string,
  options: {
    ownership?: "owned" | "previously-owned";
    personal?: number;
    bgg?: boolean;
  } = {},
): DurableGame {
  return {
    id,
    bggId: Number(id.replace(/\D/g, "")) || 100,
    name: `Game ${id}`,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
    imageUrl: null,
    bggData:
      options.bgg === false
        ? null
        : {
            communityRating: 7,
            bayesAverage: 7,
            weight: 2.5,
            numWeightVotes: 0,
            description: `Description ${id}`,
            mechanics: [{ id: 1, name: "Drafting" }],
            categories: [{ id: 2, name: "Strategy" }],
            families: [],
            subdomains: [],
            bestPlayerCount: null,
            fetchedAt: NOW,
          },
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    entityMetadata: { status: "unknown" },
    latestPlayCountCheck: null,
    ownership: options.ownership ?? "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: options.personal === undefined ? {} : { personal: options.personal },
    createdAt: NOW,
    updatedAt: NOW,
    ownerNote: { state: "missing", version: 0, updatedAt: null },
  } as unknown as DurableGame;
}

function axis(id: string, source: "personal" | "tournament"): Axis {
  return {
    id,
    name: id,
    description: null,
    weight: 1,
    enabled: true,
    source,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface FixtureOptions {
  games?: DurableGame[];
  axes?: Axis[];
  wishlistCandidates?: readonly StagedWishlistCandidateSource[];
  tournament?: TournamentData;
}

function sources(options: FixtureOptions = {}): StagedSimilaritySources {
  const semanticBase = createInitialSemanticRedundancyStateV10();
  const semanticSettings = {
    ...semanticBase.settings,
    enabled: true,
    weights: { factual: 1, description: 1, ownerNote: 0 },
    cachedOwnerNoteUse: false,
  };
  const semantic = {
    ...semanticBase,
    settings: semanticSettings,
    evidenceEpoch: 2,
    consentEpoch: 3,
    ownerNoteConsentEpoch: 3,
    factualWeightsEpoch: 4,
    factualWeightsFingerprint: "factual-fingerprint",
  };
  const collection = {
    id: "scope-collection",
    name: "Scope fixture",
    schemaVersion: 10,
    revision: 1,
    axes: options.axes ?? [axis("personal", "personal")],
    games: options.games ?? [game("target"), game("ref-a", { personal: 8 })],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: semantic,
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as Collection;
  const similaritySettings = captureSimilaritySettings(
    DEFAULT_REDUNDANCY_SETTINGS,
    semanticSettings,
  );
  const sourceVector: SourceVector = {
    available: true,
    unavailableSources: [],
    processEpoch: "scope-process",
    changeToken: 1,
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    semanticEvidenceEpoch: semantic.evidenceEpoch,
    semanticConsentEpoch: semantic.consentEpoch,
    factualWeightsEpoch: semantic.factualWeightsEpoch,
    factualWeightsFingerprint: semantic.factualWeightsFingerprint,
    redundancyWeightsFingerprint: canonicalSha256(similaritySettings.factual),
    tournamentRevision: 2,
    predictionSettingsRevision: 3,
    nicheSettingsRevision: 4,
    redundancySettingsRevision: 5,
    shelfConfigRevision: 6,
    representationVersion: 1,
    algorithmVersion: 1,
  };
  return {
    collection,
    tournament: options.tournament ?? {
      settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
      sessions: [],
      gameStats: {},
    },
    predictionSettings: { stageThresholds: [5, 15, 30], defaultK: 5, minSimilarityThreshold: 0.2 },
    similaritySettings,
    sourceVector,
    wishlistCandidates: options.wishlistCandidates,
  };
}

function setup(
  current: StagedSimilaritySources,
  request: StagedPredictionRequest,
  evaluator: (
    input: InjectedFitnessInput,
  ) => ReadonlyMap<string, { score: number | null; vetoed: boolean }>,
  observer?: StagedSimilarityScopeObserver,
  includeOwnedPredictionDependenciesForWishlist = false,
) {
  const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
  let cacheRevision = 1;
  let cacheLookups = 0;
  const prepared = createPreparedSimilarity({
    capture,
    cache: {
      available: true,
      mutationRevision: () => cacheRevision,
      lookup: () => {
        cacheLookups++;
        return null;
      },
    },
  });
  const authState: StagedRunAuthorizationState = {
    mutationGeneration: 10,
    policyIdentity: "policy-v1",
    selectionIdentity: stagedRunSelectionIdentity(request),
    budgetIdentity: stagedRunBudgetIdentity(BUDGET),
  };
  const result = prepareStagedSimilarityScope({
    capture,
    prepared,
    request,
    budget: BUDGET,
    authorizationReader: { readCurrent: () => authState },
    evaluateFitness: evaluator,
    includeOwnedPredictionDependenciesForWishlist,
    observer,
  });
  return {
    result,
    prepared,
    authState,
    setCacheRevision: (value: number) => (cacheRevision = value),
    getCacheLookups: () => cacheLookups,
  };
}

describe("staged similarity scope and frozen authorization", () => {
  test("shared readiness uses the tournament cohort floor", () => {
    const stats = Object.fromEntries(
      ["target", "ref-a", "ref-b"].map((id) => [id, { eloRating: 1500, comparisonCount: 1 }]),
    );
    const current = sources({
      axes: [axis("tournament", "tournament")],
      tournament: {
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
        sessions: [],
        gameStats: stats,
      } as unknown as TournamentData,
    });
    current.predictionSettings.stageThresholds = [2, 3, 4];
    const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
    const actual = deriveStagedActualAxisContext(capture);
    if (!actual) throw new Error("Actual-axis context unavailable");
    expect(actual?.references).toEqual([]);
    expect(actual?.readiness).toEqual({
      ratedGameCount: 0,
      stage: 0,
      stageThresholds: [2, 3, 4],
    });
    expect(actual.readiness.stageThresholds[0] - actual.readiness.ratedGameCount).toBe(2);
  });

  test("builds exact per-axis P, includes previously-owned and vetoed actual refs, and derives current-owned R", () => {
    const current = sources({
      axes: [axis("personal", "personal"), axis("tournament", "tournament")],
      games: [
        game("target"),
        game("owned-a", { personal: 7 }),
        game("previous-b", { ownership: "previously-owned", personal: 9 }),
        game("owned-c"),
        game("owned-d", { personal: 4 }),
      ],
      tournament: {
        settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
        sessions: [],
        gameStats: {
          "owned-a": { eloRating: 1600, comparisonCount: 2 },
          "owned-c": { eloRating: 1450, comparisonCount: 2 },
          target: { eloRating: 1500, comparisonCount: 0 },
          "previous-b": { eloRating: 1550, comparisonCount: 0 },
          "owned-d": { eloRating: 1500, comparisonCount: 0 },
        },
      } as unknown as TournamentData,
    });
    // The tournament cohort floor is five; add valid comparison-bearing source rows.
    const stats = current.tournament.gameStats as Record<
      string,
      { eloRating: number; comparisonCount: number }
    >;
    for (let i = 0; i < 5; i++) stats[`cohort-${i}`] = { eloRating: 1500, comparisonCount: 1 };
    current.collection.games.push(
      ...Array.from({ length: 5 }, (_, index) => game(`cohort-${index}`, { bgg: false })),
    );
    current.collection.revision++;
    current.sourceVector.collectionRevision = current.collection.revision;

    const setupResult = setup(
      current,
      { scope: "collection-targets", targetIds: ["target"] },
      (input) => {
        expect(input.targets.map((target) => target.id)).toEqual(["target"]);
        const labels = new Map(input.axisPairs.map((item) => [item.referenceGameId, item.axisId]));
        // Pair overlap is deduplicated while the actual per-axis references remain present.
        expect(input.axisPairs).toHaveLength(10);
        expect(labels.get("owned-a")).toBeDefined();
        expect(labels.get("previous-b")).toBe("personal");
        expect(labels.get("owned-c")).toBe("tournament");
        expect(input.pairSimilarities.size).toBe(9);
        return new Map([
          ["owned-a", { score: 0.8, vetoed: false }],
          ["owned-c", { score: 0.6, vetoed: false }],
          ["owned-d", { score: 0.9, vetoed: true }],
          ["previous-b", { score: 1, vetoed: false }],
        ]);
      },
    );
    expect(setupResult.result.ok).toBe(true);
    if (!setupResult.result.ok) return;
    const run = setupResult.result.run;
    expect(run.readiness).toEqual({ ratedGameCount: 9, stage: 1, stageThresholds: [5, 15, 30] });
    expect(run.predictionPairs.map((entry) => entry.key)).toHaveLength(9);
    expect(run.predictionPairs.some((entry) => entry.key.includes("previous-b"))).toBe(true);
    expect(run.redundancyPairs.map((entry) => entry.key)).toHaveLength(1);
    expect(run.redundancyPairs[0]?.key).toContain("owned-a");
    expect(run.redundancyPairs[0]?.key).toContain("owned-c");
    expect(run.redundancyPairs.some((entry) => entry.key.includes("owned-d"))).toBe(false);
    expect(run.disclosure.previousOwnedReferenceIds).toContain("previous-b");
    expect(run.disclosure.overlapPairCount).toBe(0);
    expect(run.disclosure.authorizedPairCount).toBe(10);
  });

  test("retains actual rated but unscored and vetoed sources in P, while excluding self and rated targets", () => {
    const current = sources({
      games: [
        game("target"),
        game("ref", { personal: 7 }),
        game("vetoed", { personal: 3 }),
        game("already", { personal: 8 }),
      ],
    });
    const { result } = setup(
      current,
      { scope: "collection-targets", targetIds: ["target", "already"] },
      () =>
        new Map([
          ["ref", { score: 0.5, vetoed: false }],
          ["vetoed", { score: 0, vetoed: true }],
        ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.targets.map((target) => target.id)).toEqual(["target"]);
    expect(result.run.predictionPairs.map((pair) => pair.key)).toHaveLength(3);
    expect(result.run.predictionPairs.some((pair) => pair.key.includes("vetoed"))).toBe(true);
    expect(
      result.run.predictionPairs.every((pair) => !pair.key.includes('"target","target"')),
    ).toBe(true);
    expect(result.run.disclosure.unavailableTargetIds).toEqual([]);
  });

  test("freezes exact wishlist selection and authorizes only wishlist-domain C_ONLY P/R pairs", () => {
    const candidate = {
      bggId: 901,
      name: "Wishlist game",
      bggSource: {
        minPlayers: 2,
        maxPlayers: 4,
        bestPlayers: 3,
        playingTime: 60,
        weight: 2,
        communityRating: 7,
        categories: ["Strategy"],
        mechanics: ["Drafting"],
        description: "Wishlist description",
      },
    } as StagedWishlistCandidateSource;
    const current = sources({
      wishlistCandidates: [candidate],
      games: [
        game("local-a", { personal: 7 }),
        game("local-old", { ownership: "previously-owned", personal: 9 }),
      ],
    });
    let injectedWishlistPair:
      | { domain: "wishlist-candidate"; candidateBggId: number; ownedGameId: string }
      | undefined;
    let injectedWishlistPairKey: string | undefined;
    let wishlistMutationResult: boolean | undefined;
    const { result } = setup(
      current,
      { scope: "wishlist", selectedBggIds: [901, 902] },
      (input) => {
        expect(input.pairSimilarities.size).toBe(2);
        const pair = input.axisPairs[0]?.pair;
        if (!pair || pair.domain !== "wishlist-candidate")
          throw new Error("expected wishlist pair");
        injectedWishlistPair = Object.freeze({ ...pair });
        injectedWishlistPairKey = JSON.stringify([
          "wishlist-candidate",
          pair.candidateBggId,
          pair.ownedGameId,
        ]);
        wishlistMutationResult = Reflect.set(
          pair as unknown as Record<string, unknown>,
          "candidateBggId",
          777,
        );
        expect(wishlistMutationResult).toBe(false);
        expect(pair).toEqual(injectedWishlistPair);
        return new Map([
          ["local-a", { score: 0.8, vetoed: false }],
          ["local-old", { score: 0.7, vetoed: false }],
        ]);
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const run = result.run;
    expect(run.targets.map((target) => target.id)).toEqual(["wishlist:901"]);
    expect(run.disclosure.unavailableTargetIds).toEqual(["902"]);
    expect(run.predictionPairs.every((entry) => entry.pair.domain === "wishlist-candidate")).toBe(
      true,
    );
    expect(run.redundancyPairs.every((entry) => entry.pair.domain === "wishlist-candidate")).toBe(
      true,
    );
    expect(run.authorizedPairs.every((entry) => entry.requiredSignals.join("") === "C")).toBe(true);
    expect(run.authorizedPairs.some((entry) => "gameAId" in entry.pair)).toBe(false);
    expect(run.authorizedPairs.every((entry) => Object.isFrozen(entry.pair))).toBe(true);
    if (!injectedWishlistPair || !injectedWishlistPairKey) return;
    expect(run.predictionPairs[0]?.key).toBe(injectedWishlistPairKey);
    expect(run.predictionPairs[0]?.pair).toEqual(injectedWishlistPair);
    expect(
      run.authorizedPairs.find((entry) => entry.key === injectedWishlistPairKey)?.pair,
    ).toEqual(injectedWishlistPair);
    expect(wishlistMutationResult).toBe(false);
    const wishlistAuthorizationIdentity = run.disclosure.authorizationIdentity;
    const authorizedWishlistPair = run.authorizedPairs[0]?.pair;
    expect(authorizedWishlistPair).toBeDefined();
    if (!authorizedWishlistPair) return;
    expect(
      Reflect.set(
        authorizedWishlistPair as unknown as Record<string, unknown>,
        "candidateBggId",
        777,
      ),
    ).toBe(false);
    expect(authorizedWishlistPair).toEqual(injectedWishlistPair);
    expect(run.disclosure.authorizationIdentity).toBe(wishlistAuthorizationIdentity);
    expect(run.isAuthorized()).toBe(true);
    expect(run.disclosure.previousOwnedReferenceIds).toContain("local-old");
  });

  test("keeps owned-fitness cache dependencies outside wishlist-authorized P/R/U0", () => {
    const candidate: StagedWishlistCandidateSource = {
      bggId: 901,
      name: "Candidate",
      bggSource: {
        observedAt: NOW,
        description: "Candidate description",
        mechanics: ["Drafting"],
        categories: ["Strategy"],
        weight: 2,
        communityRating: 7,
        minPlayers: 2,
        maxPlayers: 4,
        bestPlayers: 3,
        playingTime: 60,
      },
    };
    let current = sources({
      wishlistCandidates: [candidate],
      games: [
        game("owned-target"),
        game("owned-new", { bgg: true }),
        game("ref-a", { personal: 7 }),
        game("ref-b", { personal: 8 }),
      ],
    });
    const semantic = current.collection.semanticRedundancy;
    if (!semantic) throw new Error("Semantic settings fixture missing");
    const semanticSettings = {
      ...semantic.settings,
      weights: { ...semantic.settings.weights, ownerNote: 1 },
      cachedOwnerNoteUse: true,
    };
    current = {
      ...current,
      collection: {
        ...current.collection,
        semanticRedundancy: { ...semantic, settings: semanticSettings },
      },
      similaritySettings: captureSimilaritySettings(DEFAULT_REDUNDANCY_SETTINGS, semanticSettings),
    };
    const fitnessInputs: InjectedFitnessInput[] = [];
    const runResult = setup(
      current,
      { scope: "wishlist", selectedBggIds: [901] },
      (input) => {
        fitnessInputs.push(input);
        return new Map([
          ["owned-target", { score: 6, vetoed: false }],
          ["owned-new", { score: null, vetoed: false }],
          ["ref-a", { score: 7, vetoed: false }],
          ["ref-b", { score: 8, vetoed: false }],
        ]);
      },
      undefined,
      true,
    );
    expect(runResult.result.ok).toBe(true);
    if (!runResult.result.ok) return;
    const { run } = runResult.result;
    const fitnessInput = fitnessInputs[0];
    if (!fitnessInput) throw new Error("Wishlist fitness input was not captured");
    expect(run.predictionPairs.length).toBeGreaterThan(0);
    expect(run.targets.every((target) => target.kind === "wishlist")).toBe(true);
    expect(run.predictionPairs.every((pair) => pair.pair.domain === "wishlist-candidate")).toBe(
      true,
    );
    expect(
      run.predictionPairs.every(
        (pair) => pair.pair.domain === "wishlist-candidate" && pair.pair.candidateBggId === 901,
      ),
    ).toBe(true);
    expect(fitnessInput.axisPairs.every((pair) => pair.pair.domain === "wishlist-candidate")).toBe(
      true,
    );
    expect(
      fitnessInput.calculationDependencyPairs.every((pair) => pair.pair.domain === "collection"),
    ).toBe(true);
    expect(
      fitnessInput.calculationDependencyPairs.some(
        (pair) =>
          pair.targetIds.includes("owned-target") &&
          pair.axisReferences.some((reference) => reference.referenceGameId === "ref-a"),
      ),
    ).toBe(true);
    expect(
      fitnessInput.calculationDependencyPairs.some((pair) => pair.targetIds.includes("owned-new")),
    ).toBe(true);
    expect(
      fitnessInput.calculationDependencyPairs.every((pair) => pair.requiredSignals.includes("D")),
    ).toBe(true);
    expect(fitnessInput.calculationDependencySimilarities.size).toBe(
      fitnessInput.calculationDependencyPairs.length,
    );
    expect(run.redundancyPairs.every((pair) => pair.pair.domain === "wishlist-candidate")).toBe(
      true,
    );
    expect(
      run.redundancyPairs.every(
        (pair) => pair.pair.domain === "wishlist-candidate" && pair.pair.candidateBggId === 901,
      ),
    ).toBe(true);
    expect(
      run.redundancyPairs
        .map((pair) =>
          pair.pair.domain === "wishlist-candidate" ? pair.pair.ownedGameId : "unexpected",
        )
        .sort(),
    ).toEqual(["owned-target", "ref-a", "ref-b"]);
    expect(run.authorizedPairs.every((pair) => pair.pair.domain === "wishlist-candidate")).toBe(
      true,
    );
    expect(
      run.authorizedPairs.every(
        (pair) => pair.pair.domain === "wishlist-candidate" && pair.pair.candidateBggId === 901,
      ),
    ).toBe(true);
    expect(run.disclosure.requestedTargetIds).toEqual(["901"]);
    expect(run.disclosure.targetIds).toEqual(["wishlist:901"]);
    expect(run.disclosure.requiredSignals).not.toContain("D");
    expect(run.disclosure.pPairCount).toBe(run.predictionPairs.length);
    expect(run.disclosure.authorizedPairCount).toBe(3);
    expect(run.disclosure.cacheHits).toBe(0);
    expect(run.disclosure.cacheMisses).toBe(3);
    expect(run.authorizedPairs.length).toBe(
      run.predictionPairs.length +
        run.redundancyPairs.filter(
          (pair) => !run.predictionPairs.some((predicted) => predicted.key === pair.key),
        ).length,
    );
    const ownedDependency = fitnessInput.calculationDependencyPairs[0];
    if (!ownedDependency) throw new Error("Owned cache-only dependency was not demanded");
    const proof = runResult.prepared.sealProof();
    const dependencyEvidence = runResult.prepared.evidence(ownedDependency.pair);
    expect(dependencyEvidence).not.toBeNull();
    expect(dependencyEvidence?.description.state).toBe("missing-row");
    expect(dependencyEvidence?.ownerNote.state).toBe("missing-source");
    expect(proof.demandedPairsIdentity).not.toBe("");
    expect(proof.examinedComponentsIdentity).not.toBe("");
    expect(runResult.prepared.resolvedPairCount).toBe(7);
    expect(runResult.getCacheLookups()).toBe(7);
    expect(runResult.prepared.isSealed).toBe(true);
    runResult.setCacheRevision(2);
    expect(run.isAuthorized()).toBe(true);
    expect(run.isCalculationCurrent()).toBe(false);
    expect(run.authorizedPairs.every((pair) => pair.pair.domain === "wishlist-candidate")).toBe(
      true,
    );
    expect(run.authorizedPairs).toHaveLength(3);

    const nextPreview = setup(
      current,
      { scope: "wishlist", selectedBggIds: [901] },
      () =>
        new Map([
          ["owned-target", { score: 6, vetoed: false }],
          ["owned-new", { score: 5, vetoed: false }],
          ["ref-a", { score: 7, vetoed: false }],
          ["ref-b", { score: 8, vetoed: false }],
        ]),
      undefined,
      true,
    );
    expect(nextPreview.result.ok).toBe(true);
    if (!nextPreview.result.ok) return;
    expect(
      nextPreview.result.run.redundancyPairs.some(
        (pair) =>
          pair.pair.domain === "wishlist-candidate" && pair.pair.ownedGameId === "owned-new",
      ),
    ).toBe(true);
    expect(nextPreview.result.run.authorizedPairs).toHaveLength(4);
    expect(run.authorizedPairs).toHaveLength(3);
  });

  test("deduplicates P∪R, seals resolver and freezes selected membership without cache-based expansion", () => {
    const current = sources({
      games: [game("target"), game("owned-a", { personal: 7 }), game("owned-b", { personal: 8 })],
    });
    let liveAuth: StagedRunAuthorizationState | null = null;
    const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
    let cacheRevision = 1;
    const prepared = createPreparedSimilarity({
      capture,
      cache: { available: true, mutationRevision: () => cacheRevision, lookup: () => null },
    });
    const targetIds = ["target"];
    const request: StagedPredictionRequest = { scope: "collection-targets", targetIds };
    const budget = { ...BUDGET };
    liveAuth = {
      mutationGeneration: 11,
      policyIdentity: "policy",
      selectionIdentity: stagedRunSelectionIdentity(request),
      budgetIdentity: stagedRunBudgetIdentity(budget),
    };
    const result = prepareStagedSimilarityScope({
      capture,
      prepared,
      request,
      budget,
      authorizationReader: { readCurrent: () => liveAuth },
      evaluateFitness: () =>
        new Map([
          ["target", { score: 0.9, vetoed: false }],
          ["owned-a", { score: 0.7, vetoed: false }],
        ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.disclosure.overlapPairCount).toBe(1);
    expect(result.run.disclosure.authorizedPairCount).toBe(2);
    targetIds.push("owned-b");
    budget.maxProviderAttempts = 2;
    expect(result.run.targets.map((target) => target.id)).toEqual(["target"]);
    expect(result.run.disclosure.budget.maxProviderAttempts).toBe(1000);
    expect(prepared.isSealed).toBe(true);
    expect(() =>
      prepared.resolvePairs([{ domain: "collection", gameAId: "owned-a", gameBId: "owned-b" }]),
    ).toThrow("sealed");
    expect(Object.isFrozen(result.run.authorizedPairs)).toBe(true);
    expect(() => (result.run.authorizedPairs as unknown[]).push({})).toThrow();
    cacheRevision++;
    expect(prepared.isCurrent()).toBe(false);
    expect(result.run.isCalculationCurrent()).toBe(false);
    expect(result.run.isAuthorized()).toBe(true); // Cache growth is not authority expansion/revocation.
    expect(result.run.authorizedPairs).toHaveLength(2);
    const nextPreview = setup(
      current,
      request,
      () =>
        new Map([
          ["target", { score: 0.9, vetoed: false }],
          ["owned-a", { score: 0.7, vetoed: false }],
          ["owned-b", { score: 0.8, vetoed: false }],
        ]),
    );
    expect(nextPreview.result.ok).toBe(true);
    if (nextPreview.result.ok) expect(nextPreview.result.run.authorizedPairs).toHaveLength(3);
    result.run.beginExecution();
    expect(result.run.isExecutionStarted()).toBe(true);
    expect(() => result.run.beginExecution()).toThrow("one-use");
  });

  test("deep-freezes nested prediction pairs during fitness evaluation and in every returned scope", () => {
    const current = sources({
      games: [game("target"), game("reference", { personal: 7, bgg: false })],
    });
    let callbackPairKey: string | undefined;
    let callbackPairSnapshot:
      | { readonly domain: "collection"; readonly gameAId: string; readonly gameBId: string }
      | undefined;
    let callbackSimilarity: number | null | undefined;
    let mutationAttemptResult: boolean | undefined;
    const scoped = setup(current, { scope: "predict-game", gameId: "target" }, (input) => {
      const axisPair = input.axisPairs[0];
      expect(axisPair).toBeDefined();
      if (!axisPair) return new Map();
      const pair = axisPair.pair;
      if (pair.domain !== "collection") throw new Error("expected a collection pair");
      const pairKey = JSON.stringify(["collection", ...[pair.gameAId, pair.gameBId].sort()]);
      callbackPairKey = pairKey;
      callbackPairSnapshot = Object.freeze({ ...pair });
      callbackSimilarity = input.pairSimilarities.get(pairKey);
      expect(Object.isFrozen(axisPair)).toBe(true);
      expect(Object.isFrozen(pair)).toBe(true);
      mutationAttemptResult = Reflect.set(
        pair as unknown as Record<string, unknown>,
        "gameAId",
        "unapproved-member",
      );
      expect(mutationAttemptResult).toBe(false);
      expect(pair).toEqual(callbackPairSnapshot);
      expect(input.pairSimilarities.get(pairKey)).toBeNull();
      return new Map([["reference", { score: 0.8, vetoed: false }]]);
    });
    expect(scoped.result.ok).toBe(true);
    if (!scoped.result.ok) return;
    const run = scoped.result.run;
    const predictionPair = run.predictionPairs[0];
    const authorizedPair = run.authorizedPairs.find((entry) => entry.key === predictionPair?.key);
    expect(predictionPair).toBeDefined();
    expect(authorizedPair).toBeDefined();
    if (!predictionPair || !authorizedPair) return;
    const predictionAxisPair = predictionPair.axisReferences[0];
    const authorizedAxisPair = authorizedPair.axisReferences[0];
    expect(predictionAxisPair).toBeDefined();
    expect(authorizedAxisPair).toBeDefined();
    if (!predictionAxisPair || !authorizedAxisPair) return;
    if (
      predictionAxisPair.pair.domain !== "collection" ||
      authorizedAxisPair.pair.domain !== "collection" ||
      !callbackPairKey ||
      !callbackPairSnapshot
    ) {
      return;
    }
    expect(Object.isFrozen(predictionAxisPair.pair)).toBe(true);
    expect(Object.isFrozen(authorizedAxisPair.pair)).toBe(true);
    expect(predictionAxisPair.pair).toEqual(callbackPairSnapshot);
    expect(authorizedAxisPair.pair).toEqual(callbackPairSnapshot);
    expect(predictionPair.key).toBe(callbackPairKey);
    expect(authorizedPair.key).toBe(callbackPairKey);
    expect(mutationAttemptResult).toBe(false);
    const authorizationIdentity = run.disclosure.authorizationIdentity;
    expect(Reflect.set(predictionAxisPair.pair, "gameBId", "unapproved-reference")).toBe(false);
    expect(run.disclosure.authorizationIdentity).toBe(authorizationIdentity);
    expect(run.isAuthorized()).toBe(true);
    expect(predictionAxisPair.pair).toEqual(callbackPairSnapshot);
    expect(callbackSimilarity).toBeNull();
  });

  test("source, selection, policy, budget and monotonic generation changes invalidate frozen authorization", () => {
    const current = sources();
    const request: StagedPredictionRequest = { scope: "collection-targets", targetIds: ["target"] };
    const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
    const prepared = createPreparedSimilarity({
      capture,
      cache: { available: false, mutationRevision: () => null, lookup: () => null },
    });
    let auth: StagedRunAuthorizationState = {
      mutationGeneration: 1,
      policyIdentity: "policy-a",
      selectionIdentity: stagedRunSelectionIdentity(request),
      budgetIdentity: stagedRunBudgetIdentity(BUDGET),
    };
    const result = prepareStagedSimilarityScope({
      capture,
      prepared,
      request,
      budget: BUDGET,
      authorizationReader: { readCurrent: () => auth },
      evaluateFitness: () => new Map(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.isAuthorized()).toBe(true);
    current.sourceVector.changeToken++;
    expect(result.run.isAuthorized()).toBe(false);
    current.sourceVector.changeToken--;
    auth = { ...auth, policyIdentity: "policy-b" };
    expect(result.run.isAuthorized()).toBe(false);
    auth = { ...auth, selectionIdentity: "different-selection" };
    expect(result.run.isAuthorized()).toBe(false);
    auth = { ...auth, budgetIdentity: "different-budget" };
    expect(result.run.isAuthorized()).toBe(false);
    auth = { ...auth, mutationGeneration: 2 };
    expect(result.run.isAuthorized()).toBe(false); // A→B→A source changes still advance generation.
    expect(() => result.run.assertAuthorized()).toThrow("stale");
  });

  test("full collection and single-game scopes exclude previously-owned targets and count missing targets", () => {
    const current = sources({
      games: [
        game("target"),
        game("previous", { ownership: "previously-owned" }),
        game("rated", { personal: 7 }),
      ],
    });
    const all = setup(current, { scope: "collection-all" }, () => new Map());
    expect(all.result.ok).toBe(true);
    if (all.result.ok)
      expect(all.result.run.targets.map((target) => target.id)).toEqual(["target"]);
    const single = setup(current, { scope: "predict-game", gameId: "absent" }, () => new Map());
    expect(single.result.ok).toBe(true);
    if (single.result.ok)
      expect(single.result.run.disclosure.unavailableTargetIds).toEqual(["absent"]);
  });

  test("indexes axis-rated references once and resolves demanded collection pairs through cache-only reads", () => {
    const refs = Array.from({ length: 48 }, (_, index) =>
      game(`ref-${String(index).padStart(2, "0")}`, { personal: index + 1 }),
    );
    const current = sources({ games: [game("target"), ...refs] });
    const stats = { builds: 0, memberships: 0, lookups: 0, visited: 0 };
    const observer: StagedSimilarityScopeObserver = {
      onAxisReferenceIndexBuilt: (_axisCount, membershipCount) => {
        stats.builds++;
        stats.memberships = membershipCount;
      },
      onAxisReferenceIndexLookup: (_axisId, matchingCount) => {
        stats.lookups++;
        stats.visited += matchingCount;
      },
    };
    const scoped = setup(
      current,
      { scope: "predict-game", gameId: "target" },
      () => new Map([["ref-00", { score: 0.8, vetoed: false }]]),
      observer,
    );
    expect(scoped.result.ok).toBe(true);
    if (!scoped.result.ok) return;
    expect(scoped.result.run.predictionPairs).toHaveLength(48);
    expect(stats).toEqual({ builds: 1, memberships: 48, lookups: 1, visited: 48 });
    expect(scoped.getCacheLookups()).toBeGreaterThan(0);
    expect(
      scoped.result.run.authorizedPairs.every((entry) => entry.pair.domain === "collection"),
    ).toBe(true);
  });
});
