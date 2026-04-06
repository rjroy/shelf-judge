"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshAllButton() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<{ message: string; isError: boolean } | null>(null);

  async function handleRefresh() {
    if (!confirm("Refresh BGG data for all games in your collection?")) return;

    setRefreshing(true);
    setResult(null);
    try {
      const res = await fetch("/api/daemon/games/refresh", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      const data = await res.json();
      const message = `Refreshed ${data.refreshed} game(s)${data.errors?.length ? `, ${data.errors.length} error(s)` : ""}`;
      setResult({ message, isError: false });
      router.refresh();
    } catch (err) {
      setResult({
        message: err instanceof Error ? err.message : "Failed to refresh",
        isError: true,
      });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "end" }}>
      <button className="btn btn-secondary" onClick={handleRefresh} disabled={refreshing}>
        {refreshing ? "Refreshing..." : "Refresh All BGG"}
      </button>
      {result && (
        <span
          style={{
            fontSize: 12,
            color: result.isError ? "var(--danger)" : "var(--text-muted)",
            marginTop: 4,
          }}
        >
          {result.message}
        </span>
      )}
    </div>
  );
}
