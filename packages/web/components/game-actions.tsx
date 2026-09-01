"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OwnershipStatus, PlayIntention } from "@shelf-judge/shared";
import { changeOwnership, refreshGameBgg, removeGameFromCollection } from "@/lib/browser-mutations";
import { useOwnerGameNoteState } from "@/components/owner-game-note-editor";

export function GameActions({
  gameId,
  hasBggId,
}: {
  gameId: string;
  gameName: string;
  hasBggId: boolean;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const generation = useRef(0);
  const statusRef = useRef<HTMLDivElement>(null);

  async function handleRefresh() {
    const requestGeneration = ++generation.current;
    setRefreshing(true);
    setError(null);
    try {
      const result = await refreshGameBgg(gameId);
      if (requestGeneration !== generation.current) return;
      setAnnouncement(
        result.linkedIntentionTransition === null
          ? "BGG data refreshed."
          : "BGG data refreshed and the active intention completed automatically.",
      );
      statusRef.current?.focus();
      router.refresh();
    } catch (err) {
      if (requestGeneration !== generation.current) return;
      setError(err instanceof Error ? err.message : "Failed to refresh");
      statusRef.current?.focus();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="topbar-actions">
      <div ref={statusRef} tabIndex={-1} aria-live="polite" className="action-live-status">
        {announcement}
      </div>
      {error && (
        <span className="error-banner" role="alert">
          {error}
        </span>
      )}
      {hasBggId && (
        <button
          id="bgg-refresh"
          className="btn btn-secondary"
          onClick={() => {
            void handleRefresh();
          }}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "↺ Refresh BGG"}
        </button>
      )}
    </div>
  );
}

export function OwnershipMutationNotice({
  ownership,
  linkedIntentionTransition,
}: {
  ownership: OwnershipStatus;
  linkedIntentionTransition: PlayIntention | null;
}) {
  return <>{ownershipMutationMessage(ownership, linkedIntentionTransition)}</>;
}

function ownershipMutationMessage(
  ownership: OwnershipStatus,
  linkedIntentionTransition: PlayIntention | null,
): string {
  return linkedIntentionTransition === null
    ? `Ownership changed to ${ownership}.`
    : `Ownership changed to previously owned. Active intention ${linkedIntentionTransition.intentionId} was retired in the same update.`;
}

export function DeletionHistoryConflict({ intentionIds }: { intentionIds: string[] }) {
  return (
    <div className="history-conflict-guidance" role="status">
      <strong>History retained:</strong> Intention IDs {intentionIds.join(", ")} protect this
      game&apos;s history. Retire any active intention, then use <em>Previously Owned</em> status
      instead. Shelf Judge does not offer deletion of intention history.
    </div>
  );
}

export function OwnershipActions({
  gameId,
  gameName,
  ownership,
}: {
  gameId: string;
  gameName: string;
  ownership: OwnershipStatus;
}) {
  const { note: ownerNote } = useOwnerGameNoteState();
  const hasOwnerNoteContent = ownerNote.state === "present";
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [historyConflict, setHistoryConflict] = useState<string[] | null>(null);
  const generation = useRef(0);
  const statusRef = useRef<HTMLDivElement>(null);

  const isPreviouslyOwned = ownership === "previously-owned";

  async function handleToggleOwnership() {
    const requestGeneration = ++generation.current;
    const newStatus: OwnershipStatus = isPreviouslyOwned ? "owned" : "previously-owned";
    setToggling(true);
    setError(null);
    try {
      const result = await changeOwnership(gameId, newStatus);
      if (requestGeneration !== generation.current) return;
      setAnnouncement(ownershipMutationMessage(newStatus, result.linkedIntentionTransition));
      statusRef.current?.focus();
      router.refresh();
    } catch (err) {
      if (requestGeneration !== generation.current) return;
      setError(err instanceof Error ? err.message : "Failed to update ownership");
      statusRef.current?.focus();
    } finally {
      setToggling(false);
    }
  }

  async function handleRemove() {
    if (!confirm(permanentDeletionConfirmation(gameName, hasOwnerNoteContent))) {
      return;
    }
    const requestGeneration = ++generation.current;
    setRemoving(true);
    setError(null);
    try {
      const result = await removeGameFromCollection(gameId);
      if (requestGeneration !== generation.current) return;
      if (!result.ok) {
        if (result.error.code !== "history-conflict") {
          throw new Error("Game removal was rejected.");
        }
        setHistoryConflict(result.error.intentionIds);
        setError("Permanent deletion is blocked because this game has play-intention history.");
        statusRef.current?.focus();
        return;
      }
      router.push("/");
    } catch (err) {
      if (requestGeneration !== generation.current) return;
      setError(err instanceof Error ? err.message : "Failed to remove game");
      statusRef.current?.focus();
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="action-section">
      <div ref={statusRef} tabIndex={-1} aria-live="polite" className="action-live-status">
        {announcement}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {historyConflict !== null && <DeletionHistoryConflict intentionIds={historyConflict} />}
      <div className="action-group-label">Ownership</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {isPreviouslyOwned ? (
          <>
            <button
              className="btn btn-success"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => {
                void handleToggleOwnership();
              }}
              disabled={toggling}
            >
              {toggling ? "Updating..." : "✓ Mark as Owned"}
            </button>
            <div className="action-desc">
              Reacquired this game? Marking it as owned restores it to your active shelf — niche and
              redundancy will update automatically.
            </div>
          </>
        ) : (
          <>
            <button
              className="btn btn-secondary"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => {
                void handleToggleOwnership();
              }}
              disabled={toggling}
            >
              {toggling ? "Updating..." : "Mark as Previously Owned"}
            </button>
            <div className="action-desc">
              Sold or traded this game? Keeps all ratings, history, and the Owner note. You can
              reverse this any time. Removes it from niche and redundancy calculations.
            </div>
          </>
        )}
      </div>

      <div className="action-sep" />

      <div className="danger-zone">
        <div className="danger-zone-label">Danger Zone</div>
        <div className="danger-desc">
          <OwnerNoteDeletionDisclosure />
        </div>
        <button
          className="btn btn-danger-outline"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={() => {
            void handleRemove();
          }}
          disabled={removing}
        >
          {removing ? "Removing..." : "Remove from Collection"}
        </button>
      </div>
    </div>
  );
}

export function permanentDeletionDisclosure(hasOwnerNoteContent: boolean): string {
  return hasOwnerNoteContent
    ? "Permanently removes all ratings, history, data, and the current Owner note. The note cannot be restored by Shelf Judge."
    : "Permanently removes all ratings, history, and data. This cannot be undone.";
}

export function OwnerNoteDeletionDisclosure() {
  const { note } = useOwnerGameNoteState();
  return <>{permanentDeletionDisclosure(note.state === "present")}</>;
}

export function permanentDeletionConfirmation(
  gameName: string,
  hasOwnerNoteContent: boolean,
): string {
  const noteWarning = hasOwnerNoteContent
    ? " Its Owner note will also be deleted and cannot be restored by Shelf Judge."
    : "";
  return `Remove "${gameName}" from your collection? This cannot be undone.${noteWarning}`;
}
