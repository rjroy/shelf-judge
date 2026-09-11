import { describe, expect, test } from "bun:test";
import {
  createCompleteEntityMetadata,
  ANALYST_EVIDENCE_MANIFEST,
  type CollectionProfileCollectionSource,
  type FitnessResult,
  type Game,
  type ShelfConfiguration,
} from "@shelf-judge/shared";
import type { DisplayedGameFitness } from "../../src/services/displayed-fitness-service.js";
import { computeCollectionProfile } from "../../src/services/collection-profile-engine.js";
import { canonicalSha256 } from "../../src/services/profile-source-coordinator.js";
import {
  REFLECTION_DETERMINISTIC_EVIDENCE_MANIFEST,
  buildReflectionProjectionSnapshot,
  createReflectionProjectionSnapshotService,
} from "../../src/services/reflection-evidence-projections.js";
import {
  ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST,
  buildAnalystProjectionSnapshot,
} from "../../src/services/analyst-evidence-projections.js";
import { createTestApp } from "../helpers/test-app.js";

const OBSERVED_AT = "2026-08-27T10:00:00.000Z";

function game(id: string, name: string, mechanics: { id: number; name: string }[]): Game {
  const supportsPattern = mechanics.some(({ id: entityId }) => entityId === 101);
  const sequence = Number(id.slice(-1));
  return {
    id,
    bggId: Number(id.slice(-1)),
    name,
    yearPublished: 2020,
    minPlayers: 1,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
    imageUrl: "https://unauthorized.invalid/image.jpg",
    bggData: {
      communityRating: 7,
      bayesAverage: 6.5,
      weight: 3,
      numWeightVotes: 100,
      description: "UNAUTHORIZED-DESCRIPTION",
      mechanics,
      categories: [{ id: 201, name: "Strategy" }],
      families: [],
      subdomains: [],
      bestPlayerCount: 3,
      fetchedAt: OBSERVED_AT,
    },
    numPlays: 2,
    acquisition: {
      state: "purchase",
      amount: { hundredths: 6_000, source: "manual", confirmedAt: OBSERVED_AT },
    },
    playCountEvidence: {
      status: "valid",
      value: 2,
      source: "bgg-plays",
      observedAt: OBSERVED_AT,
    },
    durationEvidence: {
      status: "valid",
      value: 60,
      source: "bgg-thing",
      observedAt: OBSERVED_AT,
    },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 1, maxPlayers: 4 },
      source: "bgg-player-range",
      observedAt: OBSERVED_AT,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "usable",
      buckets: [{ playerCount: "3", best: 10, recommended: 0, notRecommended: 0 }],
      source: "bgg-suggested-player-poll",
      observedAt: OBSERVED_AT,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    entityMetadata: createCompleteEntityMetadata(
      {
        mechanic: mechanics,
        designer: supportsPattern
          ? [
              { id: 301, name: "Lead Designer" },
              ...(sequence <= 2 ? [{ id: 302, name: "Design Partner" }] : []),
            ]
          : [],
        artist: supportsPattern
          ? [
              { id: 401, name: "Lead Artist" },
              ...(sequence >= 2 ? [{ id: 402, name: "Art Partner" }] : []),
            ]
          : [],
      },
      OBSERVED_AT,
    ),
    latestPlayCountCheck: { status: "valid", value: 2, observedAt: OBSERVED_AT },
    ownership: "owned",
    boxDimensions: { width: 10, height: 10, depth: 3 },
    manualShelfId: id === "game-1" ? "shelf-1" : null,
    ratings: {},
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  };
}

function fitness(score: number, vetoed = false): FitnessResult {
  return {
    score,
    ratedAxisCount: 1,
    totalAxisCount: 1,
    breakdown: [
      {
        axisId: "axis-1",
        axisName: "Fit",
        weight: 100,
        contribution: score,
        source: "personal",
        derivedField: null,
        sourceValue: score,
        scoringRawValue: score,
        effectiveRating: score,
        preferenceShape: "higher-is-better",
        curveAffected: false,
        unit: null,
        provenance: null,
        configurationSummary: null,
        overridden: false,
        overrideValue: null,
        predictionConfidence: null,
        referenceGames: null,
      },
    ],
    vetoed,
    vetoedBy: vetoed
      ? { axisId: "axis-1", axisName: "Fit", threshold: 2, direction: "below", rawValue: 1 }
      : null,
    hypotheticalScore: vetoed ? 4 : null,
    predictionMeta: null,
    redundancyAdjustment: null,
  };
}

