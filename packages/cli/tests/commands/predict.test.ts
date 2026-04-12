import { describe, test, expect } from "bun:test";
import { predictGame, predictReadiness } from "../../src/commands/predict.js";
import { scoreList } from "../../src/commands/score.js";
import { createMockClient } from "../helpers/mock-client.js";

const predictGameData = {
  game: { id: "abc-123", name: "Wingspan" },
  score: {
    score: 7.2,
    ratedAxisCount: 2,
    totalAxisCount: 4,
    breakdown: [
      {
        axisName: "Wife will play it",
        rating: 8,
        weight: 40,
        contribution: 3.2,
        source: "personal",
        bggOriginal: null,
        rawValue: 8,
        effectiveRating: 8,
        preferenceShape: "higher-is-better",
        curveAffected: false,
        predictionConfidence: null,
        referenceGames: null,
      },
      {
        axisName: "Replayability",
        rating: 7,
        weight: 30,
        contribution: 2.1,
        source: "predicted",
        bggOriginal: null,
        rawValue: 7,
        effectiveRating: 7,
        preferenceShape: "higher-is-better",
        curveAffected: false,
        predictionConfidence: "strong",
        referenceGames: [
          { gameId: "ref-1", gameName: "Everdell", similarity: 0.92 },
          { gameId: "ref-2", gameName: "Ark Nova", similarity: 0.85 },
        ],
      },
      {
        axisName: "Community Rating",
        rating: 8.1,
        weight: 10,
        contribution: 0.81,
        source: "bgg",
        bggOriginal: null,
        rawValue: 8.1,
        effectiveRating: 8.1,
        preferenceShape: "higher-is-better",
        curveAffected: false,
        predictionConfidence: "actual",
        referenceGames: null,
      },
      {
        axisName: "Solo Mode",
        rating: null,
        weight: 20,
        contribution: null,
        source: "predicted",
        bggOriginal: null,
        rawValue: null,
        effectiveRating: null,
        preferenceShape: "higher-is-better",
        curveAffected: false,
        predictionConfidence: "insufficient",
        referenceGames: null,
      },
    ],
    vetoed: false,
    vetoedBy: null,
    hypotheticalScore: null,
    predictionMeta: {
      readinessStage: 2,
      confidence: "strong",
      predictedAxisCount: 2,
      actualAxisCount: 2,
      referenceGameCount: 5,
      coveragePercent: 0.8,
    },
    redundancyAdjustment: null,
  },
  tension: null,
};

describe("predict <game-id>", () => {
  const client = createMockClient({
    routes: {
      "GET /api/predictions/abc-123": {
        response: { ok: true, status: 200, data: predictGameData },
      },
    },
  });

  test("human-readable output shows game name and predicted fitness", async () => {
    const output = await predictGame(client, ["abc-123"], { json: false });
    expect(output).toContain("Wingspan");
    expect(output).toContain("Predicted Fitness: 7.2");
    expect(output).toContain("2/4 axes rated");
  });

  test("human-readable output shows prediction metadata", async () => {
    const output = await predictGame(client, ["abc-123"], { json: false });
    expect(output).toContain("2 predicted, 2 actual, 5 reference games");
    expect(output).toContain("Confidence: strong");
    expect(output).toContain("80% coverage");
    expect(output).toContain("stage 2");
  });

  test("human-readable output shows breakdown table with sources", async () => {
    const output = await predictGame(client, ["abc-123"], { json: false });
    expect(output).toContain("Wife will play it");
    expect(output).toContain("personal");
    expect(output).toContain("Replayability");
    expect(output).toContain("predicted");
  });

  test("human-readable output shows reference games for predicted axes", async () => {
    const output = await predictGame(client, ["abc-123"], { json: false });
    expect(output).toContain("Reference Games:");
    expect(output).toContain("Replayability:");
    expect(output).toContain("Everdell (similarity: 0.92)");
    expect(output).toContain("Ark Nova (similarity: 0.85)");
  });

  test("--json outputs parseable JSON with full response", async () => {
    const output = await predictGame(client, ["abc-123"], { json: true });
    const parsed = JSON.parse(output) as typeof predictGameData;
    expect(parsed.game.name).toBe("Wingspan");
    expect(parsed.score.score).toBe(7.2);
    expect(parsed.score.predictionMeta.predictedAxisCount).toBe(2);
    expect(parsed.tension).toBeNull();
  });

  test("throws on missing game-id argument", async () => {
    const promise = predictGame(client, [], { json: false });
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects pattern requires await
    await expect(promise).rejects.toThrow("Usage: shelf-judge predict <game-id>");
  });
});

const predictWithTensionData = {
  ...predictGameData,
  tension: {
    predictedFitness: 7.2,
    tournamentClusterAverage: 5.1,
    note: "Predicted fitness significantly higher than similar games' tournament performance.",
  },
};

