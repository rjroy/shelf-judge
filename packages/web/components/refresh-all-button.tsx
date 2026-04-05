"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshAllButton() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

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
      setResult(`Refreshed ${data.refreshed} game(s)${data.errors?.length ? `, ${data.errors.length} error(s)` : ""}`);
      router.refresh();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "end" }}>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        style={{
          padding: "8px 16px",
          backgroundColor: refreshing ? "#999" : "#7c3aed",
          color: "white",
          border: "none",
          borderRadius: 4,
          cursor: refreshing ? "default" : "pointer",
          fontSize: 14,
          textDecoration: "none",
        }}
      >
        {refreshing ? "Refreshing..." : "Refresh All BGG"}
      </button>
      {result && (
        <span style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{result}</span>
      )}
    </div>
  );
}
