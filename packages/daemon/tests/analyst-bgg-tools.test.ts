import { describe, expect, it } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { BggClientError } from "../src/services/bgg-client.js";
import {
  createAnalystBggTools,
  type AnalystBggEvidenceRegistry,
  type AnalystBggToolOptions,
} from "../src/services/grounded-analysis/analyst-bgg-tools.js";

const toolResultSchema = z
  .object({
    status: z.string(),
    code: z.string().optional(),
    retryable: z.boolean().optional(),
    state: z.string().optional(),
    candidates: z.array(z.unknown()).optional(),
    observationCitationId: z.string().optional(),
    truncated: z.boolean().optional(),
    score: z.object({ value: z.number() }).passthrough().optional(),
    facts: z.array(z.object({ missingFields: z.array(z.string()) }).passthrough()).optional(),
    failures: z.array(z.object({ code: z.string() }).passthrough()).optional(),
    coverage: z.string().optional(),
  })
  .passthrough();
const factsResultSchema = toolResultSchema.extend({
  facts: z.array(z.object({ missingFields: z.array(z.string()) }).passthrough()),
  failures: z.array(z.object({ code: z.string() }).passthrough()),
});
const unusedContext = new Proxy({} as ExtensionContext, {
  get: () => () => undefined,
});

function setup(overrides: Partial<AnalystBggToolOptions> = {}) {
  const records: unknown[] = [];
  let serial = 0;
  const staged = new Map<string, unknown>();
  const committed: string[] = [];
  const discarded: string[] = [];
  const registry: AnalystBggEvidenceRegistry = {
    stage(record) {
      const id = `citation-${++serial}`;
      staged.set(id, record);
      return id;
    },
    commit(ids) {
      committed.push(...ids);
    },
    discard(ids) {
      discarded.push(...ids);
      for (const id of ids) staged.delete(id);
    },
  };
  const calls = { search: 0, hot: 0, facts: 0 };
  const options: AnalystBggToolOptions = {
    signal: new AbortController().signal,
    ownerMessages: ["Please find Brass: Birmingham and BGG ID 174430 and BGG ID 174431"],
    registry,
    transport: {
      async searchTitles() {
        await Promise.resolve();
        calls.search++;
        return {
          observedAt: "2026-09-25T00:00:00Z",
          returnedCount: 0,
          emittedCount: 0,
          truncated: false,
          candidates: [],
        };
      },
      async reviewHot() {
        await Promise.resolve();
        calls.hot++;
        return {
          observedAt: "2026-09-25T00:00:00Z",
          returnedCount: 0,
          emittedCount: 0,
          truncated: false,
          candidates: [],
        };
      },
      async readFacts(ids) {
        await Promise.resolve();
        calls.facts++;
        return {
          facts: ids.map((bggId) => ({
            bggId,
            primaryName: "Game",
            yearPublished: null,
            yearMissing: true,
            mechanics: [],
            mechanicsMissing: true,
            mechanicsComplete: false,
            warnings: [],
            observedAt: "2026-09-25T00:00:00Z",
          })),
          failures: [],
        };
      },
    },
    ...overrides,
  };
  const tools = createAnalystBggTools(options);
  const invoke = async (name: string, args: unknown) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const response = await tool.execute("test", args, undefined, undefined, unusedContext);
    const content = response.content[0];
    if (content.type !== "text") throw new Error("Expected JSON tool response");
    return toolResultSchema.parse(JSON.parse(content.text) as unknown);
  };
  return { invoke, calls, records, committed, discarded, staged, options };
}

