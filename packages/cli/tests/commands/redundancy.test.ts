import { describe, expect, test } from "bun:test";
import {
  redundancyDisable,
  redundancyEnable,
  redundancySet,
  redundancySettings,
  redundancyStage,
  redundancySemanticRun,
  redundancySemanticProgress,
  redundancySemanticCancel,
  redundancySemanticActiveRun,
  redundancySemanticSettings,
  redundancySemanticStatus,
} from "../../src/commands/redundancy.js";
import { createMockClient } from "../helpers/mock-client.js";
import { predictBggGame } from "../../src/commands/predict.js";

describe("redundancy command errors", () => {
  const cases = [
    {
      name: "settings",
      route: "GET /api/redundancy/settings",
      run: redundancySettings,
      args: [],
      fallback: "Failed to load redundancy settings",
    },
    {
      name: "enable",
      route: "PATCH /api/redundancy/settings",
      run: redundancyEnable,
      args: [],
      fallback: "Failed to enable redundancy",
    },
    {
      name: "disable",
      route: "PATCH /api/redundancy/settings",
      run: redundancyDisable,
      args: [],
      fallback: "Failed to disable redundancy",
    },
    {
      name: "stage",
      route: "PATCH /api/redundancy/settings",
      run: redundancyStage,
      args: ["integrated"],
      fallback: "Failed to set redundancy stage",
    },
    {
      name: "set",
      route: "PATCH /api/redundancy/settings",
      run: redundancySet,
      args: ["enabled", "true"],
      fallback: "Failed to set enabled",
    },
  ];

  for (const { name, route, run, args, fallback } of cases) {
    test(`${name} retains server-provided errors`, () => {
      const client = createMockClient({
        routes: {
          [route]: { response: { ok: false, status: 400, data: { error: "Server error" } } },
        },
      });
      expect(run(client, args, { json: false })).rejects.toThrow("Server error");
    });

    test(`${name} retains its fallback error`, () => {
      const client = createMockClient({
        routes: { [route]: { response: { ok: false, status: 500, data: {} } } },
      });
      expect(run(client, args, { json: false })).rejects.toThrow(fallback);
    });
  }
});

