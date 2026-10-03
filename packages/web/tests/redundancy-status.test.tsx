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

  test("explains partial semantic coverage without implying factual-only scoring", () => {
    const partial = renderToStaticMarkup(
      <RedundancyStatus info={{ status: "partial", generationId: "g1" }} />,
    );
    expect(partial).toContain("Partial semantic coverage; available results are used");
    expect(partial).not.toContain("factual-only");
  });

  test("describes not-ready semantic status without assuming factual signals are enabled", () => {
    const notReady = renderToStaticMarkup(
      <RedundancyStatus info={{ status: "not-ready", generationId: null }} />,
    );
    expect(notReady).toContain("Semantic similarity is not ready");
    expect(notReady).not.toContain("factual-only");
  });
});
