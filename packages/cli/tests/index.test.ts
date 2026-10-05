import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/index.js";
import { createDaemonClient } from "../src/client.js";
import { redundancySemanticRun } from "../src/commands/redundancy.js";

describe("CLI derived-axis argument parsing", () => {
  test("parses template creation configuration and native tolerance", () => {
    const parsed = parseArgs([
      "bun",
      "shelf-judge",
      "axis",
      "create",
      "--template",
      "playerCountFit",
      "--target-player-count",
      "4",
      "--tolerance-width",
      "2",
      "Targeted Player Count",
    ]);

    expect(parsed).toMatchObject({
      commandPath: "axis create",
      positional: ["Targeted Player Count"],
      template: "playerCountFit",
      targetPlayerCount: 4,
      toleranceWidth: 2,
    });
  });

  test("parses repair cap and tolerance transition flags", () => {
    const parsed = parseArgs([
      "bun",
      "shelf-judge",
      "axis",
      "repair",
      "legacy-id",
      "--template",
      "playingTime",
      "--maximum-scoring-time",
      "300",
      "--no-tolerance",
      "--no-tolerance-width",
    ]);

    expect(parsed).toMatchObject({
      commandPath: "axis repair",
      positional: ["legacy-id"],
      template: "playingTime",
      maximumScoringTime: 300,
      noTolerance: true,
      noToleranceWidth: true,
    });
  });
});

describe("purchase utilization argument parsing", () => {
  const cases: Array<[string[], string, string[]]> = [
    [["game", "acquisition", "game/1", "unknown"], "game acquisition", ["game/1", "unknown"]],
    [["game", "acquisition", "game/1", "gift"], "game acquisition", ["game/1", "gift"]],
    [
      ["game", "acquisition", "game/1", "purchase", "0008.50", "--json"],
      "game acquisition",
      ["game/1", "purchase", "0008.50"],
    ],
    [["--json", "game", "value", "game/1"], "game value", ["game/1"]],
    [["collection", "benchmark", "get"], "collection benchmark", ["get"]],
    [
      ["collection", "benchmark", "set", "0008.50", "--json"],
      "collection benchmark",
      ["set", "0008.50"],
    ],
    [["collection", "benchmark", "clear"], "collection benchmark", ["clear"]],
  ];
  test.each(cases)(
    "keeps positional command values unchanged",
    (tokens, commandPath, positional) => {
      const parsed = parseArgs(["bun", "shelf-judge", ...tokens]);
      expect(parsed.commandPath).toBe(commandPath);
      expect(parsed.positional).toEqual(positional);
      expect(parsed.json).toBe(tokens.includes("--json"));
    },
  );

  test.each([
    [
      ["game", "acquisition", "game/1", "purchase", "--name"],
      "game acquisition",
      ["game/1", "purchase", "--name"],
    ],
    [["collection", "benchmark", "set", "--weight"], "collection benchmark", ["set", "--weight"]],
  ] as Array<[string[], string, string[]]>)(
    "preserves recognized flag-shaped amount strings",
    (tokens, commandPath, positional) => {
      expect(parseArgs(["bun", "shelf-judge", ...tokens])).toMatchObject({
        commandPath,
        positional,
      });
    },
  );

  test.each([
    [
      ["game", "acquisition", "game/1", "gift", "--weight", "5"],
      "game acquisition",
      ["game/1", "gift", "--weight", "5"],
    ],
    [
      ["game", "value", "game/1", "--name", "ignored"],
      "game value",
      ["game/1", "--name", "ignored"],
    ],
    [
      ["collection", "benchmark", "get", "--description", "ignored", "--json"],
      "collection benchmark",
      ["get", "--description", "ignored"],
    ],
  ] as Array<[string[], string, string[]]>)(
    "preserves unrelated recognized options as actionable extra arguments",
    (tokens, commandPath, positional) => {
      const parsed = parseArgs(["bun", "shelf-judge", ...tokens]);
      expect(parsed.commandPath).toBe(commandPath);
      expect(parsed.positional).toEqual(positional);
      expect(parsed.json).toBe(tokens.includes("--json"));
    },
  );
});