describe("semantic redundancy CLI consent boundary", () => {
  test("candidate BGG output marks factual-only preview and preserves safe mode with no neighbor", async () => {
    const response = {
      game: { id: "preview-1", name: "Example" },
      score: {
        score: 5,
        ratedAxisCount: 1,
        totalAxisCount: 1,
        vetoed: false,
        vetoedBy: null,
        hypotheticalScore: null,
        predictionMeta: null,
        breakdown: [],
        redundancySimilarityInfo: { status: "not-ready", generationId: null },
      },
      predictionUnavailable: null,
      redundancyPreview: null,
    };
    const client = createMockClient({
      routes: {
        "GET /api/predictions/bgg/42": { response: { ok: true, status: 200, data: response } },
      },
    });
    const human = await predictBggGame(client, ["42"], { json: false });
    expect(human).toContain("factual-only");
    expect(human).toContain("not-ready (generation: none)");
    const json = JSON.parse(await predictBggGame(client, ["42"], { json: true })) as {
      redundancyPreviewMode: string;
      score: { redundancySimilarityInfo: { status: string; generationId: string | null } };
    };
    expect(json.redundancyPreviewMode).toBe("factual-only");
    expect(json.score.redundancySimilarityInfo).toEqual({
      status: "not-ready",
      generationId: null,
    });
  });

  test("one Run invocation previews then starts with exact precondition and safe false note consent", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const outputEvents: string[] = [];
    const requestedPaths: string[] = [];
    const preview = {
      requestId: "request-1",
      precondition: "opaque-token",
      provider: "TypeSafe",
      modelId: "model-safe",
      eligibleGameCount: 4,
      pairCount: 6,
      descriptionBearingPairCount: 6,
      noteBearingPairCount: 2,
      noteTransmissionPermitted: true,
      providerConfigured: true,
      scoringEffect: "integrated-fitness",
      limits: {
        maxEligiblePairs: 25_000,
        maxProviderAttempts: 1_000,
        maxRunDurationMs: 30 * 60_000,
        reportedTokenStopThreshold: 2_000_000,
        reportedTokenThresholdIsBilledCeiling: false,
      },
      withinPairLimit: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    const mockClient = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/run-preview": {
          response: { ok: true, status: 200, data: preview },
        },
        "POST /api/redundancy/semantic/run": {
          response: (body) => {
            calls.push({ method: "POST", path: "/api/redundancy/semantic/run", body });
            outputEvents.push("POST");
            return { ok: true, status: 202, data: { state: "started", runId: "run-1" } };
          },
        },
      },
    });
    const client = {
      ...mockClient,
      get: <T>(path: string) => {
        requestedPaths.push(path);
        return mockClient.get<T>(path.split("?", 1)[0] ?? path);
      },
    };
    const originalLog = console.log;
    console.log = (message?: unknown) => outputEvents.push(String(message));
    let output: string;
    try {
      output = await redundancySemanticRun(client, [], { json: false });
    } finally {
      console.log = originalLog;
    }
    expect(output).toContain("Run accepted");
    expect(outputEvents[0]).toContain("1,000 provider attempts");
    expect(outputEvents[0]).toContain("Provider/model: TypeSafe / model-safe");
    expect(outputEvents[0]).toContain("Pairs with descriptions: 6; pairs with notes: 2");
    expect(requestedPaths).toEqual([
      "/api/redundancy/semantic/run-preview?maxProviderAttempts=1000&reportedTokenStopThreshold=2000000&maxRunDurationMs=1800000",
    ]);
    expect(outputEvents[0]).toContain("Note transmission is off by default");
    expect(outputEvents[0]).toContain("Note transmission permission available: yes");
    expect(outputEvents[1]).toBe("POST");
    expect(outputEvents[0]).toContain("not a billing cap");
    expect(outputEvents[0]).toContain("Application stop limits");
    expect(outputEvents[0]).toContain("2,000,000 tokens");
    expect(outputEvents[0]).not.toMatch(/retention/i);
    expect(outputEvents[0]).not.toContain("TypeSafe's default retention duration is unspecified");
    expect(outputEvents[0]).not.toContain("do not promise provider-side erasure");
    // The preview is the only GET made; the mock has no manifest or page route.
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      requestId: "request-1",
      precondition: "opaque-token",
      noteTransmissionAuthorized: false,
    });
  });

  test("--authorize-notes is explicit, and C-only scopes run without it", async () => {
    let body: unknown;
    const preview = {
      requestId: "request-c",
      precondition: "token-c",
      provider: "TypeSafe",
      modelId: "model-safe",
      eligibleGameCount: 2,
      pairCount: 1,
      descriptionBearingPairCount: 1,
      noteBearingPairCount: 0,
      noteTransmissionPermitted: false,
      providerConfigured: true,
      scoringEffect: "annotation-only",
      limits: {
        maxEligiblePairs: 25_000,
        maxProviderAttempts: 100,
        maxRunDurationMs: 60_000,
        reportedTokenStopThreshold: 10_000,
        reportedTokenThresholdIsBilledCeiling: false,
      },
      withinPairLimit: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    const client = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/run-preview": {
          response: { ok: true, status: 200, data: preview },
        },
        "POST /api/redundancy/semantic/run": {
          response: (value) => {
            body = value;
            return { ok: true, status: 202, data: { state: "started", runId: "run-c" } };
          },
        },
      },
    });
    await redundancySemanticRun(client, [], { json: true });
    expect(body).toEqual({
      requestId: "request-c",
      precondition: "token-c",
      noteTransmissionAuthorized: false,
    });
    await expectError(
      redundancySemanticRun(client, ["--authorize-notes"], { json: false }),
      "not currently permitted",
    );
  });

  test("run budgets above defaults are sent as explicit preview query parameters", async () => {
    let requestedPath = "";
    const preview = {
      requestId: "request-budget",
      precondition: "token-budget",
      provider: "TypeSafe",
      modelId: "model-safe",
      eligibleGameCount: 4,
      pairCount: 6,
      descriptionBearingPairCount: 6,
      noteBearingPairCount: 0,
      noteTransmissionPermitted: false,
      providerConfigured: true,
      scoringEffect: "annotation-only",
      limits: {
        maxEligiblePairs: 25_000,
        maxProviderAttempts: 250,
        maxRunDurationMs: 90 * 60_000,
        reportedTokenStopThreshold: 350_000,
        reportedTokenThresholdIsBilledCeiling: false,
      },
      withinPairLimit: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    const mockClient = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/run-preview": {
          response: { ok: true, status: 200, data: preview },
        },
        "POST /api/redundancy/semantic/run": {
          response: { ok: true, status: 202, data: { state: "started", runId: "run-budget" } },
        },
      },
    });
    const client = {
      ...mockClient,
      get: <T>(path: string) => {
        requestedPath = path;
        return mockClient.get<T>(path.split("?", 1)[0] ?? path);
      },
    };
    const originalLog = console.log;
    console.log = () => {};
    try {
      await redundancySemanticRun(
        client,
        [
          "--max-attempts",
          "250",
          "--reported-token-stop",
          "350000",
          "--max-duration-minutes",
          "90",
        ],
        { json: false },
      );
    } finally {
      console.log = originalLog;
    }
    expect(requestedPath).toBe(
      "/api/redundancy/semantic/run-preview?maxProviderAttempts=250&reportedTokenStopThreshold=350000&maxRunDurationMs=5400000",
    );
  });

  test("invalid per-run budgets are rejected before preview or Run", async () => {
    let requests = 0;
    const mockClient = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/run-preview": {
          response: () => {
            requests++;
            return { ok: true, status: 200, data: {} };
          },
        },
        "POST /api/redundancy/semantic/run": {
          response: () => {
            requests++;
            return { ok: true, status: 202, data: {} };
          },
        },
      },
    });
    for (const args of [
      ["--max-attempts", "0"],
      ["--max-attempts", "75001"],
      ["--max-attempts", "1.5"],
      ["--reported-token-stop", "0"],
      ["--max-duration-minutes", "721"],
      ["--max-duration-minutes"],
    ]) {
      await expectError(
        redundancySemanticRun(mockClient, args, { json: false }),
        "positive safe integer",
      );
    }
    expect(requests).toBe(0);
  });

  test("over-limit or unconfigured preview does not start and stale precondition is safe", async () => {
    let starts = 0;
    const preview = {
      requestId: "request-x",
      precondition: "token-x",
      provider: "TypeSafe",
      modelId: "model-safe",
      eligibleGameCount: 200,
      pairCount: 19_900,
      descriptionBearingPairCount: 0,
      noteBearingPairCount: 0,
      noteTransmissionPermitted: false,
      providerConfigured: false,
      scoringEffect: "annotation-only",
      limits: {
        maxEligiblePairs: 25_000,
        maxProviderAttempts: 100,
        maxRunDurationMs: 60_000,
        reportedTokenStopThreshold: 10_000,
        reportedTokenThresholdIsBilledCeiling: false,
      },
      withinPairLimit: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    const client = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/run-preview": {
          response: { ok: true, status: 200, data: preview },
        },
        "POST /api/redundancy/semantic/run": {
          response: () => {
            starts += 1;
            return { ok: false, status: 412, data: { error: "Run precondition failed" } };
          },
        },
      },
    });
    expect(await redundancySemanticRun(client, [], { json: false })).toContain("not configured");
    expect(starts).toBe(0);
    preview.providerConfigured = true;
    preview.withinPairLimit = false;
    expect(await redundancySemanticRun(client, [], { json: false })).toContain(
      "exceeds the pair limit",
    );
    expect(starts).toBe(0);
    preview.withinPairLimit = true;
    await expectError(redundancySemanticRun(client, [], { json: false }), "preview expired");
    expect(starts).toBe(1);
  });

  test("wishlist all preview discloses candidate counts and starts without note consent", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const consoleOutput: string[] = [];
    const wishlistPreview = {
      requestId: "wishlist-request",
      precondition: "wishlist-token",
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
        maxRunDurationMs: 30 * 60_000,
        reportedTokenStopThreshold: 200_000,
        reportedTokenThresholdIsBilledCeiling: false,
      },
      withinPairLimit: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
      scope: {
        scope: "wishlist",
        wishlistEntryCount: 5,
        selectedCandidateCount: 5,
        unselectedEntryCount: 0,
        ownedOverlapCandidateCount: 1,
        requestedCandidateCount: 4,
        eligibleCandidateCount: 3,
        unavailableCandidateCount: 1,
        eligibleOwnedGameCount: 2,
        comparisonPairCount: 6,
        cachedHitPairCount: 2,
        sendablePairCount: 3,
      },
      selection: { kind: "all" },
      unavailableCandidateBggIds: [500],
    };
    const base = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/run-preview": {
          response: { ok: true, status: 200, data: wishlistPreview },
        },
        "POST /api/redundancy/semantic/run": {
          response: (body) => {
            calls.push({ method: "POST", path: "/api/redundancy/semantic/run", body });
            return { ok: true, status: 202, data: { state: "started", runId: "wishlist-run" } };
          },
        },
      },
    });
    const client = {
      ...base,
      get: <T>(path: string) => {
        calls.push({ method: "GET", path });
        return base.get<T>(path);
      },
    };
    const originalLog = console.log;
    console.log = (message?: unknown) => consoleOutput.push(String(message));
    try {
      const output = await redundancySemanticRun(client, ["--scope", "wishlist"], { json: false });
      expect(output).toContain("Run accepted");
    } finally {
      console.log = originalLog;
    }
    expect(calls[0]?.path).toContain(
      "?maxProviderAttempts=1000&reportedTokenStopThreshold=2000000",
    );
    expect(calls[0]?.path).toContain("&scope=wishlist");
    expect(calls[0]?.path).not.toContain("bggId=");
    expect(consoleOutput[0]).toContain("Wishlist entries: 5; selected: 5; unselected: 0");
    expect(consoleOutput[0]).toContain(
      "Selected owned overlaps: 1; requested: 4; source eligible: 3; source unavailable: 1",
    );
    expect(consoleOutput[0]).toContain(
      "Eligible owned games: 2; comparison pairs: 6; valid C_ONLY cache hits: 2; sendable pairs: 3",
    );
    expect(consoleOutput[0]).toContain("descriptions only");
    expect(consoleOutput[0]).toContain("Provider/model: TypeSafe / model-safe");
    expect(consoleOutput[0]).toContain("Application stop limits");
    expect(consoleOutput[0]).not.toContain("authorize-notes");
    expect(consoleOutput[0]).not.toMatch(/retention/i);
    expect(consoleOutput[0]).not.toContain("TypeSafe's default retention duration is unspecified");
    expect(calls[1]?.body).toEqual({
      requestId: "wishlist-request",
      precondition: "wishlist-token",
      noteTransmissionAuthorized: false,
    });
  });

  test("selected wishlist IDs are sorted repeated preview keys and never enter the start body", async () => {
    const requestedPaths: string[] = [];
    let postBody: unknown;
    let starts = 0;
    const preview = {
      requestId: "selected-request",
      precondition: "selected-token",
      provider: "TypeSafe",
      modelId: "model-safe",
      eligibleGameCount: 0,
      pairCount: 0,
      descriptionBearingPairCount: 0,
      noteBearingPairCount: 0,
      noteTransmissionPermitted: false,
      providerConfigured: true,
      scoringEffect: "annotation-only" as const,
      limits: {
        maxEligiblePairs: 25_000,
        maxProviderAttempts: 100,
        maxRunDurationMs: 60_000,
        reportedTokenStopThreshold: 10_000,
        reportedTokenThresholdIsBilledCeiling: false as const,
      },
      withinPairLimit: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
      scope: {
        scope: "wishlist" as const,
        wishlistEntryCount: 4,
        selectedCandidateCount: 2,
        unselectedEntryCount: 2,
        ownedOverlapCandidateCount: 0,
        requestedCandidateCount: 2,
        eligibleCandidateCount: 2,
        unavailableCandidateCount: 0,
        eligibleOwnedGameCount: 1,
        comparisonPairCount: 2,
        cachedHitPairCount: 1,
        sendablePairCount: 1,
      },
      selection: { kind: "selected" as const, bggIds: [101, 902] },
      unavailableCandidateBggIds: [],
    };
    const base = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/run-preview": {
          response: { ok: true, status: 200, data: preview },
        },
        "POST /api/redundancy/semantic/run": {
          response: (body) => {
            postBody = body;
            starts++;
            return { ok: true, status: 202, data: { state: "started" } };
          },
        },
      },
    });
    const client = {
      ...base,
      get: <T>(path: string) => {
        requestedPaths.push(path);
        return base.get<T>(path);
      },
    };
    const originalLog = console.log;
    console.log = () => {};
    try {
      await redundancySemanticRun(
        client,
        ["--scope", "wishlist", "--bgg-id", "902", "--bgg-id", "101"],
        { json: false },
      );
    } finally {
      console.log = originalLog;
    }
    const previewUrl = new URL(requestedPaths[0] ?? "", "http://localhost");
    expect(previewUrl.searchParams.getAll("bggId")).toEqual(["101", "902"]);
    expect(postBody).toEqual({
      requestId: "selected-request",
      precondition: "selected-token",
      noteTransmissionAuthorized: false,
    });
    preview.selection.bggIds = [101, 903];
    await expectError(
      redundancySemanticRun(client, ["--scope", "wishlist", "--bgg-id", "902", "--bgg-id", "101"], {
        json: false,
      }),
      "did not preserve the requested",
    );
    expect(starts).toBe(1);
  });

  test("invalid wishlist selectors and note authorization fail before any daemon request", async () => {
    let requests = 0;
    const base = createMockClient();
    const client = {
      ...base,
      get: <T>(path: string) => {
        requests++;
        return base.get<T>(path);
      },
      post: <T>(path: string, body?: unknown) => {
        requests++;
        return base.post<T>(path, body);
      },
    };
    const invalidArgs: Array<[string[], string]> = [
      [["--scope"], "--scope must"],
      [["--scope", "unknown"], "--scope must"],
      [["--scope", "wishlist", "--scope", "collection"], "only be specified once"],
      [["--scope", "wishlist", "--bgg-id", "0"], "positive safe integer"],
      [["--scope", "wishlist", "--bgg-id", "01"], "positive safe integer"],
      [["--scope", "wishlist", "--bgg-id", "9007199254740992"], "positive safe integer"],
      [["--scope", "wishlist", "--bgg-id", "11", "--bgg-id", "11"], "must be unique"],
      [["--bgg-id", "11"], "requires --scope wishlist"],
      [["--scope", "collection", "--bgg-id", "11"], "requires --scope wishlist"],
      [["--scope", "wishlist", "--authorize-notes"], "description-only"],
    ];
    for (const [args, message] of invalidArgs) {
      await expectError(redundancySemanticRun(client, args, { json: false }), message);
    }
    expect(requests).toBe(0);
  });

  test("stale wishlist preview returns without a retry or second start", async () => {
    let previews = 0;
    let starts = 0;
    const base = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/run-preview": {
          response: () => {
            previews++;
            return {
              ok: true,
              status: 200,
              data: {
                requestId: "stale-request",
                precondition: "old-token",
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
                  maxRunDurationMs: 60_000,
                  reportedTokenStopThreshold: 10_000,
                  reportedTokenThresholdIsBilledCeiling: false,
                },
                withinPairLimit: true,
                expiresAt: "2030-01-01T00:00:00.000Z",
                scope: {
                  scope: "wishlist",
                  wishlistEntryCount: 1,
                  selectedCandidateCount: 1,
                  unselectedEntryCount: 0,
                  ownedOverlapCandidateCount: 0,
                  requestedCandidateCount: 1,
                  eligibleCandidateCount: 1,
                  unavailableCandidateCount: 0,
                  eligibleOwnedGameCount: 1,
                  comparisonPairCount: 1,
                  cachedHitPairCount: 0,
                  sendablePairCount: 1,
                },
                selection: { kind: "selected", bggIds: [7] },
                unavailableCandidateBggIds: [],
              },
            };
          },
        },
        "POST /api/redundancy/semantic/run": {
          response: () => {
            starts++;
            return { ok: false, status: 412, data: { error: "Run precondition failed" } };
          },
        },
      },
    });
    await expectError(
      redundancySemanticRun(base, ["--scope", "wishlist", "--bgg-id", "7"], { json: false }),
      "preview expired",
    );
    expect(previews).toBe(1);
    expect(starts).toBe(1);
  });

  test("aggregate progress, active run, and cancellation use sanitized run identity", async () => {
    let cancelBody: unknown;
    const client = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/refresh-progress": {
          response: {
            ok: true,
            status: 200,
            data: {
              coverageMeasurement: "not-measured",
              activity: { state: "idle" },
              progress: {
                state: "saved",
                relation: "historical",
                value: {
                  state: "failed",
                  scope: "wishlist",
                  pairCount: 3,
                  completedPairs: 1,
                  cacheHits: 0,
                  cacheMisses: 1,
                  failedPairs: 0,
                  stopReason: "provider-limit",
                },
              },
            },
          },
        },
        "GET /api/redundancy/semantic/active-run": {
          response: { ok: true, status: 200, data: { runId: "live-run" } },
        },
        "POST /api/redundancy/semantic/cancel": {
          response: (body) => {
            cancelBody = body;
            return { ok: true, status: 200, data: { state: "cancellation-requested" } };
          },
        },
      },
    });
    const progress = await redundancySemanticProgress(client, [], { json: false });
    expect(progress).toContain("Coverage counts: not measured");
    expect(progress).toContain("Live activity: idle");
    expect(progress).toContain("Historical saved progress");
    expect(progress).toContain("Run scope: wishlist");
    expect(progress).toContain("legacy local budget limit");
    expect(progress).toContain("does not establish that TypeSafe rate-limited");
    expect(progress).not.toContain("game/");
    expect(await redundancySemanticActiveRun(client, [], { json: false })).toBe(
      "Active Run: live-run",
    );
    await redundancySemanticCancel(client, ["live-run"], { json: true });
    expect(cancelBody).toEqual({ runId: "live-run" });
  });

  test("progress polling carries scope and does not request wishlist projection", async () => {
    const requested: string[] = [];
    const base = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/refresh-progress": {
          response: {
            ok: true,
            status: 200,
            data: {
              coverageMeasurement: "not-measured",
              activity: { state: "idle" },
              progress: {
                state: "saved",
                relation: "historical",
                value: {
                  state: "completed",
                  scope: "wishlist",
                  pairCount: 3,
                  completedPairs: 3,
                  cacheHits: 2,
                  cacheMisses: 1,
                  failedPairs: 0,
                },
              },
            },
          },
        },
      },
    });
    const client = {
      ...base,
      get: <T>(path: string) => {
        requested.push(path);
        return base.get<T>(path);
      },
    };
    const human = await redundancySemanticProgress(client, [], { json: false });
    expect(human).toContain("Run scope: wishlist");
    expect(human).toContain("3/3 completed; 2 cache hits; 1 misses; 0 failed");
    expect(requested).toEqual(["/api/redundancy/semantic/refresh-progress"]);
    const json = JSON.parse(await redundancySemanticProgress(client, [], { json: true })) as {
      progress: { value: { scope?: string } };
    };
    expect(json.progress.value.scope).toBe("wishlist");
    expect(requested).toHaveLength(2);
    expect(requested.every((path) => path.endsWith("refresh-progress"))).toBe(true);
  });

  test("legacy progress scope stays unknown instead of being inferred", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/refresh-progress": {
          response: {
            ok: true,
            status: 200,
            data: {
              coverageMeasurement: "not-measured",
              activity: { state: "idle" },
              progress: {
                state: "saved",
                relation: "unknown",
                value: {
                  state: "completed",
                  pairCount: 1,
                  completedPairs: 1,
                  cacheHits: 1,
                  cacheMisses: 0,
                  failedPairs: 0,
                },
              },
            },
          },
        },
      },
    });
    const human = await redundancySemanticProgress(client, [], { json: false });
    expect(human).toContain("Run scope: unknown (legacy progress; not inferred)");
  });

  test("process-local seal failure is reported as stopped and unpersisted, not saved", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/refresh-progress": {
          response: {
            ok: true,
            status: 200,
            data: {
              coverageMeasurement: "not-measured",
              activity: { state: "idle" },
              progress: {
                state: "process-local",
                retryRunId: "run-seal-failed",
                value: {
                  state: "interrupted",
                  scope: "wishlist",
                  pairCount: 2,
                  completedPairs: 1,
                  cacheHits: 0,
                  cacheMisses: 1,
                  failedPairs: 0,
                  stopReason: "owner-cancelled",
                  publication: {
                    state: "pending",
                    phase: "seal",
                    outcomePersistence: "unpersisted",
                    reason: "seal-failed",
                  },
                },
              },
            },
          },
        },
      },
    });

    const output = await redundancySemanticProgress(client, [], { json: false });
    expect(output).toContain("Process-local execution outcome (not persisted): interrupted");
    expect(output).toContain(
      "Evidence publication: pending (phase seal; outcome persistence unpersisted; seal-failed)",
    );
    expect(output).toContain("Run was stopped by owner cancellation");
    expect(output).not.toContain("Saved progress (run association unknown)");
    expect(output).not.toContain("Historical saved progress");
  });

  test.each([
    {
      publication: { state: "pending", phase: "validate", outcomePersistence: "sealed" },
      expected: "Evidence publication: pending (phase validate; outcome persistence sealed)",
    },
    {
      publication: { state: "published", outcomePersistence: "finalized" },
      expected: "Evidence publication: published (outcome persistence finalized)",
    },
  ])(
    "saved progress reports publication independently: $expected",
    async ({ publication, expected }) => {
      const client = createMockClient({
        routes: {
          "GET /api/redundancy/semantic/refresh-progress": {
            response: {
              ok: true,
              status: 200,
              data: {
                coverageMeasurement: "not-measured",
                activity: { state: "idle" },
                progress: {
                  state: "saved",
                  relation: "historical",
                  value: {
                    state: "completed",
                    pairCount: 1,
                    completedPairs: 1,
                    cacheHits: 0,
                    cacheMisses: 1,
                    failedPairs: 0,
                    publication,
                  },
                },
              },
            },
          },
        },
      });

      const output = await redundancySemanticProgress(client, [], { json: false });
      expect(output).toContain("Historical saved progress");
      expect(output).toContain(expected);
      expect(output).not.toContain("Process-local");
    },
  );

  test.each([
    {
      stopReason: "application-attempt-limit",
      message: "application provider-attempt limit",
      excludes: "TypeSafe rate-limited",
    },
    {
      stopReason: "application-token-threshold",
      message: "application-enforced provider-reported usage threshold",
      excludes: "is a billing cap",
    },
    {
      stopReason: "application-deadline",
      message: "application Run-duration deadline",
    },
  ] as const)(
    "progress explains $stopReason precisely",
    async ({ stopReason, message, excludes }) => {
      const client = createMockClient({
        routes: {
          "GET /api/redundancy/semantic/refresh-progress": {
            response: {
              ok: true,
              status: 200,
              data: {
                coverageMeasurement: "not-measured",
                activity: { state: "active", runId: "live-run" },
                progress: {
                  state: "saved",
                  relation: "active-run",
                  value: {
                    state: "interrupted",
                    pairCount: 1,
                    completedPairs: 0,
                    cacheHits: 0,
                    cacheMisses: 1,
                    failedPairs: 0,
                    stopReason,
                  },
                },
              },
            },
          },
        },
      });
      const progress = await redundancySemanticProgress(client, [], { json: false });
      expect(progress).toContain("Live associated progress");
      expect(progress).toContain("Live activity: active (Run live-run)");
      expect(progress).toContain("Coverage counts: not measured");
      expect(progress).toContain(message);
      if (excludes) expect(progress).not.toContain(excludes);
      expect(progress).toContain("Prior checkpoints are retained");
    },
  );

  test("refresh progress reports unavailable and empty states without claiming coverage", async () => {
    const client = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/refresh-progress": {
          response: {
            ok: true,
            status: 200,
            data: {
              coverageMeasurement: "not-measured",
              activity: { state: "unavailable" },
              progress: { state: "unavailable" },
            },
          },
        },
      },
    });
    const unavailable = await redundancySemanticProgress(client, [], { json: false });
    expect(unavailable).toContain("Live activity: unavailable");
    expect(unavailable).toContain("Saved progress: unavailable");
    expect(unavailable).toContain("Coverage counts: not measured");
    expect(unavailable).not.toContain("coverage measured");

    const noneClient = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/refresh-progress": {
          response: {
            ok: true,
            status: 200,
            data: {
              coverageMeasurement: "not-measured",
              activity: { state: "idle" },
              progress: { state: "none" },
            },
          },
        },
      },
    });
    const none = await redundancySemanticProgress(noneClient, [], { json: false });
    expect(none).toContain("Live activity: idle");
    expect(none).toContain("Saved progress: none");
  });

  test("semantic settings and status are reads/settings only", async () => {
    const client = createMockClient({
      routes: {
        "PATCH /api/redundancy/semantic-settings": {
          response: { ok: true, status: 200, data: { settings: { enabled: true } } },
        },
        "GET /api/redundancy/semantic/summary": {
          response: { ok: true, status: 200, data: { status: "not-ready", generation: null } },
        },
      },
    });
    expect(
      await redundancySemanticSettings(client, ["enabled", "true"], { json: false }),
    ).toContain("enabled");
    expect(await redundancySemanticStatus(client, [], { json: true })).toContain("not-ready");
  });

  test("factual weight uses strict non-negative validation and maps into factual weight", async () => {
    let body: unknown;
    const client = createMockClient({
      routes: {
        "PATCH /api/redundancy/semantic-settings": {
          response: (value) => {
            body = value;
            return { ok: true, status: 200, data: { settings: { weights: { factual: 0.7 } } } };
          },
        },
      },
    });
    await redundancySemanticSettings(client, ["factual", "0.7"], { json: true });
    expect(body).toEqual({ weights: { factual: 0.7 } });
    for (const value of ["", "-0.1", "NaN", "Infinity"]) {
      await expectRejected(redundancySemanticSettings(client, ["factual", value], { json: true }));
    }
  });
});

async function expectRejected(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error("Expected command to reject");
  } catch (error) {
    expect(String(error)).toContain("non-negative number");
  }
}

async function expectError(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise;
    throw new Error("Expected command to reject");
  } catch (error) {
    expect(String(error)).toContain(message);
  }
}
