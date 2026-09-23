import { describe, expect, test } from "bun:test";
import {
  AttentionCandidateEvaluationSchema,
  CollectionSchema,
  ExactRational,
  calculatePurchaseUtilization,
  createInitialEntityMetadata,
  type Collection,
  type DurableGame,
  type PurchaseUtilizationResult,
} from "@shelf-judge/shared";
import {
  computeAttentionCandidates,
  type AttentionCandidateEngineInput,
} from "../src/services/attention-candidate-engine.js";
import {
  attentionRuleCatalog,
  type AttentionRuleDefinition,
  type AttentionRuleMatch,
} from "../src/services/attention-rule-catalog.js";
import { projectPurchaseUtilization } from "../src/services/purchase-utilization-projection.js";
import { profileSourceIdentity } from "../src/services/profile-source-coordinator.js";
import { createTestApp, jsonRequest } from "./helpers/test-app.js";

const observedAt = "2026-01-01T00:00:00.000Z";
const evaluatedAt = "2026-07-01T12:00:00.000Z";
const fingerprint = "a".repeat(64);

function sourceIdentity(
  overrides: Partial<AttentionCandidateEngineInput["displayedFitnessSourceIdentity"]> = {},
): AttentionCandidateEngineInput["displayedFitnessSourceIdentity"] {
  return {
    tournamentHash: "a".repeat(64),
    predictionSettingsHash: "b".repeat(64),
    redundancySettingsHash: "c".repeat(64),
    ...overrides,
  };
}

function game(overrides: Partial<DurableGame> & { id: string; name?: string }): DurableGame {
  const { id, name = id, ...rest } = overrides;
  return {
    id,
    name,
    bggId: null,
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    yearPublished: null,
    minPlayers: null,
    maxPlayers: null,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: null,
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "valid", value: 60, source: "manual", observedAt },
    playerRangeEvidence: {
      status: "valid",
      value: { minPlayers: 2, maxPlayers: 2 },
      source: "manual",
      observedAt,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    ownerNote: { state: "missing", version: 0, updatedAt: null },
    createdAt: observedAt,
    updatedAt: observedAt,
    ...rest,
  };
}

function collection(games: DurableGame[], overrides: Partial<Collection> = {}): Collection {
  return {
    schemaVersion: 8,
    revision: 1,
    id: "collection",
    name: "Collection",
    axes: [],
    games,
    intentions: [],
    bggPlaySessions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: observedAt,
    updatedAt: observedAt,
    ...overrides,
  };
}

function input(
  collectionValue: Collection,
  additions: Partial<AttentionCandidateEngineInput> = {},
): AttentionCandidateEngineInput {
  return {
    collection: collectionValue,
    evaluatedAt,
    displayedFitness: collectionValue.games.map((entry) => ({ game: entry, score: null })),
    purchaseUtilizationProjectionByGameId: new Map(),
    displayedFitnessSourceIdentity: sourceIdentity(),
    ...additions,
  };
}

function currentCount(
  value: number,
): Pick<DurableGame, "playCountEvidence" | "latestPlayCountCheck"> {
  return {
    playCountEvidence: { status: "valid", value, source: "manual", observedAt },
    latestPlayCountCheck: { status: "valid", value, observedAt },
  };
}

function utilization(
  numerator: string,
  denominator: string,
  outcome: PurchaseUtilizationResult["outcome"] = "not-met",
): PurchaseUtilizationResult {
  const result = calculatePurchaseUtilization({
    acquisition: {
      state: "purchase",
      amount: { hundredths: 1000, source: "manual", confirmedAt: observedAt },
    },
    entertainmentBenchmark: {
      state: "configured",
      amount: { hundredths: 1000, source: "manual", confirmedAt: observedAt },
    },
    playCount: { status: "valid", value: 1, source: "manual", observedAt },
    duration: { status: "valid", value: 60, source: "manual", observedAt },
    playerRange: {
      status: "valid",
      value: { minPlayers: 2, maxPlayers: 2 },
      source: "manual",
      observedAt,
    },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt,
    },
    fitness: "6.0",
  });
  result.outcome = outcome;
  result.components.valueMultiplier = {
    label: "Value multiplier",
    outcome: "calculated",
    value: { exact: { numerator, denominator }, status: outcome === "met" ? "met" : "not-met" },
    display: `${numerator}/${denominator}`,
    reasons: [],
  };
  return result;
}

/** Narrow malformed-result seam: normal production inputs use projectPurchaseUtilization unchanged. */
function projection(gameValue: DurableGame, purchaseUtilization: PurchaseUtilizationResult) {
  return {
    ...projectPurchaseUtilization({ game: gameValue, score: null }, null),
    purchaseUtilization,
  };
}

