"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface BggSearchResult {
  bggId: number;
  name: string;
  yearPublished: number | null;
}

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BggSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualYear, setManualYear] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/daemon/games/search?q=${encodeURIComponent(query)}`
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Search failed" }));
          throw new Error(data.error ?? `Search failed: ${res.status}`);
        }
        setResults(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [query]);

  async function handleAddBgg(bggId: number) {
    setAdding(bggId);
    setError(null);
    try {
      const res = await fetch("/api/daemon/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bggId }),
      });
      if (res.status === 409) {
        const data = await res.json();
        throw new Error(data.error ?? "This game is already in your collection");
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      const { game } = await res.json();
      router.push(`/games/${game.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add game");
    } finally {
      setAdding(null);
    }
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manualName.trim()) return;

    setError(null);
    try {
      const body: { name: string; yearPublished?: number } = {
        name: manualName.trim(),
      };
      if (manualYear) {
        body.yearPublished = parseInt(manualYear, 10);
      }

      const res = await fetch("/api/daemon/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      const { game } = await res.json();
      router.push(`/games/${game.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add game");
    }
  }

  return (
    <div>
      <h1>Add Game</h1>

      <div style={{ marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search BoardGameGeek..."
          style={{
            width: "100%",
            maxWidth: 400,
            padding: "8px 12px",
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 14,
          }}
        />
        {searching && (
          <span style={{ marginLeft: 8, color: "#666", fontSize: 13 }}>
            Searching...
          </span>
        )}
      </div>

      {error && <p style={{ color: "#c00", marginBottom: 12 }}>{error}</p>}

      {results.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}>
              <th style={{ padding: "6px 10px" }}>Game</th>
              <th style={{ padding: "6px 10px" }}>Year</th>
              <th style={{ padding: "6px 10px" }}></th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.bggId} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 10px" }}>{r.name}</td>
                <td style={{ padding: "6px 10px", color: "#666" }}>
                  {r.yearPublished ?? ""}
                </td>
                <td style={{ padding: "6px 10px" }}>
                  <button
                    onClick={() => handleAddBgg(r.bggId)}
                    disabled={adding === r.bggId}
                    style={{
                      padding: "4px 12px",
                      backgroundColor: adding === r.bggId ? "#999" : "#2563eb",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      cursor: adding === r.bggId ? "default" : "pointer",
                      fontSize: 13,
                    }}
                  >
                    {adding === r.bggId ? "Adding..." : "Add"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: 16 }}>
        <button
          onClick={() => setShowManual(!showManual)}
          style={{
            background: "none",
            border: "none",
            color: "#2563eb",
            cursor: "pointer",
            fontSize: 14,
            padding: 0,
          }}
        >
          {showManual ? "Hide manual entry" : "Add a game manually (not on BGG)"}
        </button>

        {showManual && (
          <form onSubmit={handleAddManual} style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Game name"
                required
                style={{
                  padding: "8px 12px",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                  fontSize: 14,
                  marginRight: 8,
                }}
              />
              <input
                type="number"
                value={manualYear}
                onChange={(e) => setManualYear(e.target.value)}
                placeholder="Year (optional)"
                style={{
                  padding: "8px 12px",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                  fontSize: 14,
                  width: 140,
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                padding: "8px 16px",
                backgroundColor: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Add Game
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
