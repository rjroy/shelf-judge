"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { matchesBggTag } from "@shelf-judge/shared";
import type {
  TournamentSession,
  SessionFilter,
  TournamentGameStatsDisplay,
} from "@shelf-judge/shared";
import type { GameWithScore } from "@/lib/api";

interface TournamentStatsEntry {
  gameId: string;
  gameName: string;
  stats: TournamentGameStatsDisplay;
}

type PresetKey = "all" | "unranked" | "topRated" | "needsData" | "custom";

interface PresetDef {
  key: PresetKey;
  label: string;
  filters: SessionFilter[] | null;
}

const PRESETS: PresetDef[] = [
  { key: "all", label: "All games", filters: null },
  { key: "unranked", label: "Unranked", filters: [{ type: "staleness", value: "6" }] },
  { key: "topRated", label: "Top rated", filters: [{ type: "minFitness", value: "7.5" }] },
  { key: "needsData", label: "Needs more data", filters: [{ type: "staleness", value: "3" }] },
];

function describeFilters(filters: SessionFilter[] | null): string {
  if (!filters || filters.length === 0) return "All games";
  return filters
    .map((f) => {
      switch (f.type) {
        case "name":
          return `Name: "${f.value}"`;
        case "minFitness":
          return `Fitness >= ${f.value}`;
        case "bggTag":
          return `Tag: ${f.value}`;
        case "staleness":
          return `< ${f.value} comparisons`;
        default:
          return f.value;
      }
    })
    .join(", ");
}

function countMatchingGames(
  games: GameWithScore[],
  allStats: Record<string, TournamentGameStatsDisplay>,
  filters: SessionFilter[] | null,
): number {
  if (!filters || filters.length === 0) return games.length;
  return games.filter(({ game, score }) =>
    filters.every((f) => {
      switch (f.type) {
        case "name":
          return game.name.toLowerCase().includes(f.value.toLowerCase());
        case "minFitness":
          return score !== null && score.score >= parseFloat(f.value);
        case "bggTag": {
          const mechanics = game.bggData?.mechanics ?? [];
          const categories = game.bggData?.categories ?? [];
          const tagNames = [...mechanics, ...categories].map((t) => t.name);
          return matchesBggTag(f.value, tagNames);
        }
        case "staleness": {
          const stats = allStats[game.id];
          const count = stats?.comparisonCount ?? 0;
          return count < parseInt(f.value, 10);
        }
        default:
          return true;
      }
    }),
  ).length;
}