describe("Analyst BGG tools", () => {
  it("rejects invalid owner spans without network work or echoing the selected text", async () => {
    const { invoke, calls } = setup();
    const result = await invoke("searchBggTitles", { ownerMessageIndex: 0, start: 400, end: 402 });
    expect(result).toEqual({ status: "error", code: "InvalidInput", retryable: false });
    expect(calls.search).toBe(0);
  });

  it("does not authorize invented IDs", async () => {
    const { invoke, calls } = setup();
    const result = await invoke("readBggFacts", { bggIds: [999] });
    expect(result.code).toBe("UnauthorizedId");
    expect(calls.facts).toBe(0);
  });

  it("exposes an authorized fitness preview and enforces the three-preview budget", async () => {
    const { invoke, options } = setup();
    let previews = 0;
    options.transport.previewFitness = async (bggId) => {
      await Promise.resolve();
      previews++;
      expect(bggId).toBe(174430);
      return { status: "error", code: "PredictionUnavailable", retryable: false };
    };
    const first = await invoke("previewBggFitness", { bggId: 174430 });
    expect(first).toEqual({ status: "error", code: "PredictionUnavailable", retryable: false });
    await invoke("previewBggFitness", { bggId: 174430 });
    await invoke("previewBggFitness", { bggId: 174430 });
    const exhausted = await invoke("previewBggFitness", { bggId: 174430 });
    expect(exhausted.code).toBe("BudgetExhausted");
    expect(previews).toBe(3);
  });

  it("rejects an invented preview ID without invoking the preview service", async () => {
    const { invoke, options } = setup();
    let previews = 0;
    options.transport.previewFitness = async () => {
      await Promise.resolve();
      previews++;
      return { status: "error", code: "NotConfigured", retryable: false };
    };
    const result = await invoke("previewBggFitness", { bggId: 999 });
    expect(result.code).toBe("UnauthorizedId");
    expect(previews).toBe(0);
  });

  it("returns the configured preview projection rather than NotConfigured", async () => {
    const { invoke, options } = setup();
    options.transport.previewFitness = async () => {
      await Promise.resolve();
      return {
        status: "ok",
        state: "predicted",
        bggId: 174430,
        primaryName: "Game",
        bggLookup: {
          status: "verified",
          observedAt: "2026-09-25T00:00:00Z",
          factCitationId: "fact-citation",
        },
        calculatedAt: "2026-09-25T00:00:00Z",
        sourceVersion: "preview-v2",
        calculationCitationId: "calculation-citation",
        score: {
          value: 7.3,
          label: "predicted",
          readinessStage: 2,
          confidence: "moderate",
          predictionUnavailable: null,
          axes: [],
          referenceGames: [],
        },
      };
    };
    const result = await invoke("previewBggFitness", { bggId: 174430 });
    expect(result).toMatchObject({ status: "ok", state: "predicted", score: { value: 7.3 } });
  });

  it("passes a verified Thing fact from this turn into preview without refetching facts", async () => {
    const { invoke, options, calls } = setup();
    let cachedId: number | undefined;
    await invoke("readBggFacts", { bggIds: [174430] });
    options.transport.previewFitness = async (_id, previewOptions) => {
      await Promise.resolve();
      cachedId = previewOptions.cachedFact?.bggId;
      return { status: "error", code: "PredictionUnavailable", retryable: false };
    };
    await invoke("previewBggFitness", { bggId: 174430 });
    expect(cachedId).toBe(174430);
    expect(calls.facts).toBe(1);
  });

  it("reuses a verified preview for repeated same-turn inspection", async () => {
    const { invoke, options } = setup();
    let calls = 0;
    options.transport.previewFitness = async () => {
      await Promise.resolve();
      calls++;
      return {
        status: "ok",
        state: "predicted",
        bggId: 174430,
        primaryName: "Game",
        bggLookup: {
          status: "verified",
          observedAt: "2026-09-25T00:00:00Z",
          factCitationId: "fact",
        },
        calculatedAt: "2026-09-25T00:00:00Z",
        sourceVersion: "preview-v2",
        calculationCitationId: "calc",
        score: {
          value: 6.5,
          label: "predicted",
          readinessStage: 2,
          confidence: "moderate",
          predictionUnavailable: null,
          axes: [],
          referenceGames: [],
        },
      };
    };
    const first = await invoke("previewBggFitness", { bggId: 174430 });
    const second = await invoke("previewBggFitness", { bggId: 174430 });
    expect(first).toEqual(second);
    expect(calls).toBe(1);
  });

  it("does not publish a preview completed after turn cancellation", async () => {
    const controller = new AbortController();
    const { invoke, options } = setup({ signal: controller.signal });
    let complete: ((value: unknown) => void) | undefined;
    options.transport.previewFitness = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    const pending = invoke("previewBggFitness", { bggId: 174430 });
    await Promise.resolve();
    controller.abort();
    complete?.({ status: "error", code: "NotConfigured", retryable: false });
    expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns zero-hit observation citation", async () => {
    const { invoke, committed } = setup();
    const message = "Please find Brass: Birmingham and BGG ID 174430 and BGG ID 174431";
    const start = message.indexOf("Brass: Birmingham");
    const result = await invoke("searchBggTitles", {
      ownerMessageIndex: 0,
      start,
      end: start + [..."Brass: Birmingham"].length,
    });
    expect(result.status).toBe("ok");
    expect(result.candidates).toEqual([]);
    expect(result.observationCitationId).toBeTruthy();
    expect(committed).toHaveLength(1);
  });

  it("bounds discovery candidates and reports truncation", async () => {
    const base = setup().options.transport;
    const { invoke } = setup({
      transport: {
        ...base,
        async searchTitles() {
          await Promise.resolve();
          return {
            observedAt: "2026-09-25T00:00:00Z",
            returnedCount: 12,
            emittedCount: 12,
            truncated: false,
            candidates: Array.from({ length: 12 }, (_, i) => ({
              bggId: i + 1,
              primaryName: `Game ${i}`,
              yearPublished: null,
            })),
          };
        },
      },
    });
    const message = "Please find Brass: Birmingham and BGG ID 174430 and BGG ID 174431";
    const start = message.indexOf("Brass: Birmingham");
    const result = await invoke("searchBggTitles", {
      ownerMessageIndex: 0,
      start,
      end: start + [..."Brass: Birmingham"].length,
    });
    expect(result.candidates).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("preserves partial facts and missing-field distinctions", async () => {
    const { invoke } = setup({
      transport: {
        ...setup().options.transport,
        async readFacts(ids) {
          await Promise.resolve();
          return {
            facts: [
              {
                bggId: ids[0],
                primaryName: "Game",
                yearPublished: null,
                yearMissing: true,
                mechanics: [],
                mechanicsMissing: true,
                mechanicsComplete: false,
                warnings: [],
                observedAt: "2026-09-25T00:00:00Z",
              },
            ],
            failures: [{ bggId: ids[1], code: "MissingGame" }],
          };
        },
      },
    });
    const result = await invoke("readBggFacts", { bggIds: [174430, 174431] });
    const factsResult = factsResultSchema.parse(result);
    expect(result.status).toBe("partial");
    expect(factsResult.facts[0].missingFields).toEqual(["year", "mechanics"]);
    expect(factsResult.failures[0].code).toBe("MissingGame");
  });

  it("treats a valid Thing with no mechanics as a successful partial-field fact", async () => {
    const base = setup().options.transport;
    const { invoke } = setup({
      transport: {
        ...base,
        async readFacts(ids) {
          await Promise.resolve();
          return {
            facts: [
              {
                bggId: ids[0],
                primaryName: "Game",
                yearPublished: 2020,
                yearMissing: false,
                mechanics: [],
                mechanicsMissing: true,
                mechanicsComplete: false,
                warnings: [],
                observedAt: "2026-09-25T00:00:00Z",
              },
            ],
            failures: [],
          };
        },
      },
    });
    const result = await invoke("readBggFacts", { bggIds: [174430] });
    const factsResult = factsResultSchema.parse(result);
    expect(result.status).toBe("ok");
    expect(result.coverage).toBe("complete");
    expect(result.failures).toEqual([]);
    expect(factsResult.facts[0]).toMatchObject({
      mechanics: [],
      mechanicsComplete: false,
      missingFields: ["mechanics"],
    });
  });

  it("converts transport errors to safe typed failures", async () => {
    const { invoke } = setup({
      transport: {
        ...setup().options.transport,
        async readFacts() {
          await Promise.resolve();
          throw new Error("secret XML body 174430");
        },
      },
    });
    const result = await invoke("readBggFacts", { bggIds: [174430] });
    expect(result).toEqual({ status: "error", code: "BggOutage", retryable: true });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("maps typed BGG client errors to safe tool failure codes", async () => {
    const cases = [
      ["unauthorized", "BggUnauthorized"],
      ["rate-limited", "BggThrottled"],
      ["queued", "BggQueuedTimeout"],
      ["timeout", "ToolTimeout"],
      ["attempt-budget", "BudgetExhausted"],
      ["parse", "BggParse"],
    ] as const;
    for (const [clientCode, toolCode] of cases) {
      const base = setup().options.transport;
      const { invoke } = setup({
        transport: {
          ...base,
          async readFacts() {
            await Promise.resolve();
            throw new BggClientError(clientCode);
          },
        },
      });
      const result = await invoke("readBggFacts", { bggIds: [174430] });
      expect(result).toEqual({
        status: "error",
        code: toolCode,
        retryable: toolCode === "BggThrottled",
      });
      expect(JSON.stringify(result)).not.toContain(clientCode);
    }
  });

  it("discards malformed staged discovery evidence without authorizing its IDs", async () => {
    const base = setup().options.transport;
    const { invoke, committed, discarded, calls } = setup({
      transport: {
        ...base,
        async searchTitles() {
          await Promise.resolve();
          return {
            observedAt: "not-a-time",
            returnedCount: 1,
            emittedCount: 1,
            truncated: false,
            candidates: [{ bggId: 987654, primaryName: "Bad time", yearPublished: null }],
          };
        },
      },
    });
    const message = "Please find Brass: Birmingham";
    const start = message.indexOf("Brass: Birmingham");
    const result = await invoke("searchBggTitles", {
      ownerMessageIndex: 0,
      start,
      end: start + [..."Brass: Birmingham"].length,
    });
    expect(result.status).toBe("error");
    expect(committed).toEqual([]);
    expect(discarded.length).toBeGreaterThan(0);
    expect((await invoke("readBggFacts", { bggIds: [987654] })).code).toBe("UnauthorizedId");
    expect(calls.facts).toBe(0);
  });

  it("uses exact canonical owner BGG URLs and rejects obvious non-title spans", async () => {
    const { invoke, calls } = setup({
      ownerMessages: [
        "Could you search the title ‘Café’ at https://boardgamegeek.com.evil/boardgame/174430",
      ],
    });
    const message =
      "Could you search the title ‘Café’ at https://boardgamegeek.com.evil/boardgame/174430";
    const yesStart = message.indexOf("Could you");
    expect(
      (
        await invoke("searchBggTitles", {
          ownerMessageIndex: 0,
          start: yesStart,
          end: yesStart + "Could you".length,
        })
      ).code,
    ).toBe("InvalidInput");
    expect((await invoke("readBggFacts", { bggIds: [174430] })).code).toBe("UnauthorizedId");
    expect(calls.search).toBe(0);
    const canonical = setup({ ownerMessages: ["https://boardgamegeek.com/boardgame/174430"] });
    expect((await canonical.invoke("readBggFacts", { bggIds: [174430] })).status).toBe("ok");
    for (const host of ["evilboardgamegeek.com", "boardgamegeek.com.evil"]) {
      const noncanonical = setup({ ownerMessages: [`https://${host}/boardgame/174430`] });
      expect((await noncanonical.invoke("readBggFacts", { bggIds: [174430] })).code).toBe(
        "UnauthorizedId",
      );
    }
  });

  it("reserves discovery IDs immediately across Hot and title searches", async () => {
    const base = setup().options.transport;
    const reserved = new Set<number>();
    const { invoke } = setup({
      ownerMessages: ["Brass: Birmingham"],
      turnBudget: {
        reserveToolInvocation: () => true,
        reserveThingIds(ids) {
          if (ids.some((id) => reserved.has(id)) || reserved.size + ids.length > 20) return false;
          for (const id of ids) reserved.add(id);
          return true;
        },
      },
      transport: {
        ...base,
        async reviewHot() {
          await Promise.resolve();
          return {
            observedAt: "2026-09-25T00:00:00Z",
            returnedCount: 20,
            emittedCount: 20,
            truncated: false,
            candidates: Array.from({ length: 20 }, (_, i) => ({
              bggId: i + 1,
              primaryName: `Hot ${i}`,
              yearPublished: null,
            })),
          };
        },
        async searchTitles() {
          await Promise.resolve();
          return {
            observedAt: "2026-09-25T00:00:00Z",
            returnedCount: 10,
            emittedCount: 10,
            truncated: false,
            candidates: Array.from({ length: 10 }, (_, i) => ({
              bggId: i + 101,
              primaryName: `Title ${i}`,
              yearPublished: null,
            })),
          };
        },
      },
    });
    const hot = await invoke("reviewBggHot", {});
    const title = await invoke("searchBggTitles", { ownerMessageIndex: 0, start: 0, end: 17 });
    expect(hot.candidates).toHaveLength(20);
    expect(title.status).toBe("ok");
    expect(title.candidates).toEqual([]);
    expect(reserved.size).toBe(20);
  });

  it("interprets owner span offsets as Unicode code points", async () => {
    let searched = "";
    const base = setup().options.transport;
    const { invoke } = setup({
      ownerMessages: ["🧩 Café"],
      transport: {
        ...base,
        async searchTitles(query) {
          await Promise.resolve();
          searched = query;
          return {
            observedAt: "2026-09-25T00:00:00Z",
            returnedCount: 0,
            emittedCount: 0,
            truncated: false,
            candidates: [],
          };
        },
      },
    });
    const result = await invoke("searchBggTitles", { ownerMessageIndex: 0, start: 2, end: 6 });
    expect(result.status).toBe("ok");
    expect(searched).toBe("Café");
  });

  it("caps calls and honors cancellation", async () => {
    const { invoke } = setup();
    for (let i = 0; i < 2; i++) await invoke("reviewBggHot", {});
    expect((await invoke("reviewBggHot", {})).code).toBe("BudgetExhausted");
    const controller = new AbortController();
    controller.abort();
    const aborted = setup({ signal: controller.signal });
    expect(aborted.invoke("reviewBggHot", {})).rejects.toThrow("aborted");
  });

  it("uses the injected turn-wide invocation and HTTP attempt budgets", async () => {
    const base = setup().options.transport;
    let reservations = 0;
    let hotCalls = 0;
    let transportBudget: unknown;
    const sharedAttemptBudget = { tryConsume: () => true };
    const { invoke } = setup({
      turnBudget: {
        reserveToolInvocation() {
          reservations++;
          return reservations === 1;
        },
        reserveThingIds() {
          return true;
        },
        httpAttemptBudget: sharedAttemptBudget,
      },
      transport: {
        ...base,
        async reviewHot(options) {
          await Promise.resolve();
          hotCalls++;
          transportBudget = options.attemptBudget;
          return {
            observedAt: "2026-09-25T00:00:00Z",
            returnedCount: 0,
            emittedCount: 0,
            truncated: false,
            candidates: [],
          };
        },
      },
    });
    expect((await invoke("reviewBggHot", {})).status).toBe("ok");
    expect(transportBudget).toBe(sharedAttemptBudget);
    expect((await invoke("reviewBggHot", {})).code).toBe("BudgetExhausted");
    expect(hotCalls).toBe(1);
  });
});