describe("wishlist semantic run argument dispatch", () => {
  test("keeps repeated --bgg-id selectors with the redundancy run command", () => {
    expect(
      parseArgs([
        "bun",
        "shelf-judge",
        "redundancy",
        "run",
        "--scope",
        "wishlist",
        "--bgg-id",
        "902",
        "--bgg-id",
        "101",
        "--json",
      ]),
    ).toMatchObject({
      commandPath: "redundancy run",
      positional: ["--scope", "wishlist", "--bgg-id", "902", "--bgg-id", "101"],
      json: true,
    });
  });

  test("continues parsing --bgg-id for the existing game-add command", () => {
    expect(parseArgs(["bun", "shelf-judge", "game", "add", "--bgg-id", "123"])).toMatchObject({
      commandPath: "game add",
      positional: [],
      bggId: 123,
    });
  });

  test("parsed wishlist invocation uses the real daemon client transport and frozen request body", async () => {
    const requests: Array<{ method: string; url: URL; body?: unknown }> = [];
    const preview = {
      requestId: "transport-request",
      precondition: "transport-token",
      provider: "TypeSafe",
      modelId: "model-safe",
      eligibleGameCount: 0,
      pairCount: 0,
      descriptionBearingPairCount: 0,
      noteBearingPairCount: 0,
      noteTransmissionPermitted: false,
      providerConfigured: true,
      scoringEffect: "annotation-only",
      limits: {
        maxEligiblePairs: 25_000,
        maxProviderAttempts: 100,
        maxRunDurationMs: 1_800_000,
        reportedTokenStopThreshold: 200_000,
        reportedTokenThresholdIsBilledCeiling: false,
      },
      withinPairLimit: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
      scope: {
        scope: "wishlist",
        wishlistEntryCount: 2,
        selectedCandidateCount: 1,
        unselectedEntryCount: 1,
        ownedOverlapCandidateCount: 0,
        requestedCandidateCount: 1,
        eligibleCandidateCount: 1,
        unavailableCandidateCount: 0,
        eligibleOwnedGameCount: 1,
        comparisonPairCount: 1,
        cachedHitPairCount: 0,
        sendablePairCount: 1,
      },
      selection: { kind: "selected", bggIds: [55] },
      unavailableCandidateBggIds: [],
    };
    const fakeFetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          input instanceof URL
            ? input
            : input instanceof Request
              ? new URL(input.url)
              : new URL(input);
        const method = init?.method ?? "GET";
        const body =
          typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
        requests.push({ method, url, ...(body === undefined ? {} : { body }) });
        const payload = url.pathname.endsWith("run-preview")
          ? preview
          : { state: "started", runId: "transport-run" };
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: url.pathname.endsWith("run-preview") ? 200 : 202,
            headers: { "content-type": "application/json" },
          }),
        );
      },
      { preconnect: () => Promise.resolve() },
    );
    const client = createDaemonClient({ socketPath: "/fake/shelf-judge.sock", fetchFn: fakeFetch });
    const parsed = parseArgs([
      "bun",
      "shelf-judge",
      "redundancy",
      "run",
      "--scope",
      "wishlist",
      "--bgg-id",
      "55",
      "--json",
    ]);
    expect(parsed.commandPath).toBe("redundancy run");
    const output = await redundancySemanticRun(client, parsed.positional, { json: parsed.json });
    const decoded = JSON.parse(output) as {
      preview: { selection: { kind: string; bggIds: number[] } };
    };
    expect(decoded.preview.selection).toEqual({ kind: "selected", bggIds: [55] });
    expect(requests[0]?.url.searchParams.get("scope")).toBe("wishlist");
    expect(requests[0]?.url.searchParams.getAll("bggId")).toEqual(["55"]);
    expect(requests[1]?.body).toEqual({
      requestId: "transport-request",
      precondition: "transport-token",
      noteTransmissionAuthorized: false,
    });
  });
});

describe("intention and play command parsing", () => {
  test.each([
    [
      ["game", "intention", "set", "game-1", "replay", "--command-id", "command-1"],
      "game intention set",
      ["game-1", "replay", "--command-id", "command-1"],
    ],
    [
      ["game", "intention", "complete", "game-1", "intention-1", "--expected-version", "2"],
      "game intention complete",
      ["game-1", "intention-1", "--expected-version", "2"],
    ],
    [
      ["game", "intention", "retire", "game-1", "intention-1", "--expected-version", "1"],
      "game intention retire",
      ["game-1", "intention-1", "--expected-version", "1"],
    ],
    [["game", "plays", "set", "game-1", "4", "--json"], "game plays set", ["game-1", "4"]],
  ] as Array<[string[], string, string[]]>)(
    "matches the three-token command without consuming local flags",
    (tokens, commandPath, args) => {
      expect(parseArgs(["bun", "shelf-judge", ...tokens])).toMatchObject({
        commandPath,
        positional: args,
        json: tokens.includes("--json"),
      });
    },
  );

  test("preserves unrelated recognized flags so command validation rejects them", () => {
    expect(
      parseArgs([
        "bun",
        "shelf-judge",
        "game",
        "intention",
        "set",
        "game-1",
        "first-play",
        "--name",
        "ignored",
      ]),
    ).toMatchObject({
      commandPath: "game intention set",
      positional: ["game-1", "first-play", "--name", "ignored"],
    });
  });
});