describe("predict <game-id> with tension", () => {
  const client = createMockClient({
    routes: {
      "GET /api/predictions/abc-123": {
        response: { ok: true, status: 200, data: predictWithTensionData },
      },
    },
  });

  test("human-readable output shows tension section", async () => {
    const output = await predictGame(client, ["abc-123"], { json: false });
    expect(output).toContain("[tension]");
    expect(output).toContain("7.2");
    expect(output).toContain("5.1");
    expect(output).toContain("Predicted fitness significantly higher");
  });
});

const readinessData = {
  stage: 1,
  ratedGameCount: 8,
  nextStageAt: 15,
  weakAxes: [
    { axisId: "ax-solo", axisName: "Solo Mode", ratedCount: 2 },
    { axisId: "ax-replay", axisName: "Replayability", ratedCount: 3 },
  ],
  suggestedActions: [
    "Rate more games with 'Deck Building' mechanic (0 of 4 rated)",
    "Rate more games to reach stage 2 (7 more needed)",
  ],
};

describe("predict readiness", () => {
  const client = createMockClient({
    routes: {
      "GET /api/predictions/readiness": {
        response: { ok: true, status: 200, data: readinessData },
      },
    },
  });

  test("human-readable output shows stage and label", async () => {
    const output = await predictReadiness(client, [], { json: false });
    expect(output).toContain("Stage 1 (Basic)");
  });

  test("human-readable output shows rated game count and next stage", async () => {
    const output = await predictReadiness(client, [], { json: false });
    expect(output).toContain("Rated Games: 8");
    expect(output).toContain("Next Stage At: 15");
  });

  test("human-readable output shows weak axes table", async () => {
    const output = await predictReadiness(client, [], { json: false });
    expect(output).toContain("Weak Axes:");
    expect(output).toContain("Solo Mode");
    expect(output).toContain("Replayability");
  });

  test("human-readable output shows suggested actions", async () => {
    const output = await predictReadiness(client, [], { json: false });
    expect(output).toContain("Suggested Actions:");
    expect(output).toContain("Deck Building");
    expect(output).toContain("7 more needed");
  });

  test("--json outputs parseable JSON", async () => {
    const output = await predictReadiness(client, [], { json: true });
    const parsed = JSON.parse(output) as typeof readinessData;
    expect(parsed.stage).toBe(1);
    expect(parsed.ratedGameCount).toBe(8);
    expect(parsed.weakAxes).toHaveLength(2);
    expect(parsed.suggestedActions).toHaveLength(2);
  });
});

const predictedScoresData = [
  {
    game: { id: "abc-123", name: "Wingspan" },
    score: {
      score: 8.5,
      ratedAxisCount: 4,
      totalAxisCount: 4,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: null,
      redundancyAdjustment: null,
    },
  },
  {
    game: { id: "def-456", name: "Everdell" },
    score: {
      score: 7.2,
      ratedAxisCount: 0,
      totalAxisCount: 4,
      breakdown: [],
      vetoed: false,
      vetoedBy: null,
      hypotheticalScore: null,
      predictionMeta: {
        readinessStage: 2,
        confidence: "moderate",
        predictedAxisCount: 4,
        actualAxisCount: 0,
        referenceGameCount: 5,
        coveragePercent: 0.6,
      },
      redundancyAdjustment: null,
    },
  },
  {
    game: { id: "ghi-789", name: "No BGG Game" },
    score: null,
  },
];

describe("score list --include-predicted", () => {
  const client = createMockClient({
    routes: {
      "GET /api/games?includePredicted=true": {
        response: { ok: true, status: 200, data: predictedScoresData },
      },
    },
  });

  test("human-readable output shows [P] marker for predicted games", async () => {
    const output = await scoreList(client, [], { json: false, includePredicted: true });
    expect(output).toContain("Wingspan");
    expect(output).toContain("8.5");
    expect(output).toContain("Everdell");
    expect(output).toContain("7.2");
    expect(output).toContain("[P]");
  });

  test("non-predicted games have no [P] marker", async () => {
    const output = await scoreList(client, [], { json: false, includePredicted: true });
    const lines = output.split("\n");
    const wingspanLine = lines.find((l) => l.includes("Wingspan"));
    expect(wingspanLine).not.toContain("[P]");
  });

  test("unscored games shown in Unscored section", async () => {
    const output = await scoreList(client, [], { json: false, includePredicted: true });
    expect(output).toContain("Unscored:");
    expect(output).toContain("No BGG Game");
  });

  test("--json outputs parseable JSON array", async () => {
    const output = await scoreList(client, [], { json: true, includePredicted: true });
    const parsed = JSON.parse(output) as typeof predictedScoresData;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].game.name).toBe("Wingspan");
    expect(parsed[1].score!.predictionMeta).not.toBeNull();
  });
});
