import { describe, expect, test } from "bun:test";
import {
  redundancyDisable,
  redundancyEnable,
  redundancySet,
  redundancySettings,
  redundancyStage,
  redundancySemanticInspect,
  redundancySemanticStart,
  redundancySemanticSettings,
  redundancySemanticDisclosure,
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

  test("fetches and verifies every page of the exact manifest", async () => {
    const seen: number[] = [];
    const client = createMockClient({
      routes: {
        "POST /api/redundancy/semantic/disclosure/page": {
          response: (body) => {
            const offset = (body as { offset: number }).offset;
            seen.push(offset);
            return {
              ok: true,
              status: 200,
              data: {
                manifestId: "m",
                manifestDigest: "d",
                offset,
                nextOffset: offset === 0 ? 2 : 3,
                complete: offset !== 0,
                pairs:
                  offset === 0
                    ? [
                        {
                          gameA: "a",
                          gameB: "b",
                          hasDescriptionA: true,
                          hasDescriptionB: false,
                          hasOwnerNoteA: false,
                          hasOwnerNoteB: true,
                        },
                        {
                          gameA: "a",
                          gameB: "c",
                          hasDescriptionA: true,
                          hasDescriptionB: true,
                          hasOwnerNoteA: false,
                          hasOwnerNoteB: false,
                        },
                      ]
                    : [
                        {
                          gameA: "b",
                          gameB: "c",
                          hasDescriptionA: false,
                          hasDescriptionB: true,
                          hasOwnerNoteA: true,
                          hasOwnerNoteB: true,
                        },
                      ],
              },
            };
          },
        },
      },
    });
    const result = await redundancySemanticInspect(client, ["m", "d", "3"], { json: true });
    expect(seen).toEqual([0, 2]);
    expect(JSON.parse(result)).toMatchObject({
      pairCount: 3,
      pairs: [
        { gameA: "a", gameB: "b" },
        { gameA: "a", gameB: "c" },
        { gameA: "b", gameB: "c" },
      ],
    });
  });

  test("inspects a zero-pair manifest with final numeric nextOffset", async () => {
    const client = createMockClient({
      routes: {
        "POST /api/redundancy/semantic/disclosure/page": {
          response: {
            ok: true,
            status: 200,
            data: {
              manifestId: "empty",
              manifestDigest: "digest",
              offset: 0,
              nextOffset: 0,
              complete: true,
              pairs: [],
              receipt: { pageIndex: 0, nextOffset: 0, complete: true },
            },
          },
        },
      },
    });
    expect(
      await redundancySemanticInspect(client, ["empty", "digest", "0"], { json: true }),
    ).toContain('"pairCount": 0');
  });

  test("refuses stale disclosure and requires explicit authorization", async () => {
    const client = createMockClient({
      routes: {
        "POST /api/redundancy/semantic/acknowledge-and-start": {
          response: { ok: false, status: 409, data: { error: "Disclosure is not current" } },
        },
      },
    });
    try {
      await redundancySemanticStart(client, ["m", "d", "0"], { json: false });
      throw new Error("expected authorization refusal");
    } catch (error) {
      expect(String(error)).toContain("Usage:");
    }
    try {
      await redundancySemanticStart(client, ["m", "d", "0", "--authorize"], { json: false });
      throw new Error("expected stale disclosure refusal");
    } catch (error) {
      expect(String(error)).toContain("Disclosure is not current");
    }
  });

  test("C-only refresh explicitly declines notes and does not request cached note use", async () => {
    let body: unknown;
    const client = createMockClient({
      routes: {
        "POST /api/redundancy/semantic/acknowledge-and-start": {
          response: (value) => {
            body = value;
            return { ok: true, status: 202, data: { status: "running" } };
          },
        },
      },
    });
    await redundancySemanticStart(client, ["m", "d", "2", "--authorize", "--decline-notes"], {
      json: true,
    });
    expect(body).toEqual({
      manifestId: "m",
      manifestDigest: "d",
      pairCount: 2,
      transmissionAuthorized: true,
      noteTransmissionAuthorized: false,
      cachedOwnerNoteUseAuthorized: false,
    });
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
        "POST /api/redundancy/semantic/disclosure": {
          response: { ok: true, status: 201, data: { id: "m", digest: "d" } },
        },
      },
    });
    expect(
      await redundancySemanticSettings(client, ["enabled", "true"], { json: false }),
    ).toContain("enabled");
    expect(await redundancySemanticStatus(client, [], { json: true })).toContain("not-ready");
    expect(
      await redundancySemanticDisclosure(client, ["description-only"], { json: true }),
    ).toContain("digest");
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

  test("cached-note use is independent from fresh note transmission consent", async () => {
    let body: unknown;
    const client = createMockClient({
      routes: {
        "POST /api/redundancy/semantic/acknowledge-and-start": {
          response: (value) => {
            body = value;
            return { ok: true, status: 202, data: { status: "running" } };
          },
        },
      },
    });
    await redundancySemanticStart(
      client,
      ["m", "d", "2", "--authorize", "--decline-notes", "--use-cached-notes"],
      { json: true },
    );
    expect(body).toMatchObject({
      transmissionAuthorized: true,
      noteTransmissionAuthorized: false,
      cachedOwnerNoteUseAuthorized: true,
    });
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