export default function TournamentPage() {
  const router = useRouter();
  const [games, setGames] = useState<GameWithScore[]>([]);
  const [allStats, setAllStats] = useState<Record<string, TournamentGameStatsDisplay>>({});
  const [activeSession, setActiveSession] = useState<TournamentSession | null>(null);
  const [sessions, setSessions] = useState<TournamentSession[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>("all");
  const [customFilters, setCustomFilters] = useState<SessionFilter[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [gamesRes, statsRes, activeRes, sessionsRes] = await Promise.all([
        fetch("/api/daemon/games").then((r) => r.json()) as Promise<GameWithScore[]>,
        fetch("/api/daemon/tournament/stats")
          .then((r) => r.json() as Promise<TournamentStatsEntry[]>)
          .then((entries) =>
            Object.fromEntries(entries.map((e) => [e.gameId, e.stats])),
          ) as Promise<Record<string, TournamentGameStatsDisplay>>,
        fetch("/api/daemon/tournament/sessions/active").then(async (r) => {
          if (r.status === 404) return null;
          const data = (await r.json()) as { session: TournamentSession };
          return data.session;
        }),
        fetch("/api/daemon/tournament/sessions").then((r) => r.json()) as Promise<
          TournamentSession[]
        >,
      ]);
      setGames(gamesRes);
      setAllStats(statsRes);
      setActiveSession(activeRes);
      setSessions(sessionsRes);
    } catch {
      setError("Could not connect to daemon");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentFilters =
    selectedPreset === "custom"
      ? customFilters.length > 0
        ? customFilters
        : null
      : (PRESETS.find((p) => p.key === selectedPreset)?.filters ?? null);

  const gameCount = countMatchingGames(games, allStats, currentFilters);

  const totalComparisons = Object.values(allStats).reduce((sum, s) => sum + s.comparisonCount, 0);
  // Each comparison is counted for both games, so divide by 2 for unique comparisons
  const uniqueComparisons = Math.floor(totalComparisons / 2);

  const topScore = Object.values(allStats).reduce<number | null>((best, s) => {
    if (s.normalizedScore === null) return best;
    if (best === null) return s.normalizedScore;
    return s.normalizedScore > best ? s.normalizedScore : best;
  }, null);

  const provisionalCount = Object.values(allStats).filter(
    (s) => s.isProvisional && s.comparisonCount > 0,
  ).length;

  const pastSessionCount = sessions.filter((s) => s.status === "completed").length;

  async function handleStartSession() {
    setStarting(true);
    setError(null);
    try {
      const body: { filters?: SessionFilter[] } = {};
      if (currentFilters && currentFilters.length > 0) {
        body.filters = currentFilters;
      }
      const res = await fetch("/api/daemon/tournament/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to start session");
      }
      const data = (await res.json()) as { session: TournamentSession };
      router.push(`/tournament/session?id=${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
      setStarting(false);
    }
  }

  async function handleEndSession() {
    if (!activeSession) return;
    try {
      await fetch(`/api/daemon/tournament/sessions/${activeSession.id}/end`, { method: "POST" });
      setActiveSession(null);
      void loadData();
    } catch {
      setError("Failed to end session");
    }
  }

  function handleAddFilter() {
    if (!filterType || !filterValue) return;
    setCustomFilters((prev) => [
      ...prev,
      { type: filterType as SessionFilter["type"], value: filterValue },
    ]);
    setFilterType("");
    setFilterValue("");
    setSelectedPreset("custom");
  }

  function handleRemoveFilter(index: number) {
    setCustomFilters((prev) => prev.filter((_, i) => i !== index));
  }

  if (loading) {
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Tournament</div>
        </div>
        <div className="main-scroll">
          <div className="tournament-loading">Loading...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Tournament</div>
        <div className="topbar-session-meta">Head-to-head ranking</div>
      </div>

      <div className="main-scroll">
        <div className="tournament-content">
          {error && <div className="error-banner">{error}</div>}

          {activeSession && (
            <div className="resume-banner">
              <div className="resume-banner-dot" />
              <div className="resume-banner-info">
                <div className="resume-banner-title">
                  Active session — {describeFilters(activeSession.filters)}
                </div>
                <div className="resume-banner-meta">
                  {activeSession.comparisonCount} comparisons · {activeSession.gameIds.length} games
                  in scope
                </div>
              </div>
              <div className="resume-banner-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => router.push(`/tournament/session?id=${activeSession.id}`)}
                >
                  Resume session
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    void handleEndSession();
                  }}
                >
                  End
                </button>
              </div>
            </div>
          )}

          <div className="section-heading">New session</div>

          <div className="session-panel">
            <div className="session-panel-header">
              <div className="session-panel-title">Choose scope</div>
              <div className="session-panel-desc">
                Play from your full collection or narrow to a subset. Filters help focus on games
                that need more data.
              </div>
            </div>

            <div className="session-panel-body">
              <div className="scope-label">Quick presets</div>
              <div className="scope-options">
                {PRESETS.map((preset) => {
                  const count = countMatchingGames(games, allStats, preset.filters);
                  return (
                    <button
                      key={preset.key}
                      className={`scope-option${selectedPreset === preset.key ? " selected" : ""}`}
                      onClick={() => setSelectedPreset(preset.key)}
                    >
                      {preset.label}
                      <span className="option-count">{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="or-divider">
                <span className="or-divider-text">or</span>
              </div>

              <div className="scope-label">Custom filters</div>

              {customFilters.length > 0 && (
                <div className="filter-chips">
                  {customFilters.map((f, i) => (
                    <span key={i} className="filter-chip">
                      {describeFilters([f])}
                      <button
                        className="filter-chip-remove"
                        onClick={() => handleRemoveFilter(i)}
                        aria-label="Remove filter"
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="filter-add-row">
                <select
                  className="filter-type-select"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="">Select filter type...</option>
                  <option value="name">Name contains...</option>
                  <option value="minFitness">Axis fitness above...</option>
                  <option value="bggTag">BGG tag...</option>
                  <option value="staleness">Fewer than N comparisons</option>
                </select>
                {filterType && (
                  <input
                    className="filter-value-input"
                    type={
                      filterType === "minFitness" || filterType === "staleness" ? "number" : "text"
                    }
                    placeholder={
                      filterType === "name"
                        ? "Game name..."
                        : filterType === "minFitness"
                          ? "7.5"
                          : filterType === "bggTag"
                            ? "Worker Placement"
                            : "6"
                    }
                    value={filterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddFilter();
                    }}
                  />
                )}
                <button
                  className="add-filter-btn"
                  onClick={handleAddFilter}
                  disabled={!filterType || !filterValue}
                >
                  + Add filter
                </button>
              </div>
            </div>

            <div className="session-panel-footer">
              <div className="session-scope-preview">
                <strong>{gameCount}</strong> games in scope · minimum 4 required
              </div>
              <button
                className="btn btn-primary btn-lg"
                onClick={() => {
                  void handleStartSession();
                }}
                disabled={gameCount < 4 || starting}
              >
                {starting ? "Starting..." : "Start session"}
              </button>
            </div>
          </div>

          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-card-value">{uniqueComparisons}</div>
              <div className="stat-card-label">Total comparisons</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-value amber">
                {topScore !== null ? topScore.toFixed(1) : "-"}
              </div>
              <div className="stat-card-label">Top tournament rank</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-value">{provisionalCount}</div>
              <div className="stat-card-label">Provisional games</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-value">{pastSessionCount}</div>
              <div className="stat-card-label">Past sessions</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
