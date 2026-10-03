import { describe, expect, test } from "bun:test";

describe("candidate redundancy provenance", () => {
  test("labels search previews factual-only and owner-note comparison unavailable", async () => {
    const source = await Bun.file(new URL("../app/search/page.tsx", import.meta.url)).text();
    expect(source).toContain("Factual-only candidate preview.");
    expect(source).toContain("Owner-note comparison is unavailable for candidates.");
  });
});