function fixture() {
  const games = [
    game("game-1", "Alpha", [
      { id: 101, name: "Worker Placement" },
      { id: 102, name: "Solo" },
    ]),
    game("game-2", "Beta", [
      { id: 101, name: "Worker Placement" },
      { id: 103, name: "Deck Building" },
    ]),
    game("game-3", "Gamma", [
      { id: 101, name: "Worker Placement" },
      { id: 103, name: "Deck Building" },
    ]),
    game("game-4", "Heat", []),
  ];
  const collection: CollectionProfileCollectionSource = {
    schemaVersion: 6,
    revision: 9,
    id: "collection-1",
    name: "Collection",
    axes: [],
    games,
    intentions: [],
    commandReceipts: [],
    entertainmentBenchmark: {
      state: "configured",
      amount: { hundredths: 1_200, source: "manual", confirmedAt: OBSERVED_AT },
    },
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  };
  const scores = new Map([
    ["game-1", fitness(8)],
    ["game-2", fitness(6)],
    ["game-3", fitness(0, true)],
  ]);
  const displayedGames: DisplayedGameFitness[] = games.map((entry) => ({
    game: entry,
    score: scores.get(entry.id) ?? null,
    hasPredictedContribution: false,
    hasScoringContribution: scores.has(entry.id),
  }));
  const shelfConfiguration: ShelfConfiguration = {
    units: [
      {
        id: "unit-1",
        name: "Main",
        shelves: [
          {
            id: "shelf-1",
            name: "Top",
            dimensionless: true,
            width: null,
            height: null,
            depth: null,
          },
        ],
      },
    ],
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  };
  return {
    collection,
    profile: computeCollectionProfile({
      collection,
      fitnessResults: scores,
      computedAt: "2026-08-27T12:00:00.000Z",
    }),
    displayedGames,
    shelfConfiguration,
  };
}

