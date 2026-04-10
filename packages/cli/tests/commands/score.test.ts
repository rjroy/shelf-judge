import { describe, test, expect } from "bun:test";
import { scoreList, scoreGet } from "../../src/commands/score.js";
import { createMockClient } from "../helpers/mock-client.js";

const scoreListData = {
  scored: [
    {
      gameId: "abc-123",
      gameName: "Wingspan",
      score: 7.9,
      ratedAxisCount: 4,
      totalAxisCount: 4,
      breakdown: [
        {
          axisName: "Wife will play it",
          rating: 8,
          weight: 40,
          contribution: 3.2,
          source: "personal",
          bggOriginal: null,
        },
      ],
    },
    {
      gameId: "def-456",
      gameName: "Gloomhaven",
      score: 6.5,
      ratedAxisCount: 2,
      totalAxisCount: 4,
      breakdown: [],
    },
  ],
  unscored: [
    {
      gameId: "ghi-789",
      gameName: "Unrated Game",
      score: null,
      status: "not yet rated",
    },
  ],
};

describe("score list", () => {
  const client = createMockClient({
    routes: {
      "GET /api/scores": {
        response: { ok: true, status: 200, data: scoreListData },
      },
    },
  });

  test("human-readable output has table headers and scored game rows", async () => {
    const output = await scoreList(client, [], { json: false });
    expect(output).toContain("#");
    expect(output).toContain("Name");
    expect(output).toContain("Score");
    expect(output).toContain("Rated Axes");
    expect(output).toContain("Wingspan");
    expect(output).toContain("7.9");
    expect(output).toContain("4/4");
    expect(output).toContain("Gloomhaven");
    expect(output).toContain("6.5");
    expect(output).toContain("2/4");
  });

  test("human-readable output shows Unscored section", async () => {
    const output = await scoreList(client, [], { json: false });
    expect(output).toContain("Unscored:");
    expect(output).toContain("Unrated Game");
  });

  test("--json outputs parseable JSON with scored and unscored arrays", async () => {
    const output = await scoreList(client, [], { json: true });
    const parsed = JSON.parse(output) as {
      scored: Array<{ gameName: string; score: number }>;
      unscored: Array<{ gameName: string; score: null }>;
    };
    expect(Array.isArray(parsed.scored)).toBe(true);
    expect(Array.isArray(parsed.unscored)).toBe(true);
    expect(parsed.scored[0].gameName).toBe("Wingspan");
    expect(parsed.scored[0].score).toBe(7.9);
    expect(parsed.scored[1].gameName).toBe("Gloomhaven");
    expect(parsed.unscored[0].gameName).toBe("Unrated Game");
    expect(parsed.unscored[0].score).toBeNull();
  });
});

const scoreGetData = {
  gameId: "abc-123",
  gameName: "Wingspan",
  score: 7.9,
  ratedAxisCount: 4,
  totalAxisCount: 4,
  breakdown: [
    {
      axisName: "Wife will play it",
      rating: 8,
      weight: 40,
      contribution: 3.2,
      source: "personal",
      bggOriginal: null,
    },
    {
      axisName: "Community Rating",
      rating: 8.1,
      weight: 10,
      contribution: 0.81,
      source: "bgg",
      bggOriginal: null,
    },
  ],
};

describe("score get (rated game)", () => {
  const client = createMockClient({
    routes: {
      "GET /api/games/abc-123/score": {
        response: { ok: true, status: 200, data: scoreGetData },
      },
    },
  });

  test("human-readable output shows game name and fitness score", async () => {
    const output = await scoreGet(client, ["abc-123"], { json: false });
    expect(output).toContain("Wingspan");
    expect(output).toContain("7.9");
  });

  test("human-readable output shows breakdown table", async () => {
    const output = await scoreGet(client, ["abc-123"], { json: false });
    expect(output).toContain("Wife will play it");
    expect(output).toContain("Community Rating");
    expect(output).toContain("3.20");
    expect(output).toContain("0.81");
  });

  test("--json outputs parseable JSON with score and breakdown", async () => {
    const output = await scoreGet(client, ["abc-123"], { json: true });
    const parsed = JSON.parse(output) as {
      gameName: string;
      score: number;
      breakdown: Array<{ axisName: string }>;
    };
    expect(parsed.gameName).toBe("Wingspan");
    expect(parsed.score).toBe(7.9);
    expect(Array.isArray(parsed.breakdown)).toBe(true);
    expect(parsed.breakdown[0].axisName).toBe("Wife will play it");
    expect(parsed.breakdown[1].axisName).toBe("Community Rating");
  });
});