describe("owner-note command parsing", () => {
  test.each([
    [["game", "note", "get", "game-1", "--json"], "game note get", ["game-1"]],
    [
      [
        "game",
        "note",
        "set",
        "game-1",
        "--expected-version",
        "0",
        "--text",
        "first line\nsecond line",
      ],
      "game note set",
      ["game-1", "--expected-version", "0", "--text", "first line\nsecond line"],
    ],
    [
      ["game", "note", "clear", "game-1", "--expected-version", "2", "--command-id", "id"],
      "game note clear",
      ["game-1", "--expected-version", "2", "--command-id", "id"],
    ],
    [
      ["game", "note", "set", "game-1", "--expected-version", "0", "--text", "--json", "--json"],
      "game note set",
      ["game-1", "--expected-version", "0", "--text", "--json"],
    ],
    [
      ["game", "note", "set", "game-1", "--expected-version", "0", "--text", "--text", "--json"],
      "game note set",
      ["game-1", "--expected-version", "0", "--text", "--text"],
    ],
  ] as Array<[string[], string, string[]]>)(
    "keeps command-local note flags intact",
    (tokens, commandPath, positional) => {
      expect(parseArgs(["bun", "shelf-judge", ...tokens])).toMatchObject({
        commandPath,
        positional,
        json: tokens.includes("--json"),
      });
    },
  );
});

describe("profile reflection command parsing", () => {
  test.each([
    [["profile", "reflections"], "profile reflections", []],
    [
      ["profile", "reflections", "refresh", "--question", "repeated-values"],
      "profile reflections refresh",
      ["--question", "repeated-values"],
    ],
    [
      ["profile", "reflections", "cancel", "batch-1", "--capability", "a".repeat(64)],
      "profile reflections cancel",
      ["batch-1", "--capability", "a".repeat(64)],
    ],
    [
      ["profile", "reflections", "enable", "pattern-exceptions"],
      "profile reflections enable",
      ["pattern-exceptions"],
    ],
    [
      ["profile", "reflections", "disable", "recurring-trade-offs"],
      "profile reflections disable",
      ["recurring-trade-offs"],
    ],
    [["profile", "reflections", "delete"], "profile reflections delete", []],
  ] as Array<[string[], string, string[]]>)(
    "keeps reflection options command-local",
    (tokens, commandPath, positional) => {
      expect(parseArgs(["bun", "shelf-judge", ...tokens])).toMatchObject({
        commandPath,
        positional,
      });
    },
  );
});

describe("profile attention command parsing", () => {
  test.each([
    ["not-now", "profile attention not-now"],
    ["intentional", "profile attention intentional"],
  ])("keeps the %s template and command flags for the relay", (operation, commandPath) => {
    expect(
      parseArgs([
        "bun",
        "shelf-judge",
        "profile",
        "attention",
        operation,
        "{template}",
        "--command-id",
        "command-id",
        "--json",
      ]),
    ).toMatchObject({
      commandPath,
      positional: ["{template}", "--command-id", "command-id"],
      json: true,
    });
  });
});

describe("Collection Analyst command parsing", () => {
  test.each([
    [
      ["analyst", "ask", "--question", "Which games are owned?", "--acknowledge-disclosure"],
      "analyst ask",
      ["--question", "Which games are owned?", "--acknowledge-disclosure"],
    ],
    [["analyst", "chat"], "analyst chat", []],
  ] as Array<[string[], string, string[]]>)(
    "keeps Analyst arguments command-local",
    (tokens, commandPath, positional) => {
      expect(parseArgs(["bun", "shelf-judge", ...tokens])).toMatchObject({
        commandPath,
        positional,
      });
    },
  );

  test("extracts the root JSON flag from Analyst command arguments", () => {
    expect(parseArgs(["bun", "shelf-judge", "analyst", "ask", "Question", "--json"])).toMatchObject(
      {
        commandPath: "analyst ask",
        positional: ["Question"],
        json: true,
      },
    );
  });
});
