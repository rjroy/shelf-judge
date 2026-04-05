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
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
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
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
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
    <div>
      {error && <p style={{ color: "#c00", marginBottom: 8 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        {hasBggId && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              padding: "8px 16px",
              backgroundColor: refreshing ? "#999" : "#059669",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: refreshing ? "default" : "pointer",
              fontSize: 14,
            }}
          >
            {refreshing ? "Refreshing..." : "Refresh BGG Data"}
          </button>
        )}
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            padding: "8px 16px",
            backgroundColor: removing ? "#999" : "#dc2626",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: removing ? "default" : "pointer",
            fontSize: 14,
          }}
        >
          {removing ? "Removing..." : "Remove Game"}
        </button>
      </div>
    </div>
  );
}
