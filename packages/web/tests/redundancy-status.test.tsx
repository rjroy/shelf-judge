import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RedundancyStatus } from "@/components/redundancy-status";

describe("redundancy status", () => {
  test("shows ready and stale independently of neighbor adjustment", () => {
    const ready = renderToStaticMarkup(
      <RedundancyStatus info={{ status: "ready", generationId: "g1" }} noNeighbor />,
    );
    expect(ready).toContain("Semantic similarity ready");
    expect(ready).toContain("No qualifying neighbor");
    const stale = renderToStaticMarkup(
      <RedundancyStatus info={{ status: "stale", generationId: "g1" }} />,
    );
    expect(stale).toContain("stale; factual-only comparison");
    expect(stale).toContain('role="status"');
  });
});
