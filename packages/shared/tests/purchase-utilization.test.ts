import { describe, expect, test } from "bun:test";
import {
  calculatePurchaseUtilization,
  resolveModeledPlayerCount,
  type FieldEvidence,
  type PlayerRangeEvidence,
  type Acquisition,
  type PurchaseUtilizationReason,
  type PurchaseUtilizationInput,
  type SuggestedPlayerPoll,
} from "../src";

const observedAt = "2026-08-26T12:00:00Z";
const valid = <Value extends number>(value: Value): FieldEvidence<number> => ({
  status: "valid",
  value,
  source: "bgg-thing",
  observedAt,
});
const missing = (): FieldEvidence<number> => ({
  status: "missing",
  source: "legacy-unknown",
  observedAt: null,
});
const invalid = (): FieldEvidence<number> => ({
  status: "invalid",
  evidence: { presence: "present", value: -1 },
  source: "legacy-unknown",
  observedAt: null,
});
const range = (minPlayers = 4, maxPlayers = minPlayers): PlayerRangeEvidence => ({
  status: "valid",
  value: { minPlayers, maxPlayers },
  source: "bgg-player-range",
  observedAt,
});
const noRange = (): PlayerRangeEvidence => ({
  status: "missing",
  source: "legacy-unknown",
  observedAt: null,
});
const poll = (
  buckets: Array<{
    playerCount: string;
    best: number;
    recommended?: number;
    notRecommended?: number;
  }> = [],
  state: "empty" | "usable" | "unusable" | "legacy-unknown" = buckets.length === 0
    ? "empty"
    : "usable",
): SuggestedPlayerPoll =>
  buckets.length === 0
    ? {
        status: "valid",
        state: state as "empty" | "legacy-unknown",
        buckets: [],
        source: "bgg-suggested-player-poll",
        observedAt,
      }
    : {
        status: "valid",
        state: state as "usable" | "unusable",
        buckets: buckets.map((bucket) => ({
          recommended: 0,
          notRecommended: 0,
          ...bucket,
        })) as [
          { playerCount: string; best: number; recommended: number; notRecommended: number },
          ...Array<{
            playerCount: string;
            best: number;
            recommended: number;
            notRecommended: number;
          }>,
        ],
        source: "bgg-suggested-player-poll",
        observedAt,
      };

function input(overrides: Partial<PurchaseUtilizationInput> = {}): PurchaseUtilizationInput {
  return {
    acquisition: {
      state: "purchase",
      amount: { hundredths: 6000, source: "manual", confirmedAt: observedAt },
    },
    entertainmentBenchmark: {
      state: "configured",
      amount: { hundredths: 800, source: "manual", confirmedAt: observedAt },
    },
    playCount: valid(10),
    duration: valid(90),
    playerRange: range(4),
    suggestedPlayerPoll: poll([{ playerCount: "4", best: 10 }]),
    fitness: "6.0",
    ...overrides,
  };
}

