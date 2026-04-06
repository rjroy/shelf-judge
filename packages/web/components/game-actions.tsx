"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GameActions({
  gameId,
  gameName,
  hasBggId,
}: {
  gameId: string;
  gameName: string;
  hasBggId: boolean;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState(false);
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
      <button
        className="btn btn-danger-outline"
        onClick={() => {
          void handleRemove();
        }}
        disabled={removing}
      >
        {removing ? "Removing..." : "Remove"}
      </button>
    </div>
  );
}
