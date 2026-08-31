import { describe, expect, test } from "bun:test";
import {
  createCompleteEntityMetadata,
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
