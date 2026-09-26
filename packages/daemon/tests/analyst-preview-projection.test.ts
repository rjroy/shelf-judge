import { describe, expect, it } from "bun:test";
import { AnalystBggFitnessPreviewResultSchema } from "@shelf-judge/shared";
import { projectFitnessPreview } from "../src/services/analyst-turn-service.js";
import type { AnalystBggEvidenceRegistry } from "../src/services/grounded-analysis/analyst-bgg-tools.js";
import { calculateBggFitnessPreview } from "../src/services/bgg-fitness-preview-service.js";
import type { PredictionService, PredictedGameResult } from "../src/services/prediction-service.js";
import type { BggGameData, Game } from "@shelf-judge/shared";

function bggData(overrides: Partial<BggGameData> = {}): BggGameData {
  return {
    communityRating: 7.5,
    bayesAverage: 7.2,
    weight: 2.9,
    numWeightVotes: 100,
    description: null,
    mechanics: [],
    categories: [],
    families: [],
    subdomains: [],
    bestPlayerCount: null,
    fetchedAt: "2026-09-25T12:00:00Z",
    ...overrides,
  };
}

function registry() {
  const records: { id: string; record: unknown }[] = [];
  let index = 0;
  const value: AnalystBggEvidenceRegistry = {
    stage(record) {
      const id = `opaque-${++index}`;
      records.push({ id, record });
      return id;
    },
    commit() {},
    discard() {},
  };
  return { value, records };
}

type ResultOverrides = Omit<Partial<PredictedGameResult>, "game" | "score" | "previewIdentity"> & {
  game?: Partial<Omit<Game, "bggData">> & { bggData?: Game["bggData"] };
  score?: Partial<PredictedGameResult["score"]>;
  previewIdentity?: Partial<NonNullable<PredictedGameResult["previewIdentity"]>>;
};

function result(overrides: ResultOverrides = {}): PredictedGameResult {
  const base = {
    game: {
      id: "preview-174430",
      bggId: 174430,
      name: "Example Game",
      yearPublished: 2020,
      minPlayers: null,
      maxPlayers: null,
      bestPlayers: null,
      playingTime: null,
      imageUrl: null,
      ownership: "owned",
      bggData: bggData({ mechanics: [{ id: 1, name: "Set collection" }] }),
      numPlays: null,
      acquisition: { type: "unknown" },
      playCountEvidence: { kind: "unknown" },
      durationEvidence: { kind: "unknown" },
      playerRangeEvidence: { kind: "unknown" },
      suggestedPlayerPoll: null,
      bestPlayersInvalidEvidence: null,
      manualValues: {},
      entityMetadata: {},
      latestPlayCountCheck: null,
      boxDimensions: null,
      manualShelfId: null,
      ratings: {},
      createdAt: "2026-09-25T12:00:00Z",
      updatedAt: "2026-09-25T12:00:00Z",
    },
    score: {
      score: 7.3,
      ratedAxisCount: 1,
      totalAxisCount: 1,
      breakdown: [],
      predictionMeta: null,
    },
    predictionUnavailable: null,
    previewIdentity: {
      calculationVersion: "bgg-fitness-preview-v2",
      calculatedAt: "2026-09-25T12:00:00Z",
      bggObservedAt: "2026-09-25T11:59:00Z",
      collectionRevision: 3,
      predictionSettingsVersion: "settings-v1",
      tournamentDataVersion: "tournament-v1",
    },
    bggVerification: { status: "verified" },
  } as unknown as PredictedGameResult;
  return {
    ...base,
    ...overrides,
    game: {
      ...base.game,
      ...overrides.game,
      bggData: overrides.game?.bggData ?? base.game.bggData,
    },
    score: { ...base.score, ...overrides.score },
    previewIdentity: { ...base.previewIdentity, ...overrides.previewIdentity } as NonNullable<
      PredictedGameResult["previewIdentity"]
    >,
  };
}

