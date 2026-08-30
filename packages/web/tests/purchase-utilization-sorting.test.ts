import { describe, expect, test } from "bun:test";
import {
  calculatePurchaseUtilization,
  type Game,
  type GameWithPurchaseUtilization,
  type PurchaseUtilizationResult,
} from "@shelf-judge/shared";
import {
  buildSortFields,
  DEFAULT_SORT,
  getScoreDisplay,
  loadSort,
  saveSort,
  sortGames,
} from "@/lib/collection-utils";

const NO_TOURNAMENT_STATS = {};

function makeGame(id: string, name: string): Game {
  return {
    id,
    bggId: null,
    name,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: null,
    imageUrl: null,
    bggData: null,
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
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

type AdditionalProjection = PurchaseUtilizationResult["sort"]["estimatedAdditionalPlays"];

interface UtilizationFixture {
  id: string;
  name: string;
  remainingKey?: string | null;
  remainingDisplay?: string;
  additional?: AdditionalProjection;
  additionalDisplay?: string;
  displayScore?: string | null;
}

function makeUtilizationGame({
  id,
  name,
  remainingKey = null,
  remainingDisplay = "Unavailable",
  additional = { category: "unavailable", wholePlays: null },
  additionalDisplay,
  displayScore = "7.0",
}: UtilizationFixture): GameWithPurchaseUtilization {
  const game = makeGame(id, name);
  const base = calculatePurchaseUtilization({
    acquisition: game.acquisition,
    entertainmentBenchmark: null,
    playCount: game.playCountEvidence,
    duration: game.durationEvidence,
    playerRange: game.playerRangeEvidence,
    suggestedPlayerPoll: game.suggestedPlayerPoll,
    fitness: displayScore,
  });

  const valueRemaining: PurchaseUtilizationResult["components"]["valueRemaining"] =
    remainingKey === null
      ? { label: "Value remaining", outcome: "unavailable", display: "Unavailable", reasons: [] }
      : {
          label: "Value remaining",
          outcome: "calculated",
          value: { exact: { numerator: remainingKey, denominator: "1" } },
          display: remainingDisplay,
          reasons: [],
        };
  const estimatedAdditionalPlays: PurchaseUtilizationResult["components"]["estimatedAdditionalPlays"] =
    additional.category === "finite"
      ? {
          label: "Estimated additional plays to value threshold",
          outcome: "calculated",
          value: { wholePlays: additional.wholePlays },
          display: additionalDisplay ?? additional.wholePlays,
          reasons: [],
        }
      : additional.category === "unreachable"
        ? {
            label: "Estimated additional plays to value threshold",
            outcome: "unreachable",
            display: "Unreachable at current fitness",
            reasons: ["unreachable-at-current-fitness"],
          }
        : additional.category === "not-applicable"
          ? {
              label: "Estimated additional plays to value threshold",
              outcome: "not-applicable",
              display: additionalDisplay ?? "No owner cost.",
              reasons: ["no-owner-cost"],
            }
          : {
              label: "Estimated additional plays to value threshold",
              outcome: "unavailable",
              display: "Unavailable",
              reasons: [],
            };

  return {
    game,
    score:
      displayScore === null
        ? null
        : {
            score: Number(displayScore),
            ratedAxisCount: 1,
            totalAxisCount: 1,
            breakdown: [],
            vetoed: false,
            vetoedBy: null,
            hypotheticalScore: null,
            predictionMeta: null,
            redundancyAdjustment: null,
          },
    displayScore,
    purchaseUtilization: {
      ...base,
      components: { ...base.components, valueRemaining, estimatedAdditionalPlays },
      sort: { valueRemainingHundredths: remainingKey, estimatedAdditionalPlays: additional },
    },
  };
}

function orderedIds(
  games: GameWithPurchaseUtilization[],
  field: "valueRemaining" | "estimatedAdditionalPlays",
  direction: "asc" | "desc",
): string[] {
  const result = sortGames(games, field, direction, NO_TOURNAMENT_STATS);
  return [...result.withValue, ...result.withoutValue].map((game) => game.game.id);
}

describe("purchase utilization sort fields", () => {
  test("adds both built-ins without changing the default sort", () => {
    const fields = buildSortFields([], false, false);
    expect(fields.find((field) => field.id === "valueRemaining")?.label).toBe("Value Remaining");
    expect(fields.find((field) => field.id === "estimatedAdditionalPlays")?.label).toBe(
      "Estimated Additional Plays to Value Threshold",
    );
    expect(DEFAULT_SORT).toEqual({ field: "fitness", direction: "desc" });
  });

  test("preserves new fields and directions in existing localStorage state", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const values = new Map<string, string>();
    const temporaryStorage: Storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };

    if (!originalWindow) {
      Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
    }
    if (!originalStorage) {
      Object.defineProperty(globalThis, "localStorage", {
        value: temporaryStorage,
        configurable: true,
      });
    }
    const storage = originalStorage ? globalThis.localStorage : temporaryStorage;
    const storageKey = "shelf-judge-sort";
    const originalValue = storage.getItem(storageKey);
    try {
      saveSort({ field: "estimatedAdditionalPlays", direction: "asc" });
      expect(loadSort()).toEqual({ field: "estimatedAdditionalPlays", direction: "asc" });
    } finally {
      if (originalValue === null) storage.removeItem(storageKey);
      else storage.setItem(storageKey, originalValue);
      if (!originalWindow) Reflect.deleteProperty(globalThis, "window");
      if (!originalStorage) Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});

describe("value remaining sorting", () => {
  const games = [
    makeUtilizationGame({
      id: "ordinary",
      name: "Ordinary",
      remainingKey: "125",
      remainingDisplay: "$1.25",
    }),
    makeUtilizationGame({
      id: "zero-play",
      name: "Zero Play",
      remainingKey: "2000",
      remainingDisplay: "$20.00",
    }),
    makeUtilizationGame({
      id: "fitness-zero",
      name: "Fitness Zero",
      remainingKey: "6000",
      remainingDisplay: "$60.00",
    }),
    makeUtilizationGame({ id: "unavailable", name: "Unavailable" }),
  ];

  test("sorts calculated ordinary, zero-play, and fitness-zero keys in both directions", () => {
    expect(orderedIds(games, "valueRemaining", "asc")).toEqual([
      "ordinary",
      "zero-play",
      "fitness-zero",
      "unavailable",
    ]);
    expect(orderedIds(games, "valueRemaining", "desc")).toEqual([
      "fitness-zero",
      "zero-play",
      "ordinary",
      "unavailable",
    ]);
  });

  test("uses rounded hundredths and keeps exact-zero/sub-cent ties ascending in both directions", () => {
    const exactZero = makeUtilizationGame({
      id: "zero",
      name: "Zulu",
      remainingKey: "0",
      remainingDisplay: "$0.00",
    });
    const subCent = makeUtilizationGame({
      id: "sub-cent",
      name: "Alpha",
      remainingKey: "0",
      remainingDisplay: "<$0.01",
    });
    const roundedTie = makeUtilizationGame({
      id: "rounded",
      name: "Mike",
      remainingKey: "0",
      remainingDisplay: "$0.00",
    });

    expect(orderedIds([exactZero, subCent, roundedTie], "valueRemaining", "asc")).toEqual([
      "sub-cent",
      "rounded",
      "zero",
    ]);
    expect(orderedIds([exactZero, subCent, roundedTie], "valueRemaining", "desc")).toEqual([
      "sub-cent",
      "rounded",
      "zero",
    ]);
  });
});

describe("estimated additional plays sorting", () => {
  const games = [
    makeUtilizationGame({
      id: "finite-zero",
      name: "Finite Zero",
      additional: { category: "finite", wholePlays: "0" },
    }),
    makeUtilizationGame({
      id: "finite-two",
      name: "Finite Two",
      additional: { category: "finite", wholePlays: "2" },
    }),
    makeUtilizationGame({
      id: "unsafe",
      name: "Unsafe Integer",
      additional: { category: "finite", wholePlays: "9007199254740993" },
    }),
    makeUtilizationGame({
      id: "unreachable",
      name: "Unreachable",
      additional: { category: "unreachable", wholePlays: null },
    }),
    makeUtilizationGame({ id: "unavailable", name: "Zulu Unavailable" }),
    makeUtilizationGame({
      id: "gift",
      name: "Alpha Gift",
      additional: { category: "not-applicable", wholePlays: null },
      additionalDisplay: "Gift; no owner cost.",
    }),
    makeUtilizationGame({
      id: "zero-cost",
      name: "Mike Zero Cost",
      additional: { category: "not-applicable", wholePlays: null },
      additionalDisplay: "No owner cost.",
    }),
  ];

  test("orders finite, unreachable, then unavailable/not-applicable ascending", () => {
    expect(orderedIds(games, "estimatedAdditionalPlays", "asc")).toEqual([
      "finite-zero",
      "finite-two",
      "unsafe",
      "unreachable",
      "gift",
      "zero-cost",
      "unavailable",
    ]);
  });

  test("orders unreachable, finite, then unavailable/not-applicable descending", () => {
    expect(orderedIds(games, "estimatedAdditionalPlays", "desc")).toEqual([
      "unreachable",
      "unsafe",
      "finite-two",
      "finite-zero",
      "gift",
      "zero-cost",
      "unavailable",
    ]);
  });

  test("compares unsafe-size finite integer strings exactly", () => {
    const safeBoundary = makeUtilizationGame({
      id: "safe",
      name: "Safe Boundary",
      additional: { category: "finite", wholePlays: "9007199254740991" },
    });
    const firstUnsafe = makeUtilizationGame({
      id: "first-unsafe",
      name: "First Unsafe",
      additional: { category: "finite", wholePlays: "9007199254740992" },
    });
    const secondUnsafe = makeUtilizationGame({
      id: "second-unsafe",
      name: "Second Unsafe",
      additional: { category: "finite", wholePlays: "9007199254740993" },
    });
    expect(
      orderedIds([secondUnsafe, safeBoundary, firstUnsafe], "estimatedAdditionalPlays", "asc"),
    ).toEqual(["safe", "first-unsafe", "second-unsafe"]);
  });

  test("keeps finite ties in ascending name and ID order in both directions", () => {
    const later = makeUtilizationGame({
      id: "b",
      name: "Same",
      additional: { category: "finite", wholePlays: "12" },
    });
    const earlier = makeUtilizationGame({
      id: "a",
      name: "Same",
      additional: { category: "finite", wholePlays: "12" },
    });
    expect(orderedIds([later, earlier], "estimatedAdditionalPlays", "asc")).toEqual(["a", "b"]);
    expect(orderedIds([later, earlier], "estimatedAdditionalPlays", "desc")).toEqual(["a", "b"]);
  });
});

describe("utilization tie-breaking and display", () => {
  test("uses NFC-equivalent names and then stable IDs in both directions", () => {
    const composed = makeUtilizationGame({ id: "b", name: "\u00e9", remainingKey: "5" });
    const decomposed = makeUtilizationGame({ id: "a", name: "e\u0301", remainingKey: "5" });
    expect(orderedIds([composed, decomposed], "valueRemaining", "asc")).toEqual(["a", "b"]);
    expect(orderedIds([composed, decomposed], "valueRemaining", "desc")).toEqual(["a", "b"]);
  });

  test("orders BMP before supplementary code points when their scalar values require it", () => {
    const bmp = makeUtilizationGame({ id: "bmp", name: "\uE000", remainingKey: "5" });
    const supplementary = makeUtilizationGame({
      id: "supplementary",
      name: "\u{10000}",
      remainingKey: "5",
    });
    expect(orderedIds([supplementary, bmp], "valueRemaining", "asc")).toEqual([
      "bmp",
      "supplementary",
    ]);
  });

  test("uses ascending stable IDs for equal names and unavailable ties", () => {
    const later = makeUtilizationGame({ id: "id-b", name: "Same" });
    const earlier = makeUtilizationGame({ id: "id-a", name: "Same" });
    expect(orderedIds([later, earlier], "estimatedAdditionalPlays", "asc")).toEqual([
      "id-a",
      "id-b",
    ]);
    expect(orderedIds([later, earlier], "estimatedAdditionalPlays", "desc")).toEqual([
      "id-a",
      "id-b",
    ]);
  });

  test("shows daemon component labels and canonical fitness display", () => {
    const game = makeUtilizationGame({
      id: "labels",
      name: "Labels",
      remainingKey: "0",
      remainingDisplay: "<$0.01",
      additional: { category: "unreachable", wholePlays: null },
      additionalDisplay: "Unreachable at current fitness",
      displayScore: "1.3",
    });
    expect(getScoreDisplay(game, "valueRemaining", NO_TOURNAMENT_STATS).text).toBe("<$0.01");
    expect(getScoreDisplay(game, "estimatedAdditionalPlays", NO_TOURNAMENT_STATS).text).toBe(
      "Unreachable at current fitness",
    );
    expect(getScoreDisplay(game, "fitness", NO_TOURNAMENT_STATS).text).toBe("1.3");
  });
});