describe("Reflection deterministic evidence projections", () => {
  test("projects exact Analyst evidence without broad durable fields", () => {
    const analyst = buildAnalystProjectionSnapshot(fixture());
    const scoring = analyst.sources.find(({ sourceId }) => sourceId === "game:game-1:scoring");
    const profile = analyst.sources.find(({ sourceId }) => sourceId === "profile:mechanic:101");
    expect(scoring?.payload).toEqual({
      gameId: "game-1",
      displayedFitness: 8,
      validatedBreakdown: [
        {
          axisId: "axis-1",
          axisName: "Fit",
          weight: 100,
          contribution: 8,
          source: "personal",
          derivedField: null,
          sourceValue: 8,
          scoringRawValue: 8,
          effectiveRating: 8,
          preferenceShape: "higher-is-better",
          curveAffected: false,
          unit: null,
          provenance: null,
          configurationSummary: null,
          overridden: false,
          overrideValue: null,
          predictionConfidence: null,
          referenceGames: null,
        },
      ],
      veto: null,
      predictionStatus: null,
      sourceState: "available",
    });
    expect(
      analyst.sources.find(({ sourceId }) => sourceId === "game:game-3:scoring")?.payload,
    ).toEqual({
      gameId: "game-3",
      displayedFitness: 0,
      validatedBreakdown: [
        {
          axisId: "axis-1",
          axisName: "Fit",
          weight: 100,
          contribution: 0,
          source: "personal",
          derivedField: null,
          sourceValue: 0,
          scoringRawValue: 0,
          effectiveRating: 0,
          preferenceShape: "higher-is-better",
          curveAffected: false,
          unit: null,
          provenance: null,
          configurationSummary: null,
          overridden: false,
          overrideValue: null,
          predictionConfidence: null,
          referenceGames: null,
        },
      ],
      veto: { axisId: "axis-1", axisName: "Fit", threshold: 2, direction: "below", rawValue: 1 },
      predictionStatus: null,
      sourceState: "available",
    });
    expect(profile?.payload).toEqual({
      entityClass: "mechanic",
      entityId: 101,
      name: "Worker Placement",
      entityAssociations: [
        { gameId: "game-1", gameName: "Alpha", currentFitness: 8, vetoed: false },
        { gameId: "game-2", gameName: "Beta", currentFitness: 6, vetoed: false },
        { gameId: "game-3", gameName: "Gamma", currentFitness: 0, vetoed: true },
      ],
      comparatorCohort: {
        gameCount: 3,
        meanCurrentFitness: 14 / 3,
        games: [
          { gameId: "game-1", gameName: "Alpha", currentFitness: 8, vetoed: false },
          { gameId: "game-2", gameName: "Beta", currentFitness: 6, vetoed: false },
          { gameId: "game-3", gameName: "Gamma", currentFitness: 0, vetoed: true },
        ],
      },
      support: "supported",
      dispersion: { populationStandardDeviation: Math.sqrt(104 / 9), range: { min: 0, max: 8 } },
      supportingGames: [
        { gameId: "game-1", gameName: "Alpha", currentFitness: 8, vetoed: false },
        { gameId: "game-2", gameName: "Beta", currentFitness: 6, vetoed: false },
        { gameId: "game-3", gameName: "Gamma", currentFitness: 0, vetoed: true },
      ],
      exclusions: [
        {
          gameId: "game-4",
          gameName: "Heat",
          reason: "missing-or-invalid-fitness",
          hasEntityAssociation: false,
          correctionDestination: { operationId: "shelf.game.rating.set" },
        },
      ],
      activeIntentions: [],
      evidenceWarnings: [],
      confounders: [
        {
          entityId: 103,
          name: "Deck Building",
          cooccurringGameCount: 2,
          gameIds: ["game-2", "game-3"],
        },
        { entityId: 102, name: "Solo", cooccurringGameCount: 1, gameIds: ["game-1"] },
      ],
      associationNotPreference: true,
    });
    expect(
      analyst.sources.find(({ sourceId }) => sourceId === "game:game-1:play-acquisition")?.payload,
    ).toMatchObject({
      acquisitionDate: null,
      purchaseUtilization: {
        outcome: "met",
        valueMultiplier: { outcome: "calculated", exact: { numerator: "8", denominator: "5" } },
      },
    });
    expect(
      analyst.sources.find(({ sourceId }) => sourceId === "game:game-1:structure")?.observedAt,
    ).toBeUndefined();
    expect(ANALYST_EVIDENCE_MANIFEST.classes.map(({ id, fields }) => ({ id, fields }))).toEqual([
      {
        id: "game-identity-ownership",
        fields: ["gameId", "displayName", "bggId", "ownershipState"],
      },
      {
        id: "current-scoring",
        fields: [
          "gameId",
          "displayedFitness",
          "validatedBreakdown",
          "veto",
          "predictionStatus",
          "sourceState",
        ],
      },
      {
        id: "imported-metadata",
        fields: [
          "gameId",
          "name",
          "description",
          "categories",
          "mechanics",
          "families",
          "subdomains",
          "designers",
          "artists",
          "playerCounts",
          "playTime",
          "weight",
          "completeness",
          "sourceTime",
          "refreshWarnings",
        ],
      },
      {
        id: "play-acquisition",
        fields: [
          "gameId",
          "playCount",
          "acquisitionDate",
          "acquisitionPrice",
          "source",
          "observedAt",
          "purchaseUtilization",
        ],
      },
      { id: "collection-structure", fields: ["gameId", "shelfAssignment", "redundancy"] },
      {
        id: "collection-summary",
        fields: ["snapshotFingerprint", "groupBy", "measures", "group", "sourceCount"],
      },
      {
        id: "profile-evidence",
        fields: [
          "entityClass",
          "entityId",
          "name",
          "entityAssociations",
          "comparatorCohort",
          "support",
          "dispersion",
          "supportingGames",
          "exclusions",
          "activeIntentions",
          "evidenceWarnings",
          "confounders",
          "associationNotPreference",
        ],
      },
      { id: "owner-game-note", fields: ["gameId", "noteVersion", "state", "text"] },
    ]);
    expect(buildAnalystProjectionSnapshot(structuredClone(fixture())).snapshotFingerprint).toBe(
      analyst.snapshotFingerprint,
    );
    const revisionChanged = fixture();
    revisionChanged.collection.revision += 1;
    const revised = buildAnalystProjectionSnapshot(revisionChanged);
    expect(
      revised.sources.find(({ sourceId }) => sourceId === "game:game-1:scoring")?.sourceVersion,
    ).not.toBe(scoring?.sourceVersion);
    expect(
      revised.sources.find(({ sourceId }) => sourceId === "profile:mechanic:101")?.sourceVersion,
    ).not.toBe(profile?.sourceVersion);
    const metadataChanged = fixture();
    const changedMetadata = metadataChanged.collection.games[0]?.bggData;
    if (changedMetadata === undefined || changedMetadata === null)
      throw new Error("Expected metadata fixture");
    changedMetadata.fetchedAt = "2026-08-28T10:00:00.000Z";
    const metadataSnapshot = buildAnalystProjectionSnapshot(metadataChanged);
    expect(
      metadataSnapshot.sources.find(({ sourceId }) => sourceId === "game:game-1:metadata")
        ?.sourceVersion,
    ).not.toBe(
      analyst.sources.find(({ sourceId }) => sourceId === "game:game-1:metadata")?.sourceVersion,
    );
    expect(JSON.stringify(analyst)).not.toContain("unauthorized.invalid");
    expect(JSON.stringify(analyst)).not.toContain("commandReceipts");
    for (const entry of analyst.sources) {
      const schema = ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[entry.evidenceClass];
      expect(
        schema.safeParse({ ...(entry.payload as object), unauthorizedRootField: true }).success,
      ).toBe(false);
    }
    expect(
      ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence["profile-evidence"].safeParse({
        ...(profile?.payload as object),
        activeIntentions: [
          {
            ...(profile?.payload as { activeIntentions: readonly object[] }).activeIntentions[0],
            unauthorizedNestedField: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence["profile-evidence"].safeParse({
        ...(profile?.payload as object),
        confounders: [
          {
            ...(profile?.payload as { confounders: readonly object[] }).confounders[0],
            unauthorizedNestedField: true,
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("emits strict class summaries when Profile has no entity rows", () => {
    const input = fixture();
    input.collection.intentions = [
      {
        intentionId: "intention-1",
        gameId: "game-1",
        kind: "replay",
        baseline: { playCount: 2, evidenceSource: "bgg-plays", observedAt: OBSERVED_AT },
        createdAt: "2026-08-27T11:30:00.000Z",
        version: 1,
        resolution: null,
      },
    ];
    for (const entry of input.collection.games) {
      entry.entityMetadata = createCompleteEntityMetadata(
        { mechanic: [], designer: [], artist: [] },
        OBSERVED_AT,
      );
      entry.entityMetadata.mechanic.refreshFailure = {
        attemptedAt: "2026-08-27T11:00:00.000Z",
        message: "BGG mechanic refresh timed out",
      };
      entry.entityMetadata.designer.refreshFailure = {
        attemptedAt: "2026-08-27T11:00:00.000Z",
        message: "BGG mechanic refresh timed out",
      };
      entry.entityMetadata.artist.refreshFailure = {
        attemptedAt: "2026-08-27T11:00:00.000Z",
        message: "BGG mechanic refresh timed out",
      };
    }
    input.displayedGames = input.displayedGames.map((entry, index) => {
      const collectionGame = input.collection.games[index];
      if (collectionGame === undefined) throw new Error("Expected collection game fixture");
      return { ...entry, game: collectionGame };
    });
    const scores = new Map(
      input.displayedGames.flatMap(({ game, score }) =>
        score === null ? [] : [[game.id, score] as const],
      ),
    );
    input.profile = computeCollectionProfile({
      collection: input.collection,
      fitnessResults: scores,
      computedAt: "2026-08-27T12:00:00.000Z",
    });

    const snapshot = buildAnalystProjectionSnapshot(input);
    const summaries = snapshot.sources.filter(({ sourceId }) => sourceId.endsWith(":summary"));

    expect(summaries).toHaveLength(3);
    expect(summaries.map(({ sourceId }) => sourceId)).toEqual([
      "profile:artist:summary",
      "profile:designer:summary",
      "profile:mechanic:summary",
    ]);
    for (const summary of summaries) {
      expect(summary.payload).toMatchObject({
        entityId: null,
        entityAssociations: [],
        support: null,
        dispersion: null,
        supportingGames: [],
        confounders: [],
        comparatorCohort: { gameCount: 3 },
        exclusions: [{ gameId: "game-4", reason: "missing-or-invalid-fitness" }],
        activeIntentions: [
          {
            intentionId: "intention-1",
            gameId: "game-1",
            gameName: "Alpha",
            kind: "replay",
            baseline: { playCount: 2, evidenceSource: "bgg-plays", observedAt: OBSERVED_AT },
            createdAt: "2026-08-27T11:30:00.000Z",
            version: 1,
          },
        ],
        evidenceWarnings: [
          {
            gameId: "game-1",
            gameName: "Alpha",
            attemptedAt: "2026-08-27T11:00:00.000Z",
            message: "BGG mechanic refresh timed out",
          },
          {
            gameId: "game-2",
            gameName: "Beta",
            attemptedAt: "2026-08-27T11:00:00.000Z",
            message: "BGG mechanic refresh timed out",
          },
          {
            gameId: "game-3",
            gameName: "Gamma",
            attemptedAt: "2026-08-27T11:00:00.000Z",
            message: "BGG mechanic refresh timed out",
          },
          {
            gameId: "game-4",
            gameName: "Heat",
            attemptedAt: "2026-08-27T11:00:00.000Z",
            message: "BGG mechanic refresh timed out",
          },
        ],
        associationNotPreference: true,
      });
      expect(
        ANALYST_DETERMINISTIC_EVIDENCE_MANIFEST.evidence["profile-evidence"].safeParse({
          ...(summary.payload as object),
          entityId: 0,
          support: null,
        }).success,
      ).toBe(false);
    }
  });

  test("preserves candidate order and projects complete confounders, exclusions, and exact values", () => {
    const snapshot = buildReflectionProjectionSnapshot(fixture());
    const patterns = snapshot.projections["pattern-exceptions"];

    expect(patterns.patternCandidateIds).toEqual(["mechanic:101", "designer:301", "artist:401"]);
    expect(patterns.gameIds).toEqual(["game-1", "game-2", "game-3"]);
    expect(patterns.excludedGameCount).toBe(1);
    const profileEntry = patterns.evidence.entries.find(
      ({ evidenceClass }) => evidenceClass === "profile-evidence",
    );
    expect(profileEntry?.payload).toMatchObject({
      candidateId: "mechanic:101",
      meanCurrentFitness: 14 / 3,
      comparator: {
        gameCount: 3,
        games: [
          { gameId: "game-1", currentFitness: 8 },
          { gameId: "game-2", currentFitness: 6 },
          { gameId: "game-3", currentFitness: 0 },
        ],
      },
      metadataReadiness: {
        state: "complete",
        ownedGameCount: 4,
        completeGameCount: 4,
      },
      games: [
        { gameId: "game-1", currentFitness: 8 },
        { gameId: "game-2", currentFitness: 6 },
        { gameId: "game-3", currentFitness: 0, vetoed: true },
      ],
      exclusions: [
        {
          gameId: "game-4",
          reason: "missing-or-invalid-fitness",
          associationKnown: true,
          associatedWithCandidate: false,
        },
      ],
      confounders: [
        {
          entityId: 103,
          name: "Deck Building",
          cooccurringGameCount: 2,
          gameIds: ["game-2", "game-3"],
        },
        { entityId: 102, name: "Solo", cooccurringGameCount: 1, gameIds: ["game-1"] },
      ],
    });
    expect(
      patterns.evidence.entries.find(({ sourceId }) => sourceId === "profile:designer:301")
        ?.payload,
    ).toMatchObject({
      confounders: [
        {
          entityId: 302,
          name: "Design Partner",
          cooccurringGameCount: 2,
          gameIds: ["game-1", "game-2"],
        },
      ],
    });
    for (const entry of patterns.evidence.entries) {
      expect(entry.sourceVersion).toBe(canonicalSha256(entry.payload));
      expect(entry.citationId).toBe(
        `reflection:${entry.evidenceClass}:${entry.sourceId}:${entry.sourceVersion.slice(0, 16)}`,
      );
    }
    expect(
      patterns.evidence.entries.find(
        ({ sourceId, evidenceClass }) =>
          sourceId === "game:game-1:scoring" && evidenceClass === "current-scoring",
      )?.payload,
    ).toMatchObject({ score: 8, breakdown: [{ contribution: 8, effectiveRating: 8 }] });
    expect(
      patterns.evidence.entries.find(
        ({ sourceId, evidenceClass }) =>
          sourceId === "game:game-1:play-acquisition" && evidenceClass === "play-acquisition",
      )?.payload,
    ).toMatchObject({
      playCount: { status: "valid", value: 2 },
      utilization: {
        outcome: "met",
        valueMultiplier: {
          outcome: "calculated",
          exact: { numerator: "8", denominator: "5" },
        },
      },
    });
  });

  test("pages one frozen scope and rejects cursors from another snapshot", () => {
    const first = buildReflectionProjectionSnapshot(fixture());
    const projection = first.projections["repeated-values"];
    const pageOne = projection.page(null, 2);
    const pageTwo = projection.page(pageOne.nextCursor, 2);
    expect(pageOne.gameIds).toEqual(["game-1", "game-2"]);
    expect(pageTwo.gameIds).toEqual(["game-3", "game-4"]);
    expect(pageTwo.nextCursor).toBeNull();
    expect(Object.isFrozen(pageOne.gameIds)).toBe(true);

    const changed = fixture();
    changed.collection.revision += 1;
    const second = buildReflectionProjectionSnapshot(changed);
    expect(second.snapshotFingerprint).not.toBe(first.snapshotFingerprint);
    expect(() => second.projections["repeated-values"].page(pageOne.nextCursor, 2)).toThrow(
      "different projection",
    );
    expect(() => first.projections["pattern-exceptions"].page(pageOne.nextCursor, 1)).toThrow(
      "different projection",
    );
  });

  test("is deterministic and never projects broad game fields or unknown payload fields", () => {
    const input = fixture();
    const first = buildReflectionProjectionSnapshot(input);
    const second = buildReflectionProjectionSnapshot(structuredClone(input));
    expect(second.snapshotFingerprint).toBe(first.snapshotFingerprint);
    expect(second.projections["repeated-values"].citations).toEqual(
      first.projections["repeated-values"].citations,
    );
    const serialized = JSON.stringify(first.projections);
    expect(serialized).not.toContain("UNAUTHORIZED-DESCRIPTION");
    expect(serialized).not.toContain("unauthorized.invalid");
    expect(serialized).not.toContain("privateAxis");
    expect(serialized).not.toContain("commandReceipts");

    const identitySchema =
      REFLECTION_DETERMINISTIC_EVIDENCE_MANIFEST.evidence["game-identity-ownership"];
    expect(
      identitySchema.safeParse({
        gameId: "game-1",
        name: "Alpha",
        bggId: 1,
        ownership: "owned",
        ownerNote: "not authorized",
      }).success,
    ).toBe(false);
    for (const entry of first.projections["pattern-exceptions"].evidence.entries) {
      const schema =
        REFLECTION_DETERMINISTIC_EVIDENCE_MANIFEST.evidence[
          entry.evidenceClass as keyof typeof REFLECTION_DETERMINISTIC_EVIDENCE_MANIFEST.evidence
        ];
      expect(
        schema.safeParse({ ...(entry.payload as object), unauthorizedRootField: true }).success,
      ).toBe(false);
    }
  });

  test("captures all deterministic inputs through one coordinated service boundary", async () => {
    const context = createTestApp({ now: () => "2026-08-27T12:00:00.000Z" });
    await context.gameService.addGame({ name: "Captured Game" });
    const service = createReflectionProjectionSnapshotService({
      storageService: context.storageService,
      displayedFitnessService: context.displayedFitnessService,
      now: () => "2026-08-27T12:00:00.000Z",
    });

    const snapshot = await service.capture();

    expect(snapshot.collectionRevision).toBe(
      (await context.storageService.loadCollection()).revision,
    );
    expect(snapshot.projections["repeated-values"].gameIds).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain("ownerNote");
  });
});
