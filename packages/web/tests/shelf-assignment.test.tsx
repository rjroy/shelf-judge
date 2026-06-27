import { beforeAll, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssignmentConflict, ShelfAssignment } from "@shelf-judge/shared";

const refresh = mock(() => undefined);

void mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

let ShelfAssignmentFields: typeof import("../components/shelf-assignment-form").ShelfAssignmentFields;
let saveShelfAssignment: typeof import("../components/shelf-assignment-form").saveShelfAssignment;
let ShelfAssignmentCard: typeof import("../app/capacity/page").ShelfAssignmentCard;
let AssignmentConflictTable: typeof import("../app/capacity/page").AssignmentConflictTable;

beforeAll(async () => {
  ({ ShelfAssignmentFields, saveShelfAssignment } =
    await import("../components/shelf-assignment-form"));
  ({ ShelfAssignmentCard, AssignmentConflictTable } = await import("../app/capacity/page"));
});

const options = [
  { shelfId: "shelf-a", label: "Living Room — Upper" },
  { shelfId: "shelf-b", label: "Office — Lower" },
];

function renderFields(
  overrides: Partial<Parameters<typeof ShelfAssignmentFields>[0]> = {},
): string {
  return renderToStaticMarkup(
    <ShelfAssignmentFields
      selectedShelfId="shelf-b"
      options={options}
      hasDimensions
      isPreviouslyOwned={false}
      {...overrides}
    />,
  );
}

describe("ShelfAssignmentForm", () => {
  test("renders unit-qualified labels and the saved selection", () => {
    const html = renderFields();
    expect(html).toContain("Living Room — Upper");
    expect(html).toContain("Office — Lower");
    expect(html).toContain('<option value="shelf-b" selected="">');
    expect(html).toContain("Automatic (fill shelves)");
  });

  test("automatic selection sends null and refreshes after success", async () => {
    const request = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    const refreshAfterSave = mock(() => undefined);

    await saveShelfAssignment("game-1", "", refreshAfterSave, request);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe("/api/daemon/games/game-1/shelf-assignment");
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ shelfId: null }),
    });
    expect(refreshAfterSave).toHaveBeenCalledTimes(1);
  });

  test("does not refresh and exposes the daemon error for rendering", async () => {
    const request = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Shelf no longer exists" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const refreshAfterSave = mock(() => undefined);

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test rejects matcher is awaitable at runtime
    await expect(
      saveShelfAssignment("game-1", "shelf-a", refreshAfterSave, request),
    ).rejects.toThrow("Shelf no longer exists");
    expect(refreshAfterSave).not.toHaveBeenCalled();
    const html = renderFields({ error: "Shelf no longer exists" });
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Shelf no longer exists");
    expect(html).toContain(
      'aria-describedby="shelf-assignment-description shelf-assignment-error"',
    );
  });

  test("blocks manual options but allows Automatic when dimensions are missing", () => {
    const html = renderFields({ hasDimensions: false, selectedShelfId: "" });
    expect(html).not.toContain('<select class="shelf-assignment-select" disabled="">');
    expect(html).toContain('<option value="shelf-a" disabled="">');
    expect(html).toContain("Box dimensions are required before a shelf can be assigned.");
    expect(html).not.toContain('<button class="btn-primary" disabled="">');
  });

  test("blocks manual options but allows Automatic for previously owned games", () => {
    const html = renderFields({ isPreviouslyOwned: true, selectedShelfId: "" });
    expect(html).not.toContain('<select class="shelf-assignment-select" disabled="">');
    expect(html).toContain('<option value="shelf-a" disabled="">');
    expect(html).toContain("Previously owned games cannot be assigned to a physical shelf.");
  });
});

describe("capacity assignment explanations", () => {
  test("renders a manual marker only for manual placements", () => {
    const assignment: ShelfAssignment = {
      shelfId: "shelf-a",
      shelfName: "Upper",
      unitId: "unit-a",
      unitName: "Living Room",
      capacityIn3: 1000,
      usedIn3: 200,
      utilization: 0.2,
      grade: "A",
      games: [
        {
          gameId: "manual-game",
          gameName: "Pinned Game",
          fitnessScore: 8,
          volumeIn3: 100,
          assignmentSource: "manual",
        },
        {
          gameId: "automatic-game",
          gameName: "Packed Game",
          fitnessScore: 7,
          volumeIn3: 100,
          assignmentSource: "automatic",
        },
      ],
    };

    const html = renderToStaticMarkup(<ShelfAssignmentCard assignment={assignment} />);
    expect(html).toContain('href="/games/manual-game"');
    expect(html).toContain('<span class="manual-assignment-badge">Manual</span>');
    expect(html.match(/manual-assignment-badge/g)).toHaveLength(1);
  });

  test("renders conflict game link, shelf context, dimensions, and reason", () => {
    const conflict: AssignmentConflict = {
      gameId: "game-1",
      gameName: "Too Tall",
      shelfId: "shelf-a",
      shelfName: "Upper",
      unitId: "unit-a",
      unitName: "Living Room",
      boxDimensions: { width: 10, height: 14, depth: 3 },
      reason: "Box is too tall for the selected shelf",
    };

    const html = renderToStaticMarkup(<AssignmentConflictTable entries={[conflict]} />);
    expect(html).toContain('href="/games/game-1"');
    expect(html).toContain("Upper");
    expect(html).toContain("Living Room");
    expect(html).toContain("10 × 14 × 3 in");
    expect(html).toContain("Box is too tall for the selected shelf");
  });
});