const scoreGetVetoedData = {
  gameId: "veto-123",
  gameName: "Too Complex Game",
  score: 0,
  ratedAxisCount: 4,
  totalAxisCount: 4,
  vetoed: true,
  vetoedBy: {
    axisId: "ax-complexity",
    axisName: "Complexity",
    threshold: 4,
    direction: "above" as const,
    rawValue: 4.5,
  },
  hypotheticalScore: 7.2,
  breakdown: [
    {
      axisName: "Complexity",
      rating: 1.75,
      weight: 20,
      contribution: 0.35,
      source: "bgg",
      bggOriginal: null,
      rawValue: 4.5,
      effectiveRating: 1.75,
      preferenceShape: "sweet-spot",
      curveAffected: true,
    },
    {
      axisName: "Fun Factor",
      rating: 9,
      weight: 40,
      contribution: 3.6,
      source: "personal",
      bggOriginal: null,
      rawValue: 9,
      effectiveRating: 9,
      preferenceShape: "higher-is-better",
      curveAffected: false,
    },
  ],
};

describe("score get (vetoed game)", () => {
  const client = createMockClient({
    routes: {
      "GET /api/games/veto-123/score": {
        response: { ok: true, status: 200, data: scoreGetVetoedData },
      },
    },
  });

  test("human-readable output shows VETOED with hypothetical score", async () => {
    const output = await scoreGet(client, ["veto-123"], { json: false });
    expect(output).toContain("Too Complex Game");
    expect(output).toContain("VETOED");
    expect(output).toContain("hypothetical: 7.2");
  });

  test("human-readable output shows veto trigger details", async () => {
    const output = await scoreGet(client, ["veto-123"], { json: false });
    expect(output).toContain("Complexity");
    expect(output).toContain("scored 4.5");
    expect(output).toContain("threshold: above 4");
  });

  test("human-readable output shows breakdown with Raw column", async () => {
    const output = await scoreGet(client, ["veto-123"], { json: false });
    expect(output).toContain("Raw");
    expect(output).toContain("4.5");
    expect(output).toContain("1.75 *");
  });

  test("--json outputs full response including veto fields", async () => {
    const output = await scoreGet(client, ["veto-123"], { json: true });
    const parsed = JSON.parse(output) as {
      vetoed: boolean;
      vetoedBy: { axisName: string; threshold: number };
      hypotheticalScore: number;
    };
    expect(parsed.vetoed).toBe(true);
    expect(parsed.vetoedBy.axisName).toBe("Complexity");
    expect(parsed.vetoedBy.threshold).toBe(4);
    expect(parsed.hypotheticalScore).toBe(7.2);
  });
});

describe("score list with vetoed game", () => {
  const vetoedListData = {
    scored: [
      {
        gameId: "abc-123",
        gameName: "Wingspan",
        score: 7.9,
        ratedAxisCount: 4,
        totalAxisCount: 4,
        breakdown: [],
      },
      {
        gameId: "veto-123",
        gameName: "Too Complex Game",
        score: 0,
        ratedAxisCount: 4,
        totalAxisCount: 4,
        breakdown: [],
        vetoed: true,
        vetoedBy: {
          axisId: "ax-complexity",
          axisName: "Complexity",
          threshold: 4,
          direction: "above" as const,
          rawValue: 4.5,
        },
        hypotheticalScore: 7.2,
      },
    ],
    unscored: [],
  };

  test("shows VETOED with hypothetical in score list", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/scores": {
          response: { ok: true, status: 200, data: vetoedListData },
        },
      },
    });

    const output = await scoreList(client, [], { json: false });
    expect(output).toContain("VETOED (7.2)");
    expect(output).toContain("Wingspan");
    expect(output).toContain("7.9");
  });
});

const scoreGetUnscoredData = {
  gameId: "ghi-789",
  gameName: "Unrated Game",
  score: null,
  status: "not yet rated",
};

describe("score get (unrated game)", () => {
  const client = createMockClient({
    routes: {
      "GET /api/games/ghi-789/score": {
        response: { ok: true, status: 200, data: scoreGetUnscoredData },
      },
    },
  });

  test("human-readable output shows game name and not yet rated", async () => {
    const output = await scoreGet(client, ["ghi-789"], { json: false });
    expect(output).toContain("Unrated Game");
    expect(output).toContain("not yet rated");
  });

  test("--json outputs parseable JSON with null score", async () => {
    const output = await scoreGet(client, ["ghi-789"], { json: true });
    const parsed = JSON.parse(output) as { gameName: string; score: null; status: string };
    expect(parsed.gameName).toBe("Unrated Game");
    expect(parsed.score).toBeNull();
    expect(parsed.status).toBe("not yet rated");
  });
});