describe("Analyst fitness preview projection", () => {
  it("preserves the shared preview service's displayed numeric score", async () => {
    const citations = registry();
    const calculatedResult = result({
      game: { ...result().game, bggData: bggData({ mechanics: [], categories: [], families: [] }) },
    });
    const previewService: Pick<PredictionService, "predictBggGame" | "listGamesWithPredictions"> = {
      predictBggGame: () => Promise.resolve(calculatedResult),
      listGamesWithPredictions: () => Promise.resolve([]),
    };
    const sharedPreview = await calculateBggFitnessPreview(
      previewService as PredictionService,
      undefined,
      174430,
    );
    const projected = AnalystBggFitnessPreviewResultSchema.parse(
      projectFitnessPreview({ kind: "calculated", ...sharedPreview }, 174430, citations.value),
    );
    expect(projected).toMatchObject({
      status: "ok",
      state: "predicted",
      score: { value: sharedPreview.result.score.score, label: "predicted" },
    });
    expect(projected).toMatchObject({ bggLookup: { status: "verified" } });
    expect(
      citations.records.map(({ record }) => (record as { evidenceClass: string }).evidenceClass),
    ).toEqual(["bgg-thing-facts", "bgg-preview-calculation"]);
  });

  it("keeps Stage 0 without a displayable personal score unavailable", () => {
    const citations = registry();
    const projected = projectFitnessPreview(
      {
        kind: "calculated",
        result: result({
          score: {
            score: 0,
            ratedAxisCount: 0,
            totalAxisCount: 2,
            breakdown: [],
            predictionMeta: null,
          },
          predictionUnavailable: { reason: "stage-0", ratedGameCount: 0, gamesNeeded: 3 },
        }),
      },
      174430,
      citations.value,
    );
    expect(projected).toEqual({
      status: "unavailable",
      state: "unavailable",
      bggId: 174430,
      code: "PredictionUnavailable",
      retryable: false,
      predictionUnavailable: { reason: "stage-0", ratedGameCount: 0, gamesNeeded: 3 },
    });
    expect(citations.records).toHaveLength(0);
  });

  it("returns ambiguous local identity without score or citations", () => {
    const citations = registry();
    const projected = projectFitnessPreview(
      { kind: "ambiguous", gameIds: ["game-a", "game-b"] },
      174430,
      citations.value,
    );
    expect(projected).toEqual({
      status: "partial",
      state: "ambiguous",
      bggId: 174430,
      collectionGameIds: ["game-a", "game-b"],
      code: "AmbiguousCollectionMatch",
    });
    expect(citations.records).toHaveLength(0);
  });

  it("retains only local score and ownership when Thing verification failed", () => {
    const citations = registry();
    const projected = projectFitnessPreview(
      {
        kind: "calculated",
        result: result({
          game: {
            id: "local-game",
            bggId: 174430,
            name: "Local name",
            ownership: "previously-owned",
            bggData: bggData(),
          },
          previewIdentity: {
            ...result().previewIdentity,
            bggObservedAt: null,
            source: "local-unverified",
          },
          bggVerification: { status: "existing-local-unverified", failure: "unauthorized" },
        }),
      },
      174430,
      citations.value,
    );
    expect(projected).toMatchObject({
      status: "partial",
      state: "existing-local-unverified",
      collectionName: "Local name",
      ownership: "previously-owned",
      bggLookup: { status: "failed", code: "BggUnauthorized" },
      score: { value: 7.3, label: "actual" },
    });
    expect(projected).not.toHaveProperty("primaryName");
    expect(
      citations.records.map(({ record }) => (record as { evidenceClass: string }).evidenceClass),
    ).toEqual(["bgg-preview-calculation", "current-scoring"]);
  });

  it("uses successful verified Thing facts for an existing game's BGG identity", () => {
    const citations = registry();
    const verifiedFact = {
      bggId: 174430,
      primaryName: "Verified Thing Name",
      yearPublished: null,
      yearMissing: true,
      mechanics: [{ id: 91, name: "Verified mechanic" }],
      mechanicsMissing: false,
      mechanicsComplete: true,
      warnings: [],
      observedAt: "2026-09-25T11:59:00Z",
    };
    const projected = AnalystBggFitnessPreviewResultSchema.parse(
      projectFitnessPreview(
        {
          kind: "calculated",
          result: result({
            game: {
              id: "local-game",
              name: "Stale local name",
              yearPublished: 1992,
              bggData: bggData({ mechanics: [{ id: 1, name: "Stale mechanic" }] }),
            },
            verifiedFact,
          }),
        },
        174430,
        citations.value,
      ),
    );

    expect(projected).toMatchObject({
      status: "ok",
      state: "existing",
      primaryName: "Verified Thing Name",
      bggLookup: { status: "verified", observedAt: verifiedFact.observedAt },
    });
    expect(
      citations.records.find(
        ({ record }) => (record as { evidenceClass: string }).evidenceClass === "bgg-thing-facts",
      )?.record,
    ).toMatchObject({
      payload: {
        primaryName: "Verified Thing Name",
        yearPublished: null,
        mechanics: [{ id: 91, name: "Verified mechanic" }],
        missingFields: ["year"],
      },
    });
  });
});
