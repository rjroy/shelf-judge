import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedPlayIntentionHistory } from "@shelf-judge/shared";
import { ResolvedPlayIntentionHistorySchema } from "@shelf-judge/shared";
import { IntentionHistory } from "@/components/intention-history";

const history: ResolvedPlayIntentionHistory = [
  {
    intentionId: "intention-a",
    gameId: "game-1",
    gameName: "Test Game",
    kind: "replay",
    baseline: {
      playCount: 3,
      evidenceSource: "bgg-collection",
      observedAt: "2026-08-27T09:00:00.000Z",
    },
    createdAt: "2026-08-27T10:00:00.000Z",
    version: 2,
    resolution: {
      outcome: "completed",
      source: "owner-confirmed",
      resolvedAt: "2026-08-28T12:00:00.000Z",
    },
  },
  {
    intentionId: "intention-b",
    gameId: "game-1",
    gameName: "Test Game",
    kind: "first-play",
    baseline: { playCount: 0, evidenceSource: "manual", observedAt: "2026-08-26T09:00:00.000Z" },
    createdAt: "2026-08-26T10:00:00.000Z",
    version: 2,
    resolution: {
      outcome: "retired",
      source: "owner-retired",
      resolvedAt: "2026-08-28T11:00:00.000Z",
    },
  },
];

describe("IntentionHistory", () => {
  test("renders accepted order and complete kind, baseline, creation, and resolution provenance", () => {
    expect(ResolvedPlayIntentionHistorySchema.safeParse(history).success).toBe(true);
    const html = renderToStaticMarkup(<IntentionHistory history={history} />);
    expect(html.indexOf("intention-a")).toBeLessThan(html.indexOf("intention-b"));
    expect(html).toContain("Replay");
    expect(html).toContain("3 recorded plays");
    expect(html).toContain("from bgg-collection evidence observed at");
    expect(html).toContain("Owner confirmed completion");
    expect(html).toContain("Owner retired intention");
  });

  test("shared validation rejects unstable order and permits a new ID after resolution", () => {
    expect(ResolvedPlayIntentionHistorySchema.safeParse([...history].reverse()).success).toBe(
      false,
    );
    expect(
      ResolvedPlayIntentionHistorySchema.safeParse([
        {
          ...history[0],
          intentionId: "new-intention",
          createdAt: "2026-08-28T13:00:00.000Z",
          resolution: {
            outcome: "retired",
            source: "owner-retired",
            resolvedAt: "2026-08-28T14:00:00.000Z",
          },
        },
        ...history,
      ]).success,
    ).toBe(true);
  });

  test("history remains absent from the Profile Overview", async () => {
    const overview = await Bun.file("packages/web/app/page.tsx").text();
    expect(overview).not.toContain("IntentionHistory");
    expect(overview).not.toContain("Resolved play intentions");
  });
});
