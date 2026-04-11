"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type {
  PredictedGameResponse,
  FitnessBreakdownEntry,
  PredictionConfidence,
} from "@shelf-judge/shared";

interface BggSearchResult {
  bggId: number;
  name: string;
  yearPublished: number | null;
  thumbnailUrl: string | null;
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: PredictedGameResponse };

function confidenceBadge(confidence: PredictionConfidence): string {
  switch (confidence) {
    case "actual":
      return "actual";
    case "strong":
      return "strong";
    case "moderate":
      return "moderate";
    case "weak":
      return "weak";
    case "insufficient":
      return "insufficient";
  }
}

function PreviewPanel({ data }: { data: PredictedGameResponse }) {
  const { game, score, tension, predictionUnavailable } = data;

  if (predictionUnavailable) {
    return (
      <div className="preview-panel">
        <div className="preview-unavailable">
          Predictions unavailable: need {predictionUnavailable.gamesNeeded} more rated game
          {predictionUnavailable.gamesNeeded !== 1 ? "s" : ""} to reach Stage 1. Currently at{" "}
          {predictionUnavailable.ratedGameCount} rated game
          {predictionUnavailable.ratedGameCount !== 1 ? "s" : ""}.
        </div>
        {score && (
          <div className="preview-score-line">
            BGG-derived score: <strong>{score.score.toFixed(1)}</strong>
          </div>
        )}
      </div>
    );
  }

  // Check if game is already in collection (non-preview ID)
  const isInCollection = !game.id.startsWith("preview-");

  return (
    <div className="preview-panel">
      {isInCollection && (
        <div className="preview-in-collection">
          Already in collection.{" "}
          <a href={`/games/${game.id}`} className="preview-link">
            View details
          </a>
        </div>
      )}

      <div className="preview-score-line">
        Predicted Fitness: <strong>{score.vetoed ? "VETOED" : score.score.toFixed(1)}</strong>
        {score.predictionMeta && (
          <span className={`confidence-badge confidence-${score.predictionMeta.confidence}`}>
            {confidenceBadge(score.predictionMeta.confidence)}
          </span>
        )}
      </div>

      {score.predictionMeta && (
        <div className="preview-meta">
          Stage {score.predictionMeta.readinessStage} &middot;{" "}
          {score.predictionMeta.predictedAxisCount} predicted,{" "}
          {score.predictionMeta.actualAxisCount} actual &middot;{" "}
          {(score.predictionMeta.coveragePercent * 100).toFixed(0)}% coverage
        </div>
      )}

      {tension && (
        <div className="preview-tension">
          Tension: predicted {tension.predictedFitness.toFixed(1)} vs tournament cluster{" "}
          {tension.tournamentClusterAverage.toFixed(1)}
        </div>
      )}

      {score.breakdown && score.breakdown.length > 0 && (
        <div className="preview-breakdown">
          {score.breakdown
            .filter((e: FitnessBreakdownEntry) => e.rating !== null)
            .map((e: FitnessBreakdownEntry) => (
              <div key={e.axisId} className="preview-breakdown-row">
                <span className="preview-axis-name">{e.axisName}</span>
                <span className="preview-axis-rating">
                  {e.rating !== null ? e.rating.toFixed(1) : "-"}
                </span>
                {e.predictionConfidence && (
                  <span
                    className={`confidence-badge confidence-badge-sm confidence-${e.predictionConfidence}`}
                  >
                    {e.predictionConfidence}
                  </span>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
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
  const [previews, setPreviews] = useState<Record<number, PreviewState>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      void (async () => {
        setSearching(true);
        setError(null);
        try {
          const res = await fetch(`/api/daemon/games/search?q=${encodeURIComponent(query)}`);
          if (!res.ok) {
            const data = (await res.json().catch(() => ({ error: "Search failed" }))) as {
              error?: string;
            };
            throw new Error(data.error ?? `Search failed: ${res.status}`);
          }
          setResults((await res.json()) as BggSearchResult[]);
          setPreviews({});
        } catch (err) {
          setError(err instanceof Error ? err.message : "Search failed");
          setResults([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 400);
  }, [query]);

  async function handlePreview(bggId: number) {
    const current = previews[bggId];
    if (current?.status === "loaded" || current?.status === "loading") {
      // Toggle off if already loaded, skip if loading
      if (current.status === "loaded") {
        setPreviews((prev) => {
          const next = { ...prev };
          delete next[bggId];
          return next;
        });
      }
      return;
    }

    setPreviews((prev) => ({ ...prev, [bggId]: { status: "loading" } }));

    try {
      const res = await fetch(`/api/daemon/predictions/bgg/${bggId}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Preview failed" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Preview failed: ${res.status}`);
      }
      const prediction = (await res.json()) as PredictedGameResponse;
      setPreviews((prev) => ({ ...prev, [bggId]: { status: "loaded", data: prediction } }));
    } catch (err) {
      setPreviews((prev) => ({
        ...prev,
        [bggId]: {
          status: "error",
          message: err instanceof Error ? err.message : "Preview failed",
        },
      }));
    }
  }

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
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "This game is already in your collection");
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      const { game } = (await res.json()) as { game: { id: string } };
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
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      const { game } = (await res.json()) as { game: { id: string } };
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
              {results.map((r) => {
                const preview = previews[r.bggId];
                return (
                  <div key={r.bggId} className="search-result-item">
                    <div className="search-result-row">
                      <div className="search-result-thumb">
                        {r.thumbnailUrl ? (
                          <img src={r.thumbnailUrl} alt={r.name} />
                        ) : (
                          <span className="search-result-thumb-placeholder"></span>
                        )}
                      </div>
                      <div className="search-result-info">
                        <div className="search-result-name">{r.name}</div>
                        {r.yearPublished && (
                          <div className="search-result-year">{r.yearPublished}</div>
                        )}
                      </div>
                      <div className="search-result-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            void handlePreview(r.bggId);
                          }}
                          disabled={preview?.status === "loading"}
                        >
                          {preview?.status === "loading"
                            ? "Loading..."
                            : preview?.status === "loaded"
                              ? "Hide Preview"
                              : "Preview"}
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            void handleAddBgg(r.bggId);
                          }}
                          disabled={adding === r.bggId}
                        >
                          {adding === r.bggId ? "Adding..." : "Add"}
                        </button>
                      </div>
                    </div>

                    {preview?.status === "loading" && (
                      <div className="preview-panel preview-loading">Loading prediction...</div>
                    )}

                    {preview?.status === "error" && (
                      <div className="preview-panel preview-error">{preview.message}</div>
                    )}

                    {preview?.status === "loaded" && <PreviewPanel data={preview.data} />}
                  </div>
                );
              })}
            </div>
          )}

          {/* Manual add section */}
          <div className="manual-section">
            <button className="btn btn-ghost" onClick={() => setShowManual(!showManual)}>
              {showManual ? "Hide manual entry" : "Add a game manually (not on BGG)"}
            </button>

            {showManual && (
              <div className="manual-add-card manual-add-card-mt">
                <form
                  onSubmit={(e) => {
                    void handleAddManual(e);
                  }}
                >
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
