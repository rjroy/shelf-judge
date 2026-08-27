import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { calculatePurchaseUtilization } from "@shelf-judge/shared";
import { PurchaseUtilizationPanel } from "@/components/purchase-utilization-panel";

function result(
  overrides: {
    acquisition?: Parameters<typeof calculatePurchaseUtilization>[0]["acquisition"];
    benchmark?: Parameters<typeof calculatePurchaseUtilization>[0]["entertainmentBenchmark"];
    playCount?: number;
    fitness?: string | null;
    suggestedPlayerPoll?: Parameters<typeof calculatePurchaseUtilization>[0]["suggestedPlayerPoll"];
  } = {},
) {
  return calculatePurchaseUtilization({
    acquisition: overrides.acquisition ?? {
      state: "purchase",
      amount: { hundredths: 2000, source: "manual", confirmedAt: "2026-01-02T00:00:00Z" },
    },
    entertainmentBenchmark:
      overrides.benchmark === undefined
        ? {
            state: "configured",
            amount: { hundredths: 800, source: "manual", confirmedAt: "2026-01-03T00:00:00Z" },
          }
        : overrides.benchmark,
    playCount: {
      status: "valid",
      value: overrides.playCount ?? 2,
      source: "bgg-collection",
      observedAt: "2026-01-04T00:00:00Z",
    },
    duration: {
      status: "valid",
      value: 30,
      source: "bgg-thing",
      observedAt: "2026-01-05T00:00:00Z",
    },
    playerRange: {
      status: "valid",
      value: { minPlayers: 2, maxPlayers: 2 },
      source: "bgg-player-range",
      observedAt: "2026-01-05T00:00:00Z",
    },
    suggestedPlayerPoll: overrides.suggestedPlayerPoll ?? {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "bgg-suggested-player-poll",
      observedAt: "2026-01-05T00:00:00Z",
    },
    fitness: overrides.fitness === undefined ? "6.0" : overrides.fitness,
  });
}

describe("PurchaseUtilizationPanel", () => {
  test("leads with outcome before exact daemon-provided arithmetic", () => {
    const html = renderToStaticMarkup(<PurchaseUtilizationPanel result={result()} />);
    expect(html.indexOf("Value threshold not yet met")).toBeLessThan(
      html.indexOf("Value remaining"),
    );
    expect(html).toContain("$4.00");
    expect(html).toContain("Estimated additional plays to value threshold");
    expect(html).toContain("Cost per modeled player-hour");
  });

  test("renders zero-play explanations, evidence sources, times, and disclaimers", () => {
    const html = renderToStaticMarkup(
      <PurchaseUtilizationPanel
        result={result({ playCount: 0, benchmark: null, fitness: null })}
      />,
    );
    expect(html).toContain("0.00x");
    expect(html).toContain("BGG collection");
    expect(html).toContain("actual sessions may differ");
    expect(html).toContain("future plays use the shown duration");
    expect(html).toContain('href="/settings#entertainment-benchmark"');
    expect(html).toContain(
      "do not need fitness, duration, player count, or an entertainment benchmark",
    );
    expect(html).toContain("may still support the hourly benchmark and future-play estimate");
  });

  test("renders veto precedence and unreachable state", () => {
    const html = renderToStaticMarkup(
      <PurchaseUtilizationPanel result={result({ fitness: "0.0", benchmark: null })} />,
    );
    expect(html).toContain("Value threshold not yet met");
    expect(html).toContain("Unreachable at current fitness");
    expect(html).toContain("$20.00");
    expect(html).toContain("do not need a collection entertainment benchmark");
  });

  test("renders unavailable, gift, and previously-owned language without judgment", () => {
    const unavailable = renderToStaticMarkup(
      <PurchaseUtilizationPanel result={result({ acquisition: { state: "unknown" } })} />,
    );
    const gift = renderToStaticMarkup(
      <PurchaseUtilizationPanel result={result({ acquisition: { state: "gift" } })} />,
    );
    const previous = renderToStaticMarkup(
      <PurchaseUtilizationPanel result={result()} isPreviouslyOwned />,
    );
    expect(unavailable).toContain("Purchase value unavailable");
    expect(gift).toContain("Purchase value not applicable");
    expect(gift).toContain("Gift; no owner cost.");
    expect(previous).toContain("current fitness");
    expect(previous).toContain("not a historical-value estimate");
  });

  test("shows tied player-count evidence rather than implying fractional attendance", () => {
    const html = renderToStaticMarkup(
      <PurchaseUtilizationPanel
        result={result({
          suggestedPlayerPoll: {
            status: "valid",
            state: "usable",
            buckets: [
              { playerCount: "3", best: 9, recommended: 1, notRecommended: 0 },
              { playerCount: "4", best: 9, recommended: 1, notRecommended: 0 },
            ],
            source: "bgg-suggested-player-poll",
            observedAt: "2026-01-05T00:00:00Z",
          },
        })}
      />,
    );
    expect(html).toContain("3.5 players");
    expect(html).toContain("tied Best-vote counts at 3 and 4 players were averaged");
  });

  test("formats safe-integer purchase evidence without floating-point cent drift", () => {
    const html = renderToStaticMarkup(
      <PurchaseUtilizationPanel
        result={result({
          acquisition: {
            state: "purchase",
            amount: {
              hundredths: 9007199254740990,
              source: "manual",
              confirmedAt: "2026-01-02T00:00:00Z",
            },
          },
        })}
      />,
    );
    expect(html).toContain("$90071992547409.90");
    expect(html).not.toContain("$90071992547409.91");
  });
});