describe("purchase utilization canonical calculations", () => {
  test("calculates the $60 canonical example exactly", () => {
    const result = calculatePurchaseUtilization(input());

    expect(result.outcome).toBe("met");
    expect(result.outcomeLabel).toBe("Value threshold met");
    expect(result.components.modeledPlayerHours).toMatchObject({
      outcome: "calculated",
      display: "60 player-hours",
      value: { exact: { numerator: "60", denominator: "1" } },
    });
    expect(result.components.costPerModeledPlayerHour.display).toBe("$1.00");
    expect(result.components.valueMultiplier.display).toBe("8.00x");
    expect(result.components.valueRemaining.display).toBe("$0.00");
    expect(result.components.estimatedAdditionalPlays.display).toBe("0");
    expect(result.sort).toEqual({
      valueRemainingHundredths: "0",
      estimatedAdditionalPlays: { category: "finite", wholePlays: "0" },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test("calculates the $20 canonical example exactly", () => {
    const result = calculatePurchaseUtilization(
      input({
        acquisition: {
          state: "purchase",
          amount: { hundredths: 2000, source: "manual", confirmedAt: observedAt },
        },
        playCount: valid(2),
        duration: valid(30),
        playerRange: range(2),
        suggestedPlayerPoll: poll([{ playerCount: "2", best: 3 }]),
      }),
    );

    expect(result.outcomeLabel).toBe("Value threshold not yet met");
    expect(result.components.valueMultiplier.display).toBe("0.80x");
    expect(result.components.valueRemaining.display).toBe("$4.00");
    expect(result.components.estimatedAdditionalPlays.display).toBe("1");
  });

  test.each([
    ["1.0", "$1.33"],
    ["3.0", "$4.00"],
    ["6.0", "$8.00"],
    ["9.0", "$12.00"],
    ["10.0", "$13.33"],
  ])("scales fitness %s linearly", (fitness, display) => {
    expect(
      calculatePurchaseUtilization(input({ fitness })).components.fitnessAdjustedHourlyBenchmark
        .display,
    ).toBe(display);
  });

  test("uses exact threshold comparison and adaptive multiplier precision", () => {
    const thresholdInput = {
      acquisition: {
        state: "purchase" as const,
        amount: { hundredths: 10000, source: "manual" as const, confirmedAt: observedAt },
      },
      playCount: valid(1),
      duration: valid(60),
      playerRange: range(1),
      suggestedPlayerPoll: poll([{ playerCount: "1", best: 1 }]),
      fitness: "6.0",
    };
    const below = calculatePurchaseUtilization(
      input({
        ...thresholdInput,
        entertainmentBenchmark: {
          state: "configured",
          amount: { hundredths: 9999, source: "manual", confirmedAt: observedAt },
        },
      }),
    );
    const at = calculatePurchaseUtilization(
      input({
        ...thresholdInput,
        entertainmentBenchmark: {
          state: "configured",
          amount: { hundredths: 10000, source: "manual", confirmedAt: observedAt },
        },
      }),
    );
    const above = calculatePurchaseUtilization(
      input({
        ...thresholdInput,
        entertainmentBenchmark: {
          state: "configured",
          amount: { hundredths: 10001, source: "manual", confirmedAt: observedAt },
        },
      }),
    );

    expect([below.outcome, at.outcome, above.outcome]).toEqual(["not-met", "met", "met"]);
    expect([
      below.components.valueMultiplier.display,
      at.components.valueMultiplier.display,
    ]).toEqual(["0.9999x", "1.00x"]);
    expect(above.components.valueMultiplier.display).toBe("1.0001x");
  });

  test.each([
    [61, "<$0.01", "0"],
    [60, "$0.01", "1"],
    [59, "$0.01", "1"],
  ])("pins remaining display around half a cent at duration %i", (duration, display, key) => {
    const result = calculatePurchaseUtilization(
      input({
        acquisition: {
          state: "purchase",
          amount: { hundredths: 1, source: "manual", confirmedAt: observedAt },
        },
        entertainmentBenchmark: {
          state: "configured",
          amount: { hundredths: 1, source: "manual", confirmedAt: observedAt },
        },
        playCount: valid(1),
        duration: valid(duration),
        playerRange: range(1),
        suggestedPlayerPoll: poll([{ playerCount: "1", best: 1 }]),
        fitness: "3.0",
      }),
    );
    expect(result.components.valueRemaining.display).toBe(display);
    expect(result.sort.valueRemainingHundredths).toBe(key);
  });

  test("ceilings fractional additional plays and serializes unbounded results", () => {
    const result = calculatePurchaseUtilization(
      input({
        acquisition: {
          state: "purchase",
          amount: {
            hundredths: Number.MAX_SAFE_INTEGER,
            source: "manual",
            confirmedAt: observedAt,
          },
        },
        entertainmentBenchmark: {
          state: "configured",
          amount: { hundredths: 1, source: "manual", confirmedAt: observedAt },
        },
        playCount: valid(0),
        duration: valid(1),
        playerRange: range(1),
        suggestedPlayerPoll: poll([{ playerCount: "1", best: 1 }]),
      }),
    );
    expect(result.components.estimatedAdditionalPlays).toMatchObject({
      outcome: "calculated",
      value: { wholePlays: "540431955284459460" },
    });
    expect(result.sort.estimatedAdditionalPlays).toEqual({
      category: "finite",
      wholePlays: "540431955284459460",
    });
  });

  test("keeps an exact whole additional-play quotient exact", () => {
    const result = calculatePurchaseUtilization(
      input({
        acquisition: {
          state: "purchase",
          amount: { hundredths: 1600, source: "manual", confirmedAt: observedAt },
        },
        playCount: valid(0),
        duration: valid(60),
        playerRange: range(1),
        suggestedPlayerPoll: poll([{ playerCount: "1", best: 1 }]),
      }),
    );
    expect(result.components.estimatedAdditionalPlays.display).toBe("2");
  });
});

describe("modeled player count resolution", () => {
  test("uses one poll winner and retains provenance", () => {
    expect(
      resolveModeledPlayerCount(
        poll([
          { playerCount: "2", best: 4 },
          { playerCount: "3", best: 8 },
        ]),
        range(1, 5),
      ),
    ).toMatchObject({
      outcome: "calculated",
      display: "3 players",
      value: {
        resolution: "poll-winner",
        winningBestVotes: 8,
        winningPlayerCounts: ["3"],
        source: "bgg-suggested-player-poll",
        observedAt,
      },
    });
  });

  test("averages distinct tied winners and deduplicates repeated buckets", () => {
    const result = resolveModeledPlayerCount(
      poll([
        { playerCount: "2", best: 7 },
        { playerCount: "2", best: 7 },
        { playerCount: "5", best: 7 },
        { playerCount: "4+", best: 100 },
        { playerCount: "6", best: 0 },
      ]),
      range(1, 8),
    );
    expect(result).toMatchObject({
      outcome: "calculated",
      display: "3.5 players",
      value: {
        exact: { numerator: "7", denominator: "2" },
        resolution: "poll-tie-average",
        winningPlayerCounts: ["2", "5"],
      },
    });
  });

  test.each(["absent", "empty", "legacy-unknown"] as const)(
    "falls back from %s poll state to the range midpoint",
    (state) => {
      const emptyPoll: SuggestedPlayerPoll = {
        status: "valid",
        state,
        buckets: [],
        source: "legacy-unknown",
        observedAt: null,
      };
      expect(resolveModeledPlayerCount(emptyPoll, range(2, 5))).toMatchObject({
        outcome: "calculated",
        display: "3.5 players",
        value: { resolution: "player-range-midpoint", winningBestVotes: null },
      });
    },
  );

  test("falls back for unusable exact buckets and reports invalid or missing evidence", () => {
    expect(
      resolveModeledPlayerCount(poll([{ playerCount: "4+", best: 4 }], "unusable"), range(2, 4))
        .display,
    ).toBe("3 players");
    expect(resolveModeledPlayerCount(poll(), noRange())).toMatchObject({
      outcome: "unavailable",
      reasons: ["missing-modeled-player-count"],
    });
    const invalidRange: PlayerRangeEvidence = {
      status: "invalid",
      evidence: { minPlayers: { presence: "missing" }, maxPlayers: { presence: "missing" } },
      source: "legacy-unknown",
      observedAt: null,
    };
    expect(resolveModeledPlayerCount(poll(), invalidRange)).toMatchObject({
      outcome: "unavailable",
      reasons: ["invalid-modeled-player-count"],
    });
    const invalidPoll: SuggestedPlayerPoll = {
      status: "invalid",
      state: "unusable",
      buckets: [],
      evidence: { presence: "present", value: ["malformed"] },
      source: "legacy-unknown",
      observedAt: null,
    };
    expect(resolveModeledPlayerCount(invalidPoll, noRange())).toMatchObject({
      outcome: "unavailable",
      reasons: ["invalid-modeled-player-count"],
    });
  });
});

describe("purchase utilization precedence and partial components", () => {
  test.each([null, "malformed"])(
    "fitness zero overrides a %s benchmark and missing use evidence",
    (benchmarkState) => {
      const result = calculatePurchaseUtilization(
        input({
          entertainmentBenchmark:
            benchmarkState === null
              ? null
              : { state: "invalid", evidence: { presence: "present", value: benchmarkState } },
          playCount: missing(),
          duration: invalid(),
          playerRange: noRange(),
          suggestedPlayerPoll: poll(),
          fitness: "0.0",
        }),
      );
      expect(result.outcome).toBe("not-met");
      expect(result.components.fitnessAdjustedHourlyBenchmark.display).toBe("$0.00");
      expect(result.components.valueMultiplier.display).toBe("0.00x");
      expect(result.components.valueRemaining.display).toBe("$60.00");
      expect(result.components.estimatedAdditionalPlays.outcome).toBe("unreachable");
      expect(result.sort.estimatedAdditionalPlays.category).toBe("unreachable");
    },
  );

  test.each([
    [
      "6.0",
      input().entertainmentBenchmark,
      valid(90),
      range(4),
      poll([{ playerCount: "4", best: 1 }]),
    ],
    [null, null, missing(), noRange(), poll()],
    [
      "bad",
      { state: "invalid", evidence: { presence: "missing" } } as const,
      invalid(),
      noRange(),
      poll(),
    ],
    ["6.0", null, valid(90), range(4), poll([{ playerCount: "4", best: 1 }])],
  ])(
    "zero plays keep multiplier and remaining calculated across missing inputs",
    (fitness, benchmark, duration, playerRange, suggestedPlayerPoll) => {
      const result = calculatePurchaseUtilization(
        input({
          fitness,
          entertainmentBenchmark: benchmark,
          playCount: valid(0),
          duration,
          playerRange,
          suggestedPlayerPoll,
        }),
      );
      expect(result.outcome).toBe("not-met");
      expect(result.components.modeledPlayerHours.display).toBe("0 player-hours");
      expect(result.components.valueMultiplier.display).toBe("0.00x");
      expect(result.components.valueRemaining.display).toBe("$60.00");
    },
  );

  test("preserves zero-play precedence across the full missing-input matrix", () => {
    const fitnessOptions = ["6.0", null, "bad"];
    const benchmarkOptions: PurchaseUtilizationInput["entertainmentBenchmark"][] = [
      input().entertainmentBenchmark,
      null,
      { state: "invalid", evidence: { presence: "missing" } },
    ];
    const durationOptions = [valid(90), missing(), invalid()];
    const invalidRange: PlayerRangeEvidence = {
      status: "invalid",
      evidence: { minPlayers: { presence: "missing" }, maxPlayers: { presence: "missing" } },
      source: "legacy-unknown",
      observedAt: null,
    };
    const playerOptions: Array<[PlayerRangeEvidence, SuggestedPlayerPoll]> = [
      [range(4), poll([{ playerCount: "4", best: 1 }])],
      [noRange(), poll()],
      [invalidRange, poll()],
    ];

    for (const fitness of fitnessOptions) {
      for (const entertainmentBenchmark of benchmarkOptions) {
        for (const duration of durationOptions) {
          for (const [playerRange, suggestedPlayerPoll] of playerOptions) {
            const result = calculatePurchaseUtilization(
              input({
                fitness,
                entertainmentBenchmark,
                playCount: valid(0),
                duration,
                playerRange,
                suggestedPlayerPoll,
              }),
            );
            expect(result.outcome).toBe("not-met");
            expect(result.components.modeledPlayerHours.display).toBe("0 player-hours");
            expect(result.components.valueMultiplier.display).toBe("0.00x");
            expect(result.components.valueRemaining.display).toBe("$60.00");
          }
        }
      }
    }
  });

  test("keeps cost per recorded play when modeled inputs and benchmark are missing", () => {
    const result = calculatePurchaseUtilization(
      input({
        entertainmentBenchmark: null,
        duration: missing(),
        playerRange: noRange(),
        suggestedPlayerPoll: poll(),
      }),
    );
    expect(result.components.costPerRecordedPlay.display).toBe("$6.00");
    expect(result.components.costPerModeledPlayerHour.outcome).toBe("unavailable");
    expect(result.reasons).toEqual([
      "missing-benchmark",
      "missing-modeled-duration",
      "missing-modeled-player-count",
    ]);
  });

  test("rejects non-canonical or out-of-range fitness input", () => {
    for (const fitness of ["6", "+6.0", "06.0", "10.1", "-1.0", "NaN"]) {
      const result = calculatePurchaseUtilization(input({ fitness }));
      expect(result.outcome).toBe("unavailable");
      expect(result.reasons).toContain("invalid-fitness");
      expect(result.evidence.fitness.status).toBe("invalid");
    }
  });

  test("reports independently missing fitness and benchmark inputs", () => {
    const result = calculatePurchaseUtilization(
      input({ fitness: null, entertainmentBenchmark: null }),
    );
    expect(result.components.fitnessAdjustedHourlyBenchmark.reasons).toEqual([
      "missing-fitness",
      "missing-benchmark",
    ]);
    expect(result.reasons).toContain("missing-fitness");
    expect(result.reasons).toContain("missing-benchmark");
  });

  test("classifies domain-invalid tagged inputs without throwing", () => {
    const invalidBenchmark = calculatePurchaseUtilization(
      input({
        entertainmentBenchmark: {
          state: "configured",
          amount: { hundredths: 0, source: "manual", confirmedAt: observedAt },
        },
      }),
    );
    expect(invalidBenchmark.outcome).toBe("unavailable");
    expect(invalidBenchmark.reasons).toContain("invalid-benchmark");

    const invalidUse = calculatePurchaseUtilization(
      input({
        playCount: valid(-1),
        duration: valid(0),
        playerRange: range(4, 2),
        suggestedPlayerPoll: poll(),
      }),
    );
    expect(invalidUse.reasons).toContain("invalid-play-count");
    expect(invalidUse.components.modeledPlayerHours.reasons).toContain("invalid-modeled-duration");
    expect(invalidUse.components.modeledPlayerHours.reasons).toContain(
      "invalid-modeled-player-count",
    );

    expect(
      calculatePurchaseUtilization(
        input({
          acquisition: {
            state: "purchase",
            amount: { hundredths: -1, source: "manual", confirmedAt: observedAt },
          },
        }),
      ).reasons,
    ).toEqual(["invalid-acquisition"]);
  });

  test.each([
    [{ state: "unknown" } as const, "unavailable", "missing-acquisition"],
    [
      { state: "invalid", evidence: { presence: "missing" } } as const,
      "unavailable",
      "invalid-acquisition",
    ],
    [{ state: "gift" } as const, "not-applicable", "no-owner-cost"],
    [
      {
        state: "purchase",
        amount: { hundredths: 0, source: "manual", confirmedAt: observedAt },
      } as const,
      "not-applicable",
      "no-owner-cost",
    ],
  ] satisfies Array<[Acquisition, "unavailable" | "not-applicable", PurchaseUtilizationReason]>)(
    "handles acquisition state %#",
    (acquisition, outcome, reason) => {
      const result = calculatePurchaseUtilization(input({ acquisition }));
      expect(result.outcome).toBe(outcome);
      expect(result.reasons).toEqual([reason]);
      expect(result.sort.valueRemainingHundredths).toBeNull();
      expect(result.components.modeledPlayerHours.outcome).toBe("calculated");
      if (acquisition.state === "gift") {
        expect(result.components.valueMultiplier.display).toBe("Gift; no owner cost.");
      }
      if (acquisition.state === "purchase") {
        expect(result.components.valueMultiplier.display).toBe("No owner cost.");
      }
    },
  );

  test("contains required labels, assumptions, provenance, and no prohibited judgment", () => {
    const result = calculatePurchaseUtilization(input());
    const serialized = JSON.stringify(result);
    for (const label of [
      "Value threshold met",
      "Value remaining",
      "Estimated additional plays to value threshold",
      "Cost per recorded play",
      "Cost per modeled player-hour",
      "Fitness-adjusted hourly benchmark",
    ]) {
      expect(serialized).toContain(label);
    }
    expect(result.evidence.playCount).toEqual(valid(10));
    expect(result.assumptions.modeledSessions).toContain("actual sessions may differ");
    expect(result.assumptions.futurePlays).toContain("future plays");
    for (const prohibited of ["resale", "investment", "buy", "keep", "sell", "avoid"]) {
      expect(serialized.toLowerCase()).not.toContain(prohibited);
    }
  });
});
