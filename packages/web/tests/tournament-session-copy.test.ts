import { expect, test } from "bun:test";

test("tournament session does not claim count-based pair prioritization", async () => {
  const source = await Bun.file("packages/web/app/tournament/session/page.tsx").text();

  expect(source).not.toContain("Comparing games with fewer comparisons first");
});
