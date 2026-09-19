import { describe, expect, test } from "bun:test";

describe("profile unavailable state", () => {
  test("keeps owner-facing recovery visible and hides diagnostics until requested", async () => {
    const unavailable = await Bun.file(
      new URL("../components/profile/profile-unavailable.tsx", import.meta.url),
    ).text();

    expect(unavailable).toContain("Shelf Judge cannot reach its local service right now.");
    expect(unavailable).toContain("Check that the Shelf Judge daemon is running, then retry.");
    expect(unavailable).toContain("Retry profile");
    expect(unavailable).toContain("<details>");
    expect(unavailable).toContain("Technical details");
    expect(unavailable).toContain("<pre>{message}</pre>");
  });

  test("does not render the raw failure in the default unavailable UI", async () => {
    const page = await Bun.file(new URL("../app/page.tsx", import.meta.url)).text();

    expect(page).not.toContain(">{unavailable}<");
    expect(page).toContain("Check that the Shelf Judge daemon is running, then retry.");
  });
});
