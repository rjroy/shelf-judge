import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OwnerNoteDeletionDisclosure,
  permanentDeletionConfirmation,
  permanentDeletionDisclosure,
} from "@/components/game-actions";
import { OwnerGameNoteStateProvider } from "@/components/owner-game-note-editor";

describe("game permanent deletion disclosure", () => {
  test("discloses irreversible deletion only for current note content", () => {
    expect(permanentDeletionDisclosure(true)).toContain("current Owner note");
    expect(permanentDeletionDisclosure(true)).toContain("cannot be restored by Shelf Judge");
    expect(permanentDeletionConfirmation("A Game", true)).toContain(
      "Its Owner note will also be deleted",
    );

    expect(permanentDeletionDisclosure(false)).not.toContain("Owner note");
    expect(permanentDeletionConfirmation("A Game", false)).not.toContain("Owner note");
  });

  test("derives visible disclosure from the shared current editor state", () => {
    const html = renderToStaticMarkup(
      <OwnerGameNoteStateProvider
        initialNote={{
          state: "present",
          version: 1,
          updatedAt: "2026-08-30T12:00:00.000Z",
          text: "Current note",
        }}
      >
        <OwnerNoteDeletionDisclosure />
      </OwnerGameNoteStateProvider>,
    );
    expect(html).toContain("current Owner note");
    expect(html).toContain("cannot be restored by Shelf Judge");
  });
});
