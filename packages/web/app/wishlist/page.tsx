"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  WishlistEntry,
  WishlistBreakdownEntry,
  PredictionConfidence,
  NicheImpact,
  NicheImpactEntry,
} from "@shelf-judge/shared";
import { relativeDate } from "@/lib/date-utils";

type SortField = "addedAt" | "predictedScore" | "name";

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "addedAt", label: "Date Added" },
  { value: "predictedScore", label: "Predicted Score" },
  { value: "name", label: "Name" },
];

function sortEntries(entries: WishlistEntry[], field: SortField): WishlistEntry[] {
  const sorted = [...entries];
  switch (field) {
    case "addedAt":
      sorted.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
      break;
    case "predictedScore":
      sorted.sort((a, b) => {
        if (a.predictedScore === null && b.predictedScore === null) return 0;
        if (a.predictedScore === null) return 1;
        if (b.predictedScore === null) return -1;
        return b.predictedScore - a.predictedScore;
      });
      break;
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function ConfidenceBadge({ confidence }: { confidence: PredictionConfidence }) {
  return <span className={`confidence-badge confidence-${confidence}`}>{confidence}</span>;
}

function ConfBadgeSm({ confidence }: { confidence: PredictionConfidence }) {
  return <span className={`conf-badge-sm ${confidence}`}>{confidence}</span>;
}

function NicheImpactPanel({ nicheImpact }: { nicheImpact: NicheImpact }) {
  if (!nicheImpact.wouldJoin || nicheImpact.wouldJoin.length === 0) return null;

  return (
    <div className="wc-niche">
      <div className="wc-niche-inner">
        <div className="wc-niche-title">Niche Impact</div>
        {nicheImpact.wouldJoin.map((entry: NicheImpactEntry) => (
          <div key={`${entry.type}:${entry.name}`} className="wc-niche-entry">
            <span className={`niche-type-badge niche-type-${entry.type}`}>{entry.type}</span>
            {entry.currentSize === 0 ? (
              <>
                Would be your 1st <strong>{entry.name}</strong> game
              </>
            ) : entry.projectedRank === 1 ? (
              <>
                Would be your best <strong>{entry.name}</strong> game
              </>
            ) : (
              <>
                Would be your {ordinal(entry.currentSize + 1)} <strong>{entry.name}</strong> game,
                ranked #{entry.projectedRank}
              </>
            )}
            {entry.currentChampion && (
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 6,
                  borderTop: "1px solid var(--niche-border)",
                  color: "var(--niche-accent)",
                  fontSize: 11,
                }}
              >
                Current best: {entry.currentChampion.gameName} (
                {entry.currentChampion.fitnessScore.toFixed(1)})
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WishlistCard({
  entry,
  onRemove,
  onRefresh,
  onAddToCollection,
}: {
  entry: WishlistEntry;
  onRemove: (id: string) => void;
  onRefresh: (id: string) => Promise<void>;
  onAddToCollection: (entry: WishlistEntry) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [addingToCollection, setAddingToCollection] = useState(false);

  const hasBreakdown = entry.predictedBreakdown && entry.predictedBreakdown.length > 0;
  const hasPrediction = entry.predictedScore !== null;

  return (
    <div className="wishlist-card">
      <div className="wc-main">
        <div className="wc-thumb">
          {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt={entry.name} /> : null}
        </div>

        <div className="wc-info">
          <div className="wc-name">{entry.name}</div>
          {entry.yearPublished && <div className="wc-year">{entry.yearPublished}</div>}
          <div className="wc-score-row">
            {hasPrediction ? (
              <>
                <span className="wc-score-prefix">~</span>
                <span className="wc-score">{entry.predictedScore!.toFixed(1)}</span>
                {entry.predictionConfidence && (
                  <ConfidenceBadge confidence={entry.predictionConfidence} />
                )}
              </>
            ) : (
              <span className="wc-no-prediction">
                No prediction — not enough rated games at time of save
              </span>
            )}
          </div>
          <div className="wc-added">
            Added {relativeDate(entry.addedAt)}
            {!hasPrediction && (
              <>
                {" "}
                &middot;{" "}
                <button
                  className="wishlist-refresh-link"
                  onClick={() => {
                    setRefreshing(true);
                    void onRefresh(entry.id).finally(() => setRefreshing(false));
                  }}
                >
                  Refresh to check again
                </button>
              </>
            )}
          </div>
        </div>

        <div className="wc-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setAddingToCollection(true);
              void onAddToCollection(entry).finally(() => setAddingToCollection(false));
            }}
            disabled={addingToCollection}
          >
            {addingToCollection ? "Adding..." : "Add to Collection"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setRefreshing(true);
              void onRefresh(entry.id).finally(() => setRefreshing(false));
            }}
            disabled={refreshing}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.65 2.35A8 8 0 102 13.65M13.65 2.35V6h-3.6M2 13.65V10h3.6" />
            </svg>
            {refreshing ? "..." : "Refresh"}
          </button>
          <button className="btn btn-danger-ghost btn-xs" onClick={() => onRemove(entry.id)}>
            Remove
          </button>
        </div>
      </div>

      {/* Expand section */}
      {hasPrediction && hasBreakdown ? (
        <div className="wc-expand">
          <button className="wc-expand-toggle" onClick={() => setExpanded(!expanded)}>
            <span className={`wc-expand-caret${expanded ? " open" : ""}`}>{"\u25B6"}</span>
            <span>Per-axis breakdown</span>
            <span style={{ color: "var(--predict-accent)", fontSize: 11, marginLeft: 4 }}>
              {entry.predictedBreakdown!.length} axes
            </span>
          </button>

          {expanded && (
            <>
              <div className="wc-breakdown">
                {entry.predictedBreakdown!.map((axis: WishlistBreakdownEntry) => (
                  <div key={axis.axisName} className="wc-breakdown-row">
                    <span className="wc-axis-name">{axis.axisName}</span>
                    <span className="wc-axis-rating">{axis.rating.toFixed(1)}</span>
                    <ConfBadgeSm confidence={axis.confidence} />
                  </div>
                ))}
              </div>

              {entry.nicheImpact && <NicheImpactPanel nicheImpact={entry.nicheImpact} />}
            </>
          )}
        </div>
      ) : !hasPrediction ? (
        <div className="wc-expand">
          <div className="wc-no-pred-panel">
            Prediction was unavailable at Stage 0. Click Refresh to run a new prediction with your
            current collection.
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function WishlistPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("addedAt");
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/daemon/wishlist");
        if (!res.ok) throw new Error("Failed to load wishlist");
        const data = (await res.json()) as WishlistEntry[];
        setEntries(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load wishlist");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleRemove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      const res = await fetch(`/api/daemon/wishlist/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // Refetch on failure
        const refetch = await fetch("/api/daemon/wishlist");
        if (refetch.ok) setEntries((await refetch.json()) as WishlistEntry[]);
      }
    } catch {
      // Refetch on failure
      try {
        const refetch = await fetch("/api/daemon/wishlist");
        if (refetch.ok) setEntries((await refetch.json()) as WishlistEntry[]);
      } catch {
        // ignore
      }
    }
  }

  async function handleRefresh(id: string) {
    try {
      const res = await fetch(`/api/daemon/wishlist/${id}/refresh`, { method: "POST" });
      if (!res.ok) {
        setError("Failed to refresh entry");
        return;
      }
      const { entry } = (await res.json()) as { entry: WishlistEntry };
      setEntries((prev) => prev.map((e) => (e.id === id ? entry : e)));
    } catch {
      setError("Failed to refresh entry");
    }
  }

  async function handleRefreshAll() {
    setRefreshingAll(true);
    setError(null);
    try {
      const res = await fetch("/api/daemon/wishlist/refresh", { method: "POST" });
      if (!res.ok) {
        setError("Failed to refresh wishlist");
        return;
      }
      const { refreshed, errors } = (await res.json()) as {
        refreshed: number;
        errors: string[];
      };
      // Refetch full list to get updated data
      const listRes = await fetch("/api/daemon/wishlist");
      if (listRes.ok) {
        setEntries((await listRes.json()) as WishlistEntry[]);
      }
      if (errors.length > 0) {
        setError(
          `Refreshed ${refreshed} of ${refreshed + errors.length} entries. ${errors.length} error(s).`,
        );
      }
    } catch {
      setError("Failed to refresh wishlist");
    } finally {
      setRefreshingAll(false);
    }
  }

  async function handleAddToCollection(entry: WishlistEntry) {
    setError(null);
    try {
      const res = await fetch("/api/daemon/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bggId: entry.bggId }),
      });
      if (res.status === 409) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "This game is already in your collection");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        setError(data.error ?? `Failed: ${res.status}`);
        return;
      }
      const { game } = (await res.json()) as { game: { id: string } };
      // Entry auto-removed by REQ-WISH-10, update local state
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      router.push(`/games/${game.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add game");
    }
  }

  async function handleClearAll() {
    if (!confirm(`Remove all ${entries.length} wishlisted games?`)) return;
    try {
      const res = await fetch("/api/daemon/wishlist", { method: "DELETE" });
      if (res.ok) {
        setEntries([]);
      }
    } catch {
      setError("Failed to clear wishlist");
    }
  }

  const sorted = sortEntries(entries, sortField);
  const activeSortLabel = SORT_OPTIONS.find((o) => o.value === sortField)?.label ?? "Date Added";

  if (loading) {
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Wishlist</div>
        </div>
        <div className="main-scroll">
          <div className="wishlist-content">
            <div style={{ textAlign: "center", padding: "64px 32px", color: "var(--text-muted)" }}>
              Loading...
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Wishlist</div>
        <span className="topbar-meta">
          {entries.length} game{entries.length !== 1 ? "s" : ""}
        </span>

        {/* Sort widget */}
        <div style={{ position: "relative" }}>
          <button className="sort-widget" onClick={() => setSortMenuOpen(!sortMenuOpen)}>
            <span className="sort-widget-label">Sort</span>
            {activeSortLabel}
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="currentColor"
              style={{ opacity: 0.5 }}
            >
              <path d="M5 7L1 3h8L5 7z" />
            </svg>
          </button>
          {sortMenuOpen && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 9 }}
                onClick={() => setSortMenuOpen(false)}
              />
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 4,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  zIndex: 10,
                  minWidth: 160,
                  overflow: "hidden",
                }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSortField(opt.value);
                      setSortMenuOpen(false);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 14px",
                      fontSize: 13,
                      background: sortField === opt.value ? "var(--action-subtle)" : "transparent",
                      color: sortField === opt.value ? "var(--action)" : "var(--text-secondary)",
                      fontWeight: sortField === opt.value ? 500 : 400,
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Refresh All */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void handleRefreshAll();
          }}
          disabled={refreshingAll || entries.length === 0}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.65 2.35A8 8 0 102 13.65M13.65 2.35V6h-3.6M2 13.65V10h3.6" />
          </svg>
          {refreshingAll ? "Refreshing..." : "Refresh All"}
        </button>
      </div>

      <div className="main-scroll">
        <div className="wishlist-content">
          {error && <div className="error-banner">{error}</div>}

          {entries.length === 0 ? (
            <div className="wishlist-empty">
              <div className="wishlist-empty-title">No wishlisted games</div>
              <p>
                <Link href="/search">Browse games</Link> to add to your wishlist.
              </p>
            </div>
          ) : (
            <>
              {sorted.map((entry) => (
                <WishlistCard
                  key={entry.id}
                  entry={entry}
                  onRemove={(id) => {
                    void handleRemove(id);
                  }}
                  onRefresh={handleRefresh}
                  onAddToCollection={handleAddToCollection}
                />
              ))}

              <div className="wishlist-clear-row">
                <button
                  className="wishlist-clear-btn"
                  onClick={() => {
                    void handleClearAll();
                  }}
                >
                  Clear entire wishlist
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
