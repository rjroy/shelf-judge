import { describe, expect, test } from "bun:test";

const FORM_PATH = "packages/web/components/shelf-assignment-form.tsx";
const GAME_PAGE_PATH = "packages/web/app/games/[id]/page.tsx";
const CAPACITY_PAGE_PATH = "packages/web/app/capacity/page.tsx";
const INDICATOR_PATH = "packages/web/components/capacity-indicator.tsx";

describe("ShelfAssignmentForm wiring", () => {
  test("offers automatic clearing and preserves the saved selection", async () => {
    const source = await Bun.file(FORM_PATH).text();
    expect(source).toContain('useState(currentShelfId ?? "")');
    expect(source).toContain('option value="">Automatic (fill shelves)</option>');
    expect(source).toContain('shelfId: selectedShelfId === "" ? null : selectedShelfId');
  });

  test("sends the assignment request and refreshes server data", async () => {
    const source = await Bun.file(FORM_PATH).text();
    expect(source).toContain("`/api/daemon/games/${gameId}/shelf-assignment`");
    expect(source).toContain('method: "PUT"');
    expect(source).toContain("router.refresh()");
  });

  test("renders mutation errors and disables manual options for preconditions", async () => {
    const source = await Bun.file(FORM_PATH).text();
    expect(source).toContain("data.error");
    expect(source).toContain("disabled={manualDisabled}");
    expect(source).toContain("Box dimensions are required before a shelf can be assigned.");
    expect(source).toContain("Previously owned games cannot be assigned");
  });
});

describe("game detail shelf options", () => {
  test("flattens shelves into unit-qualified option labels", async () => {
    const source = await Bun.file(GAME_PAGE_PATH).text();
    expect(source).toContain("shelfConfig?.units.flatMap");
    expect(source).toContain("label: `${unit.name} — ${shelf.name}`");
    expect(source).toContain("currentShelfId={game.manualShelfId}");
  });
});

describe("capacity assignment explanations", () => {
  test("labels manual placements and renders actionable conflict details", async () => {
    const source = await Bun.file(CAPACITY_PAGE_PATH).text();
    expect(source).toContain('game.assignmentSource === "manual"');
    expect(source).toContain("Manual Assignment Conflicts");
    expect(source).toContain("entry.unitName");
    expect(source).toContain("entry.boxDimensions.width");
    expect(source).toContain("href={`/games/${entry.gameId}`}");
  });

  test("capacity indicator counts conflicts separately from displaced overflow", async () => {
    const source = await Bun.file(INDICATOR_PATH).text();
    expect(source).toContain("capacity.assignmentConflicts.length");
    expect(source).toContain("manual shelf assignment needs attention");
    expect(source).toContain("Resolve conflicts");
  });
});
