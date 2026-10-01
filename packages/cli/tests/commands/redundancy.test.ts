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
      retentionCaveat: "Provider retention applies.",
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
          response: (body) => {
            calls.push({ method: "POST", path: "/api/redundancy/semantic/run", body });
            return { ok: true, status: 202, data: { state: "started", runId: "run-1" } };
          },
        },
      },
    });
    const output = await redundancySemanticRun(client, [], { json: false });
    expect(output).toContain("100 provider attempts");
    expect(output).toContain("not a hard billed ceiling");
    expect(output).toContain("Note transmission is off by default");
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
      retentionCaveat: "Retention applies.",
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
      retentionCaveat: "Retention applies.",
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
    await expectError(
      redundancySemanticRun(client, [], { json: false }),
      "Run precondition failed",
    );
    expect(starts).toBe(1);
  });

  test("aggregate progress, active run, and cancellation use sanitized run identity", async () => {
    let cancelBody: unknown;
    const client = createMockClient({
      routes: {
        "GET /api/redundancy/semantic/refresh-status": {
          response: {
            ok: true,
            status: 200,
            data: {
              status: "not-ready",
              measurement: "current",
              eligibleGameCount: 3,
              pairCount: 3,
              coverage: null,
              progress: {
                state: "failed",
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
    expect(progress).toContain("provider attempt or reported-token limit");
    expect(progress).not.toContain("game/");
    expect(await redundancySemanticActiveRun(client, [], { json: false })).toBe(
      "Active Run: live-run",
    );
    await redundancySemanticCancel(client, ["live-run"], { json: true });
    expect(cancelBody).toEqual({ runId: "live-run" });
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