function synthetic(
  id: string,
  score: ExactRational,
  supersedes: readonly string[] = [],
  dependencies: AttentionRuleDefinition["dependencies"] = [{ scope: "local", key: "synthetic" }],
): AttentionRuleDefinition {
  return {
    id,
    version: 1,
    dependencyVersion: 1,
    scoringVersion: 1,
    categoryWeight: score,
    supersedes,
    dependencies,
    evaluate(context): AttentionRuleMatch | null {
      return {
        signalStrength: new ExactRational(1n),
        reason: context.game.name,
        question: "Decide?",
        actions: ["open-game"],
        correctionDestination: null,
        fingerprint,
        nextEvaluationBoundary: null,
      };
    },
  };
}

describe("attention candidate engine", () => {
  test("has exactly four complete production definitions and accepts a synthetic catalog without dispatch edits", () => {
    expect(attentionRuleCatalog.map((rule) => rule.id)).toEqual([
      "never-played",
      "dormant",
      "underused-purchase",
      "explicit-intention",
    ]);
    for (const rule of attentionRuleCatalog) {
      expect(rule.version).toBeGreaterThan(0);
      expect(rule.dependencyVersion).toBeGreaterThan(0);
      expect(rule.scoringVersion).toBeGreaterThan(0);
      expect(rule.dependencies.length).toBeGreaterThan(0);
      expect(typeof rule.evaluate).toBe("function");
    }
    const result = computeAttentionCandidates(
      input(collection([game({ id: "game" })]), {
        catalog: [synthetic("future-rule", new ExactRational(1n, 2n))],
      }),
    );
    expect(result.winners[0]?.winner.ruleId).toBe("future-rule");
  });

  test("makes an owned row for winner, abstention, and active whole-game disposition only", () => {
    const winner = game({ id: "winner", ...currentCount(0) });
    const none = game({ id: "none" });
    const hidden = game({ id: "hidden", ...currentCount(0) });
    const previous = game({ id: "previous", ownership: "previously-owned", ...currentCount(0) });
    const source = collection([winner, none, hidden, previous], {
      attentionDispositions: [
        {
          gameId: "hidden",
          kind: "snoozed",
          ruleId: "never-played",
          ruleVersion: 1,
          fingerprint,
          responseAt: "2026-07-01T00:00:00.000Z",
          expiresAt: "2026-07-31T00:00:00.000Z",
          version: 1,
        },
      ],
    });
    const result = computeAttentionCandidates(input(source));
    expect(
      result.evaluations.map((entry) => [
        entry.gameId,
        entry.winner?.ruleId ?? null,
        entry.disposition?.kind ?? null,
      ]),
    ).toEqual([
      ["winner", "never-played", null],
      ["none", null, null],
      ["hidden", null, "snoozed"],
    ]);
  });

  test("rejects each invalid exact component and product at the runtime boundary", () => {
    const base = {
      gameId: "game",
      winner: {
        ruleId: "rule",
        ruleVersion: 1,
        signalStrength: { numerator: "1", denominator: "2" },
        categoryWeight: { numerator: "4", denominator: "5" },
        attentionScore: { numerator: "2", denominator: "5" },
        fingerprint,
      },
      disposition: null,
      nextEvaluationBoundary: null,
      dependencyVersion: 1,
      ruleCatalogVersion: 1,
    };
    expect(AttentionCandidateEvaluationSchema.safeParse(base).success).toBe(true);
    expect(
      AttentionCandidateEvaluationSchema.safeParse({
        ...base,
        winner: { ...base.winner, signalStrength: { numerator: "2", denominator: "1" } },
      }).success,
    ).toBe(false);
    expect(
      AttentionCandidateEvaluationSchema.safeParse({
        ...base,
        winner: { ...base.winner, categoryWeight: { numerator: "2", denominator: "1" } },
      }).success,
    ).toBe(false);
    expect(
      AttentionCandidateEvaluationSchema.safeParse({
        ...base,
        winner: { ...base.winner, attentionScore: { numerator: "2", denominator: "1" } },
      }).success,
    ).toBe(false);
    expect(
      AttentionCandidateEvaluationSchema.safeParse({
        ...base,
        winner: { ...base.winner, attentionScore: { numerator: "1", denominator: "2" } },
      }).success,
    ).toBe(false);
  });

  test("requires current, safe exact-zero evidence for never played", () => {
    const variants = [
      game({ id: "valid", ...currentCount(0) }),
      game({ id: "missing" }),
      game({
        id: "invalid",
        playCountEvidence: {
          status: "invalid",
          source: "manual",
          observedAt,
          evidence: { presence: "present", value: "bad" },
        },
        latestPlayCountCheck: { status: "valid", value: 0, observedAt },
      }),
      game({
        id: "stale",
        playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt },
        latestPlayCountCheck: { status: "valid", value: 1, observedAt },
      }),
      game({
        id: "timeless",
        playCountEvidence: { status: "valid", value: 0, source: "manual", observedAt: null },
        latestPlayCountCheck: { status: "valid", value: 0, observedAt },
      }),
      game({ id: "negative", ...currentCount(-1) }),
      game({ id: "unsafe", ...currentCount(Number.MAX_SAFE_INTEGER + 1) }),
    ];
    const result = computeAttentionCandidates(input(collection(variants)));
    expect(result.winners.map((entry) => entry.gameId)).toEqual(["stale", "valid"]);
  });

  test("uses whole UTC dates, scoped BGG sessions, leap-safe 30-day boundaries, and abstains before dormant eligibility", () => {
    const dormant = game({ id: "dormant", bggId: 10, additionalBggIds: [11], ...currentCount(2) });
    const source = collection([dormant], {
      bggPlaySessions: [
        { playId: 1, bggId: 99, quantity: 1, playedOn: "2026-01-01", observedAt },
        { playId: 2, bggId: 11, quantity: 1, playedOn: "2026-01-01", observedAt },
      ],
    });
    for (const [date, expectedScore, boundary] of [
      ["2026-06-29T23:59:00.000Z", null, "2026-06-30T00:00:00.000Z"],
      ["2026-06-30T00:01:00.000Z", "2/5", "2026-07-30T00:00:00.000Z"],
      ["2026-07-29T23:59:00.000Z", "2/5", "2026-07-30T00:00:00.000Z"],
      ["2026-07-30T00:01:00.000Z", "28/65", "2026-08-29T00:00:00.000Z"],
    ] as const) {
      const result = computeAttentionCandidates(input(source, { evaluatedAt: date }));
      expect(
        result.winners[0]?.winner.attentionScore
          ? `${result.winners[0].winner.attentionScore.numerator}/${result.winners[0].winner.attentionScore.denominator}`
          : null,
      ).toBe(expectedScore);
      expect(result.evaluations[0]?.nextEvaluationBoundary).toBe(boundary);
    }
    const future = collection([dormant], {
      bggPlaySessions: [{ playId: 3, bggId: 10, quantity: 1, playedOn: "2027-01-01", observedAt }],
    });
    expect(computeAttentionCandidates(input(future)).winners).toHaveLength(0);
    const unscoped = collection([dormant], {
      bggPlaySessions: [{ playId: 4, bggId: 99, quantity: 1, playedOn: "2026-01-01", observedAt }],
    });
    expect(computeAttentionCandidates(input(unscoped)).winners).toHaveLength(0);
  });

  test("uses canonical underused multiplier rationals only and preserves exact display rounding", () => {
    const paid = game({ id: "paid" });
    for (const [numerator, denominator, expected] of [
      ["0", "1", "1/1"],
      ["1", "10", "9/10"],
      ["4", "5", "1/5"],
      ["1", "1", null],
    ] as const) {
      const result = computeAttentionCandidates(
        input(collection([paid]), {
          purchaseUtilizationProjectionByGameId: new Map([
            [paid.id, projection(paid, utilization(numerator, denominator))],
          ]),
        }),
      );
      expect(
        result.winners[0]?.winner.attentionScore
          ? `${result.winners[0].winner.attentionScore.numerator}/${result.winners[0].winner.attentionScore.denominator}`
          : null,
      ).toBe(expected);
    }
    for (const result of [
      utilization("01", "10"),
      utilization("1", "2", "met"),
      utilization("1", "2", "unavailable"),
    ]) {
      expect(
        computeAttentionCandidates(
          input(collection([paid]), {
            purchaseUtilizationProjectionByGameId: new Map([[paid.id, projection(paid, result)]]),
          }),
        ).winners,
      ).toHaveLength(0);
    }
  });

  test("keeps one unresolved intention of every kind, rejects resolved or duplicate intentions, and lets stronger rules displace it", () => {
    for (const kind of ["want-to-play", "first-play", "replay"] as const) {
      const intended = game({ id: kind });
      const source = collection([intended], {
        intentions: [
          {
            intentionId: `${kind}-id`,
            gameId: intended.id,
            kind,
            baseline: null,
            createdAt: observedAt,
            version: 1,
            resolution: null,
          },
        ],
      });
      expect(computeAttentionCandidates(input(source)).winners[0]?.winner.ruleId).toBe(
        "explicit-intention",
      );
    }
    const intended = game({ id: "intended" });
    const resolved = {
      intentionId: "resolved",
      gameId: intended.id,
      kind: "want-to-play" as const,
      baseline: null,
      createdAt: observedAt,
      version: 1,
      resolution: {
        outcome: "retired" as const,
        source: "owner-retired" as const,
        resolvedAt: observedAt,
      },
    };
    expect(
      computeAttentionCandidates(input(collection([intended], { intentions: [resolved] }))).winners,
    ).toHaveLength(0);
    const duplicate = { ...resolved, intentionId: "active", resolution: null };
    expect(
      computeAttentionCandidates(
        input(
          collection([intended], {
            intentions: [duplicate, { ...duplicate, intentionId: "second" }],
          }),
        ),
      ).winners,
    ).toHaveLength(0);
    const paid = game({ id: "paid" });
    const source = collection([paid], { intentions: [{ ...duplicate, gameId: paid.id }] });
    expect(
      computeAttentionCandidates(
        input(source, {
          purchaseUtilizationProjectionByGameId: new Map([
            [paid.id, projection(paid, utilization("1", "10"))],
          ]),
        }),
      ).winners[0]?.winner.ruleId,
    ).toBe("underused-purchase");
    expect(source.intentions[0]?.resolution).toBeNull();
  });

  test("applies snooze and intentional dispositions before alternatives, including exact expiry and clock-only intentional survival", () => {
    const candidate = game({ id: "candidate", ...currentCount(0) });
    const base = collection([candidate]);
    const winner = computeAttentionCandidates(input(base)).winners[0];
    if (!winner) throw new Error("Expected never-played winner");
    const snoozed = collection([candidate], {
      attentionDispositions: [
        {
          gameId: candidate.id,
          kind: "snoozed",
          ruleId: "never-played",
          ruleVersion: 1,
          fingerprint: winner.winner.fingerprint,
          responseAt: observedAt,
          expiresAt: "2026-01-31T00:00:00.000Z",
          version: 1,
        },
      ],
    });
    expect(
      computeAttentionCandidates(input(snoozed, { evaluatedAt: "2026-01-30T23:59:59.999Z" }))
        .winners,
    ).toHaveLength(0);
    expect(
      computeAttentionCandidates(input(snoozed, { evaluatedAt: "2026-01-31T00:00:00.000Z" }))
        .winners[0]?.winner.ruleId,
    ).toBe("never-played");
    const intentional = collection([candidate], {
      attentionDispositions: [
        {
          gameId: candidate.id,
          kind: "intentional",
          ruleId: "never-played",
          ruleVersion: 1,
          fingerprint: winner.winner.fingerprint,
          version: 1,
        },
      ],
    });
    expect(
      computeAttentionCandidates(input(intentional, { evaluatedAt: "2030-01-01T00:00:00.000Z" }))
        .winners,
    ).toHaveLength(0);
    const changed = structuredClone(intentional);
    const changedGame = changed.games[0];
    if (!changedGame) throw new Error("Expected candidate game");
    changedGame.latestPlayCountCheck = { status: "valid", value: 1, observedAt };
    expect(computeAttentionCandidates(input(changed)).evaluations[0]?.disposition).toBeNull();
  });

  test("supersedes before choosing a rule, ties by rule ID independent of registration, and globally orders exact ties stably", () => {
    const games = [
      game({ id: "z", name: "é" }),
      game({ id: "a", name: "e\u0301" }),
      game({ id: "b", name: "Beta" }),
    ];
    const left = synthetic("z-rule", new ExactRational(1n, 2n));
    const right = synthetic("a-rule", new ExactRational(1n, 2n));
    const superseding = synthetic("specific", new ExactRational(1n, 10n), ["z-rule"]);
    const source = collection(games);
    expect(
      computeAttentionCandidates(input(source, { catalog: [left, superseding] })).winners[0]?.winner
        .ruleId,
    ).toBe("specific");
    const forward = computeAttentionCandidates(input(source, { catalog: [left, right] }));
    const reverse = computeAttentionCandidates(input(source, { catalog: [right, left] }));
    expect(forward.winners.map((entry) => entry.winner.ruleId)).toEqual(
      reverse.winners.map((entry) => entry.winner.ruleId),
    );
    expect(forward.winners.map((entry) => entry.gameId)).toEqual(["b", "a", "z"]);
  });

  test("globally orders NFC names by Unicode code point, not UTF-16 code units", () => {
    const games = [
      game({ id: "supplementary", name: "\u{10000}" }),
      game({ id: "bmp", name: "\uE000" }),
    ];
    const rule = synthetic("unicode-rule", new ExactRational(1n));
    const forward = computeAttentionCandidates(input(collection(games), { catalog: [rule] }));
    const reverse = computeAttentionCandidates(
      input(collection([...games].reverse()), { catalog: [rule] }),
    );
    expect(forward.winners.map((entry) => entry.gameId)).toEqual(["bmp", "supplementary"]);
    expect(reverse.winners.map((entry) => entry.gameId)).toEqual(
      forward.winners.map((entry) => entry.gameId),
    );
  });

  test("is a pure deterministic successful-empty oracle and emits parseable JSON", () => {
    const source = collection([game({ id: "empty" })]);
    const before = structuredClone(source);
    const first = computeAttentionCandidates(input(source));
    const second = computeAttentionCandidates(input(source));
    expect(first).toEqual(second);
    expect(first.winners).toEqual([]);
    expect(source).toEqual(before);
    expect(JSON.parse(JSON.stringify(first.evaluations))).toEqual(first.evaluations);
    for (const row of first.evaluations)
      expect(AttentionCandidateEvaluationSchema.safeParse(row).success).toBe(true);
  });

  test("retains applicable exact-zero matches and fingerprints declared global dependencies", () => {
    const candidate = game({ id: "zero" });
    const zeroRule = synthetic("zero-rule", new ExactRational(0n));
    expect(
      computeAttentionCandidates(input(collection([candidate]), { catalog: [zeroRule] })).winners[0]
        ?.winner.attentionScore,
    ).toEqual({ numerator: "0", denominator: "1" });
    const globalRule = synthetic(
      "global-rule",
      new ExactRational(1n),
      [],
      [{ scope: "source", key: "tournamentHash" }],
    );
    const first = computeAttentionCandidates(
      input(collection([candidate]), {
        catalog: [globalRule],
        displayedFitnessSourceIdentity: {
          tournamentHash: "a".repeat(64),
          predictionSettingsHash: "b".repeat(64),
          redundancySettingsHash: "c".repeat(64),
        },
      }),
    );
    const second = computeAttentionCandidates(
      input(collection([candidate]), {
        catalog: [globalRule],
        displayedFitnessSourceIdentity: {
          tournamentHash: "d".repeat(64),
          predictionSettingsHash: "b".repeat(64),
          redundancySettingsHash: "c".repeat(64),
        },
      }),
    );
    expect(first.winners[0]?.winner.fingerprint).not.toBe(second.winners[0]?.winner.fingerprint);
  });

  test("rejects noncanonical exact numerator representations while accepting reduced zero", () => {
    const winner = {
      ruleId: "rule",
      ruleVersion: 1,
      signalStrength: { numerator: "0", denominator: "1" },
      categoryWeight: { numerator: "1", denominator: "1" },
      attentionScore: { numerator: "0", denominator: "1" },
      fingerprint,
    };
    const row = {
      gameId: "game",
      winner,
      disposition: null,
      nextEvaluationBoundary: null,
      dependencyVersion: 1,
      ruleCatalogVersion: 1,
    };
    expect(AttentionCandidateEvaluationSchema.safeParse(row).success).toBe(true);
    expect(
      AttentionCandidateEvaluationSchema.safeParse({
        ...row,
        winner: { ...winner, signalStrength: { numerator: "00", denominator: "1" } },
      }).success,
    ).toBe(false);
    expect(
      AttentionCandidateEvaluationSchema.safeParse({
        ...row,
        winner: { ...winner, attentionScore: { numerator: "00", denominator: "1" } },
      }).success,
    ).toBe(false);
  });

  test("rejects unreduced attention components even when their product is equivalent", () => {
    const winner = {
      ruleId: "rule",
      ruleVersion: 1,
      signalStrength: { numerator: "1", denominator: "2" },
      categoryWeight: { numerator: "1", denominator: "2" },
      attentionScore: { numerator: "1", denominator: "4" },
      fingerprint,
    };
    const row = {
      gameId: "game",
      winner,
      disposition: null,
      nextEvaluationBoundary: null,
      dependencyVersion: 1,
      ruleCatalogVersion: 1,
    };
    expect(AttentionCandidateEvaluationSchema.safeParse(row).success).toBe(true);
    for (const key of ["signalStrength", "categoryWeight", "attentionScore"] as const) {
      expect(
        AttentionCandidateEvaluationSchema.safeParse({
          ...row,
          winner: {
            ...winner,
            [key]:
              key === "attentionScore"
                ? { numerator: "2", denominator: "8" }
                : { numerator: "2", denominator: "4" },
          },
        }).success,
      ).toBe(false);
    }
    expect(
      AttentionCandidateEvaluationSchema.safeParse({
        ...row,
        winner: {
          ...winner,
          signalStrength: { numerator: "0", denominator: "2" },
          categoryWeight: { numerator: "0", denominator: "2" },
          attentionScore: { numerator: "0", denominator: "4" },
        },
      }).success,
    ).toBe(false);
  });

  test("uses canonical Profile source hashes as the complete underused identity", async () => {
    const paid = game({ id: "paid" });
    const projectionValue = projection(paid, utilization("1", "10"));
    const context = createTestApp();
    const [sourceCollection, tournament, predictionSettings, redundancySettings] =
      await Promise.all([
        context.storageService.loadCollection(),
        context.storageService.loadTournament(),
        context.storageService.loadPredictionSettings(),
        context.storageService.loadRedundancySettings(),
      ]);
    const sources = {
      collection: sourceCollection,
      tournament,
      predictionSettings,
      redundancySettings,
    };
    const displayedFitnessSourceIdentity = profileSourceIdentity(sources);
    for (const hash of [
      displayedFitnessSourceIdentity.tournamentHash,
      displayedFitnessSourceIdentity.predictionSettingsHash,
      displayedFitnessSourceIdentity.redundancySettingsHash,
    ])
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const baseline = computeAttentionCandidates(
      input(collection([paid]), {
        purchaseUtilizationProjectionByGameId: new Map([[paid.id, projectionValue]]),
        displayedFitnessSourceIdentity,
      }),
    );
    const winner = baseline.winners[0];
    if (!winner) throw new Error("Expected underused winner");
    const intentional = collection([paid], {
      attentionDispositions: [
        {
          gameId: paid.id,
          kind: "intentional",
          ruleId: "underused-purchase",
          ruleVersion: 1,
          fingerprint: winner.winner.fingerprint,
          version: 1,
        },
      ],
    });
    const projectionBytes = JSON.stringify(projectionValue);
    const displayedScoreBytes = JSON.stringify({ game: paid, score: null });
    expect(
      computeAttentionCandidates(
        input(intentional, {
          purchaseUtilizationProjectionByGameId: new Map([[paid.id, projectionValue]]),
          displayedFitnessSourceIdentity,
        }),
      ).winners,
    ).toHaveLength(0);

    await context.tournamentService.updateSettings({ normalizationHalfWidth: 450 });
    const changedTournament = await context.storageService.loadTournament();
    await context.predictionService.updateSettings({ defaultK: 7 });
    const changedPredictionSettings = await context.storageService.loadPredictionSettings();
    await jsonRequest(context.app, "PATCH", "/api/redundancy/settings", { enabled: true });
    const changedRedundancySettings = await context.storageService.loadRedundancySettings();
    const changedSources = [
      {
        key: "tournamentHash",
        identity: profileSourceIdentity({ ...sources, tournament: changedTournament }),
      },
      {
        key: "predictionSettingsHash",
        identity: profileSourceIdentity({
          ...sources,
          predictionSettings: changedPredictionSettings,
        }),
      },
      {
        key: "redundancySettingsHash",
        identity: profileSourceIdentity({
          ...sources,
          redundancySettings: changedRedundancySettings,
        }),
      },
    ] as const;
    for (const { key, identity } of changedSources) {
      expect(identity[key]).not.toBe(displayedFitnessSourceIdentity[key]);
      expect(JSON.stringify(projectionValue)).toBe(projectionBytes);
      expect(JSON.stringify({ game: paid, score: null })).toBe(displayedScoreBytes);
      const changed = computeAttentionCandidates(
        input(intentional, {
          purchaseUtilizationProjectionByGameId: new Map([[paid.id, projectionValue]]),
          displayedFitnessSourceIdentity: identity,
        }),
      );
      expect(changed.evaluations[0]?.winner?.fingerprint).not.toBe(winner.winner.fingerprint);
      expect(changed.evaluations[0]?.disposition).toBeNull();
      expect(changed.winners[0]?.winner.ruleId).toBe("underused-purchase");
    }

    for (const identity of [
      { ...displayedFitnessSourceIdentity, nichePositionHash: "niche-only" },
      { ...displayedFitnessSourceIdentity, arbitraryUndeclaredIdentity: "ignored" },
    ]) {
      const unchanged = computeAttentionCandidates(
        input(collection([paid]), {
          purchaseUtilizationProjectionByGameId: new Map([[paid.id, projectionValue]]),
          displayedFitnessSourceIdentity: identity,
        }),
      );
      expect(unchanged.evaluations[0]?.winner?.fingerprint).toBe(winner.winner.fingerprint);
      expect(
        computeAttentionCandidates(
          input(intentional, {
            purchaseUtilizationProjectionByGameId: new Map([[paid.id, projectionValue]]),
            displayedFitnessSourceIdentity: identity,
          }),
        ).evaluations[0]?.disposition?.kind,
      ).toBe("intentional");
    }

    const underusedRule = attentionRuleCatalog.find((rule) => rule.id === "underused-purchase");
    if (!underusedRule) throw new Error("Expected underused-purchase production rule");
    const declaredSourceKeys = underusedRule.dependencies
      .filter(
        (
          dependency,
        ): dependency is Extract<
          AttentionRuleDefinition["dependencies"][number],
          { scope: "source" }
        > => dependency.scope === "source",
      )
      .map(({ key }) => key);
    expect(declaredSourceKeys).toHaveLength(3);
    for (const key of declaredSourceKeys) {
      expect(() =>
        computeAttentionCandidates(
          input(collection([paid]), {
            purchaseUtilizationProjectionByGameId: new Map([[paid.id, projectionValue]]),
            displayedFitnessSourceIdentity,
          }),
        ),
      ).not.toThrow();
      for (const value of ["", "g".repeat(64), "A".repeat(64), "a".repeat(63)]) {
        expect(() =>
          computeAttentionCandidates(
            input(collection([paid]), {
              purchaseUtilizationProjectionByGameId: new Map([[paid.id, projectionValue]]),
              displayedFitnessSourceIdentity: { ...displayedFitnessSourceIdentity, [key]: value },
            }),
          ),
        ).toThrow(`displayed-fitness source identity: ${key}`);
      }
    }
  });

  test("orders dormant play-count checks exactly as Profile evidence semantics require", () => {
    const dormant = game({
      id: "dormant",
      bggId: 10,
      entityMetadata: createInitialEntityMetadata(10),
      playCountEvidence: {
        status: "valid",
        value: 2,
        source: "manual",
        observedAt: "2026-01-02T00:00:00.000Z",
      },
    });
    const variants = [
      { id: "none", latestPlayCountCheck: null, expected: true },
      {
        id: "older-invalid",
        latestPlayCountCheck: {
          status: "invalid" as const,
          observedAt: "2026-01-01T00:00:00.000Z",
          evidence: { presence: "present" as const, value: "bad" },
        },
        expected: true,
      },
      {
        id: "older-missing",
        latestPlayCountCheck: {
          status: "missing" as const,
          observedAt: "2026-01-01T00:00:00.000Z",
        },
        expected: true,
      },
      {
        id: "newer-invalid",
        latestPlayCountCheck: {
          status: "invalid" as const,
          observedAt: "2026-01-03T00:00:00.000Z",
          evidence: { presence: "present" as const, value: "bad" },
        },
        expected: false,
      },
      {
        id: "newer-missing",
        latestPlayCountCheck: {
          status: "missing" as const,
          observedAt: "2026-01-03T00:00:00.000Z",
        },
        expected: false,
      },
      {
        id: "newer-current-valid-mismatch",
        latestPlayCountCheck: {
          status: "valid" as const,
          value: 99,
          observedAt: "2026-01-01T00:00:00.000Z",
        },
        expected: true,
      },
    ] as const;
    expect(attentionRuleCatalog.find((rule) => rule.id === "dormant")?.dependencies).toContainEqual(
      {
        scope: "local",
        key: "latest-play-count-check",
      },
    );
    const results = variants.map((variant) => {
      const source = collection(
        [game({ ...dormant, id: variant.id, latestPlayCountCheck: variant.latestPlayCountCheck })],
        {
          bggPlaySessions: [
            { playId: 1, bggId: 10, quantity: 1, playedOn: "2026-01-01", observedAt },
          ],
        },
      );
      expect(CollectionSchema.safeParse(source).success).toBe(true);
      return { variant, evaluation: computeAttentionCandidates(input(source)).evaluations[0] };
    });
    for (const { variant, evaluation } of results) {
      expect(evaluation?.winner?.ruleId === "dormant").toBe(variant.expected);
    }
    const qualifying = results
      .map(({ evaluation }) => evaluation)
      .filter((evaluation) => evaluation?.winner?.ruleId === "dormant");
    expect(new Set(qualifying.map(({ winner }) => winner?.fingerprint)).size).toBe(4);
  });

  test("computes row boundaries from active snoozes without giving intentional dispositions an expiry", () => {
    const never = game({ id: "never", ...currentCount(0) });
    const dormant = game({ id: "dormant", bggId: 10, ...currentCount(2) });
    const base = collection([never, dormant], {
      bggPlaySessions: [{ playId: 1, bggId: 10, quantity: 1, playedOn: "2026-01-01", observedAt }],
    });
    const baseline = computeAttentionCandidates(input(base));
    const neverWinner = baseline.evaluations.find(({ gameId }) => gameId === never.id)?.winner;
    const dormantWinner = baseline.evaluations.find(({ gameId }) => gameId === dormant.id)?.winner;
    if (!neverWinner || !dormantWinner) throw new Error("Expected production rule winners");
    const snooze = (
      gameId: string,
      ruleId: string,
      fingerprintValue: string,
      expiresAt: string,
    ) => ({
      gameId,
      kind: "snoozed" as const,
      ruleId,
      ruleVersion: 1,
      fingerprint: fingerprintValue,
      responseAt: new Date(Date.parse(expiresAt) - 720 * 60 * 60 * 1000).toISOString(),
      expiresAt,
      version: 1,
    });
    const row = (source: Collection, evaluatedAtValue = evaluatedAt, gameId = dormant.id) =>
      computeAttentionCandidates(input(source, { evaluatedAt: evaluatedAtValue })).evaluations.find(
        (evaluation) => evaluation.gameId === gameId,
      );

    const noRule = game({ id: "no-rule", ...currentCount(2) });
    const noRuleBaseline = row(collection([noRule]), evaluatedAt, noRule.id);
    expect(noRuleBaseline?.winner).toBeNull();
    expect(noRuleBaseline?.nextEvaluationBoundary).toBeNull();
    const noRuleSnooze = collection([noRule], {
      attentionDispositions: [
        snooze(noRule.id, "never-played", fingerprint, "2026-07-10T00:00:00.000Z"),
      ],
    });
    expect(row(noRuleSnooze, evaluatedAt, noRule.id)?.winner).toBeNull();
    expect(row(noRuleSnooze, evaluatedAt, noRule.id)?.nextEvaluationBoundary).toBe(
      "2026-07-10T00:00:00.000Z",
    );

    const offsetDormant = game({ id: "offset-dormant", bggId: 11, ...currentCount(2) });
    const offsetSource = collection([offsetDormant], {
      bggPlaySessions: [{ playId: 2, bggId: 11, quantity: 1, playedOn: "2025-12-12", observedAt }],
      attentionDispositions: [
        snooze(offsetDormant.id, "dormant", fingerprint, "2026-07-10T01:00:00+02:00"),
      ],
    });
    expect(row(offsetSource, evaluatedAt, offsetDormant.id)?.nextEvaluationBoundary).toBe(
      "2026-07-10T01:00:00+02:00",
    );
    const equalInstantSource = collection([offsetDormant], {
      bggPlaySessions: offsetSource.bggPlaySessions,
      attentionDispositions: [
        snooze(offsetDormant.id, "dormant", fingerprint, "2026-07-10T02:00:00+02:00"),
      ],
    });
    expect(row(equalInstantSource, evaluatedAt, offsetDormant.id)?.nextEvaluationBoundary).toBe(
      "2026-07-10T00:00:00.000Z",
    );

    const expiryFirst = collection([dormant], {
      bggPlaySessions: base.bggPlaySessions,
      attentionDispositions: [
        snooze(dormant.id, "dormant", dormantWinner.fingerprint, "2026-07-10T00:00:00.000Z"),
      ],
    });
    expect(row(expiryFirst)?.nextEvaluationBoundary).toBe("2026-07-10T00:00:00.000Z");
    const ruleFirst = collection([dormant], {
      bggPlaySessions: base.bggPlaySessions,
      attentionDispositions: [
        snooze(dormant.id, "dormant", dormantWinner.fingerprint, "2026-08-10T00:00:00.000Z"),
      ],
    });
    expect(row(ruleFirst)?.nextEvaluationBoundary).toBe("2026-07-30T00:00:00.000Z");
    const atExpiry = collection([dormant], {
      bggPlaySessions: base.bggPlaySessions,
      attentionDispositions: [
        snooze(dormant.id, "dormant", dormantWinner.fingerprint, evaluatedAt),
      ],
    });
    expect(row(atExpiry)?.winner?.ruleId).toBe("dormant");
    expect(row(atExpiry)?.nextEvaluationBoundary).toBe("2026-07-30T00:00:00.000Z");

    const intentionalDormant = collection([dormant], {
      bggPlaySessions: base.bggPlaySessions,
      attentionDispositions: [
        {
          gameId: dormant.id,
          kind: "intentional",
          ruleId: "dormant",
          ruleVersion: 1,
          fingerprint: dormantWinner.fingerprint,
          version: 1,
        },
      ],
    });
    expect(row(intentionalDormant)?.nextEvaluationBoundary).toBe("2026-07-30T00:00:00.000Z");
    const intentionalNever = collection([never], {
      attentionDispositions: [
        {
          gameId: never.id,
          kind: "intentional",
          ruleId: "never-played",
          ruleVersion: 1,
          fingerprint: neverWinner.fingerprint,
          version: 1,
        },
      ],
    });
    expect(row(intentionalNever, evaluatedAt, never.id)?.nextEvaluationBoundary).toBeNull();
  });
});
