"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OwnershipStatus } from "@shelf-judge/shared";

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

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/daemon/games/${gameId}/refresh`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="topbar-actions">
      {error && <span className="error-banner">{error}</span>}
      {hasBggId && (
        <button
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

export function OwnershipActions({
  gameId,
  gameName,
  ownership,
}: {
  gameId: string;
  gameName: string;
  ownership: OwnershipStatus;
}) {
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPreviouslyOwned = ownership === "previously-owned";

  async function handleToggleOwnership() {
    const newStatus: OwnershipStatus = isPreviouslyOwned ? "owned" : "previously-owned";
    setToggling(true);
    setError(null);
    try {
      const res = await fetch(`/api/daemon/games/${gameId}/ownership`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownership: newStatus }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update ownership");
    } finally {
      setToggling(false);
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove "${gameName}" from your collection? This cannot be undone.`)) {
      return;
    }
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/daemon/games/${gameId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove game");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="action-section">
      {error && <div className="error-banner">{error}</div>}
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
              Sold or traded this game? Keeps all ratings and history — you can reverse this any
              time. Removes it from niche and redundancy calculations.
            </div>
          </>
        )}
      </div>

      <div className="action-sep" />

      <div className="danger-zone">
        <div className="danger-zone-label">Danger Zone</div>
        <div className="danger-desc">
          Permanently removes all ratings, history, and data. This cannot be undone.
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
