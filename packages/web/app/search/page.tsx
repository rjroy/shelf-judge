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
        const res = await fetch(`/api/daemon/games/search?q=${encodeURIComponent(query)}`);
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
    <>
      <div className="topbar">
        <div className="topbar-title">Add Game</div>
      </div>

      <div className="main-scroll">
        <div className="search-content">
          {/* Search input */}
          <div className="search-input-row">
            <input
              className="form-input search-input-flex"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search BoardGameGeek..."
            />
            {searching && <span className="search-status">Searching...</span>}
          </div>

          {error && <div className="error-banner">{error}</div>}

          {/* Results list */}
          {results.length > 0 && (
            <div className="search-results">
              {results.map((r) => (
                <div key={r.bggId} className="search-result-row">
                  <div className="search-result-info">
                    <div className="search-result-name">{r.name}</div>
                    {r.yearPublished && <div className="search-result-year">{r.yearPublished}</div>}
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleAddBgg(r.bggId)}
                    disabled={adding === r.bggId}
                  >
                    {adding === r.bggId ? "Adding..." : "Add"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Manual add section */}
          <div className="manual-section">
            <button className="btn btn-ghost" onClick={() => setShowManual(!showManual)}>
              {showManual ? "Hide manual entry" : "Add a game manually (not on BGG)"}
            </button>

            {showManual && (
              <div className="manual-add-card manual-add-card-mt">
                <form onSubmit={handleAddManual}>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Game Name</label>
                      <input
                        className="form-input"
                        type="text"
                        value={manualName}
                        onChange={(e) => setManualName(e.target.value)}
                        placeholder="Game name"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Year (optional)</label>
                      <input
                        className="form-input"
                        type="number"
                        value={manualYear}
                        onChange={(e) => setManualYear(e.target.value)}
                        placeholder="Year published"
                      />
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">
                      Add Game
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
