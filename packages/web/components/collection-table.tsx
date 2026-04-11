"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import type { GameWithScore, Axis, TournamentGameStatsDisplay } from "@shelf-judge/shared";
import { scoreRangeClass } from "@/lib/score-utils";
import { relativeDate } from "@/lib/date-utils";
import {
  type FilterState,
  type SortState,
  buildSortFields,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  getScoreDisplay,
  getScoreSubtitle,
  getSeparatorLabel,
  GROUP_LABELS,
  GROUP_ORDER,
  loadFilters,
  loadSort,
  matchesFilters,
  saveFilters,
  saveSort,
  sortGames,
} from "@/lib/collection-utils";

interface CollectionTableProps {
  games: GameWithScore[];
  predictedGames: GameWithScore[] | null;
  axes: Axis[];
  tournamentStats: Record<string, TournamentGameStatsDisplay>;
  hasTournamentData: boolean;
  totalGames: number;
  ratedCount: number;
  avgFitness: number | null;
  predictedCount: number;
}

export function CollectionTable({
  games,
  predictedGames,
  axes,
  tournamentStats,
  hasTournamentData,
  totalGames,
  ratedCount,
  avgFitness,
  predictedCount,
}: CollectionTableProps) {
  // Sort state: default on SSR, hydrate from localStorage after mount
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [playerCountInput, setPlayerCountInput] = useState("");
  const [predictionsOn, setPredictionsOn] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSort(loadSort());
    const loaded = loadFilters();
    setFilters(loaded);
    setPlayerCountInput(loaded.playerCount !== null ? String(loaded.playerCount) : "");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveSort(sort);
  }, [sort, hydrated]);

  useEffect(() => {
    if (hydrated) saveFilters(filters);
  }, [filters, hydrated]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Use predicted games when toggle is on, otherwise use standard games
  const activeGames = predictionsOn && predictedGames ? predictedGames : games;

  const hasBggData = activeGames.some((g) => g.game.bggData !== null);
  const sortFields = useMemo(
    () => buildSortFields(axes, hasTournamentData, hasBggData),
    [axes, hasTournamentData, hasBggData],
  );
  const activeDef = sortFields.find((f) => f.id === sort.field) ?? sortFields[0];

  const handleSortSelect = useCallback(
    (fieldId: string) => {
      if (fieldId === sort.field) {
        setSort({ field: fieldId, direction: sort.direction === "asc" ? "desc" : "asc" });
      } else {
        const def = sortFields.find((f) => f.id === fieldId);
        setSort({ field: fieldId, direction: def?.defaultDirection ?? "desc" });
      }
      setMenuOpen(false);
    },
    [sort, sortFields],
  );

  const toggleDirection = useCallback(() => {
    setSort((prev) => ({
      ...prev,
      direction: prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const handleScoreHeaderClick = useCallback(() => {
    toggleDirection();
  }, [toggleDirection]);

  const handleGameHeaderClick = useCallback(() => {
    if (sort.field === "name") {
      setSort((prev) => ({ ...prev, direction: prev.direction === "asc" ? "desc" : "asc" }));
    } else {
      setSort({ field: "name", direction: "asc" });
    }
  }, [sort.field]);

  const handleLastRatedHeaderClick = useCallback(() => {
    if (sort.field === "updatedAt") {
      setSort((prev) => ({ ...prev, direction: prev.direction === "asc" ? "desc" : "asc" }));
    } else {
      setSort({ field: "updatedAt", direction: "desc" });
    }
  }, [sort.field]);

  // Filter handlers
  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setPlayerCountInput("");
  }, []);

  const handlePlayerCountChange = useCallback(
    (value: string) => {
      setPlayerCountInput(value);
      const num = parseInt(value, 10);
      updateFilter("playerCount", isNaN(num) || num < 1 ? null : num);
    },
    [updateFilter],
  );

  // Apply filters then sort
  const filtered = useMemo(
    () => activeGames.filter((g) => matchesFilters(g, filters)),
    [activeGames, filters],
  );
  const { withValue, withoutValue } = useMemo(
    () => sortGames(filtered, sort.field, sort.direction, tournamentStats),
    [filtered, sort.field, sort.direction, tournamentStats],
  );
  const axisMap = useMemo(() => new Map(axes.map((a) => [a.id, a])), [axes]);
  const isAxisSort = sort.field.startsWith("axis:");
  const separatorLabel =
    withoutValue.length > 0 ? getSeparatorLabel(sort.field, withoutValue.length, axes) : null;
  const scoreSubtitle = getScoreSubtitle(sort.field, axes);
  const dirArrow = sort.direction === "asc" ? "\u2191" : "\u2193";
  const scoreOwnsSort = sort.field !== "name" && sort.field !== "updatedAt";

  // Filter chip state
  const hasSearch = filters.search !== "";
  const hasRatedFilter = filters.ratedStatus !== "all";
  const hasPlayedFilter = filters.playedStatus !== "all";
  const hasPlayerCount = filters.playerCount !== null;
  const activeFilterCount =
    (hasRatedFilter ? 1 : 0) + (hasPlayedFilter ? 1 : 0) + (hasPlayerCount ? 1 : 0);
  const hasAnyFilter = hasSearch || hasRatedFilter || hasPlayedFilter || hasPlayerCount;
  const hiddenCount =
    (predictionsOn && predictedGames ? predictedGames.length : totalGames) - filtered.length;

  // Group fields for the dropdown menu
  const groupedFields = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    fields: sortFields.filter((f) => f.group === group),
  })).filter((g) => g.fields.length > 0);

  return (
    <>
      {/* Filter bar (REQ-CFS-15, 16, 20) */}
      <div className="filter-bar">
        <div className="filter-row-1">
          <div className="search-input-wrap">
            <span className="search-icon">{"\uD83D\uDD0D"}</span>
            <input
              type="text"
              className={`search-input${hasSearch ? " has-value" : ""}`}
              placeholder="Search games by name..."
              value={filters.search}
              onChange={(e) => updateFilter("search", e.target.value)}
            />
          </div>

          {/* Sort control */}
          <div className="sort-control" ref={menuRef}>
            <span className="sort-label-prefix">Sort by</span>
            <button className="sort-select" onClick={() => setMenuOpen((v) => !v)}>
              <span className="sort-select-label">{activeDef.label}</span>
              <span className="chevron">{menuOpen ? "\u25B2" : "\u25BC"}</span>
            </button>
            <button
              className="sort-dir-btn"
              onClick={toggleDirection}
              title="Toggle sort direction"
            >
              {dirArrow}
            </button>

            {menuOpen && (
              <>
                <div className="sort-overlay-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="sort-menu">
                  <div className="sort-menu-header">
                    <span className="sort-menu-title">Sort by</span>
                    <button className="sort-menu-close" onClick={() => setMenuOpen(false)}>
                      {"\u2715"}
                    </button>
                  </div>
                  <div className="sort-menu-scroll">
                    {groupedFields.map(({ group, label, fields }) => (
                      <div className="sort-menu-group" key={group}>
                        <div className="sort-menu-group-label">{label}</div>
                        {fields.map((f) => {
                          const isAxis = f.group === "axes";
                          const isActive = f.id === sort.field;
                          const itemClass = isAxis
                            ? `sort-menu-axis-item${isActive ? " active" : ""}`
                            : `sort-menu-item${isActive ? " active" : ""}`;
                          return (
                            <button
                              key={f.id}
                              className={itemClass}
                              onClick={() => handleSortSelect(f.id)}
                            >
                              <span className="check">{isActive ? "\u2713" : ""}</span>
                              <span className="item-label">{f.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            className={`filter-toggle-btn${activeFilterCount > 0 ? " has-filters" : ""}`}
            onClick={() => setFilterPanelOpen((v) => !v)}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="filter-count-badge">{activeFilterCount}</span>
            )}
          </button>
        </div>

        {/* Expandable filter panel (REQ-CFS-16) */}
        {filterPanelOpen && (
          <div className="filter-panel">
            <div className="filter-group">
              <div className="filter-group-label">Status</div>
              <div className="filter-group-controls">
                {(["all", "rated", "unrated"] as const).map((status) => (
                  <button
                    key={status}
                    className={`seg-btn${filters.ratedStatus === status ? " active" : ""}`}
                    onClick={() => updateFilter("ratedStatus", status)}
                  >
                    {status === "all" ? "All" : status === "rated" ? "Rated" : "Unrated"}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <div className="filter-group-label">Played</div>
              <div className="filter-group-controls">
                {(["all", "played", "unplayed"] as const).map((status) => (
                  <button
                    key={status}
                    className={`seg-btn${filters.playedStatus === status ? " active" : ""}`}
                    onClick={() => updateFilter("playedStatus", status)}
                  >
                    {status === "all" ? "All" : status === "played" ? "Played" : "Unplayed"}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <div className="filter-group-label">Player Count</div>
              <div className="filter-group-controls">
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Plays at</span>
                <input
                  type="text"
                  className="range-input"
                  placeholder="#"
                  value={playerCountInput}
                  onChange={(e) => handlePlayerCountChange(e.target.value)}
                />
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>players</span>
              </div>
            </div>
          </div>
        )}

        {/* Active filter chips (REQ-CFS-17) */}
        {hasAnyFilter && (
          <div className="active-chips-row">
            <span className="chips-label">Active:</span>
            {hasSearch && (
              <span className="filter-chip chip-search">
                &ldquo;{filters.search}&rdquo;{" "}
                <button className="chip-x" onClick={() => updateFilter("search", "")}>
                  &times;
                </button>
              </span>
            )}
            {hasPlayedFilter && (
              <span className="filter-chip chip-played">
                {filters.playedStatus === "played" ? "Played only" : "Unplayed only"}{" "}
                <button className="chip-x" onClick={() => updateFilter("playedStatus", "all")}>
                  &times;
                </button>
              </span>
            )}
            {hasRatedFilter && (
              <span className="filter-chip chip-rated">
                {filters.ratedStatus === "rated" ? "Rated only" : "Unrated only"}{" "}
                <button className="chip-x" onClick={() => updateFilter("ratedStatus", "all")}>
                  &times;
                </button>
              </span>
            )}
            {hasPlayerCount && (
              <span className="filter-chip chip-spec">
                {filters.playerCount} players{" "}
                <button
                  className="chip-x"
                  onClick={() => {
                    updateFilter("playerCount", null);
                    setPlayerCountInput("");
                  }}
                >
                  &times;
                </button>
              </span>
            )}
            {(hasSearch ? 1 : 0) +
              (hasRatedFilter ? 1 : 0) +
              (hasPlayedFilter ? 1 : 0) +
              (hasPlayerCount ? 1 : 0) >=
              2 && (
              <button className="clear-all-link" onClick={clearAllFilters}>
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Stats strip (REQ-CFS-19) */}
      <div className="stats-strip">
        <div className="stat-block">
          <div className="stat-value">
            {hasAnyFilter ? `${filtered.length} of ${totalGames}` : totalGames}
          </div>
          <div className="stat-label">Games</div>
        </div>
        <div className="stat-block">
          <div className="stat-value score">
            {avgFitness !== null ? avgFitness.toFixed(1) : "-"}
          </div>
          <div className="stat-label">Avg Fitness</div>
        </div>
        <div className="stat-block">
          <div className="stat-value">{ratedCount}</div>
          <div className="stat-label">Rated</div>
        </div>
        <div className="stat-block">
          <div className="stat-value">{axes.length}</div>
          <div className="stat-label">Axes</div>
        </div>

        {/* Predictions toggle */}
        {predictedGames && predictedCount > 0 && (
          <>
            <div className="predictions-toggle" onClick={() => setPredictionsOn((v) => !v)}>
              <div className={`predictions-toggle-switch${predictionsOn ? " active" : ""}`} />
              <span className="predictions-toggle-label">Predictions</span>
            </div>
            {predictionsOn && (
              <div className="stat-block">
                <div className="stat-value predictions-stat">{predictedCount}</div>
                <div className="stat-label">Predicted</div>
              </div>
            )}
          </>
        )}

        {hasAnyFilter && hiddenCount > 0 && (
          <div className="filtered-note">Filtered, {hiddenCount} games hidden</div>
        )}
      </div>

      {/* Table header with clickable columns */}
      <div className="collection-header">
        <div className="rank">#</div>
        <div className="game-thumb-col"></div>
        <div
          className={`col-label sortable${sort.field === "name" ? " sort-active" : ""}`}
          onClick={handleGameHeaderClick}
          style={{ justifyContent: "flex-start" }}
        >
          Game
          {sort.field === "name" && <span className="sort-arrow">{dirArrow}</span>}
        </div>
        <div className="axes-used-col col-label">{isAxisSort ? "Scores" : "Axes Rated"}</div>
        {predictionsOn && <div className="col-label">Confidence</div>}
        <div
          className={`col-label sortable${sort.field === "updatedAt" ? " sort-active" : ""}`}
          onClick={handleLastRatedHeaderClick}
        >
          Last Rated
          {sort.field === "updatedAt" && <span className="sort-arrow">{dirArrow}</span>}
        </div>
        <div
          className="score-col-label sortable"
          onClick={handleScoreHeaderClick}
          style={{ cursor: "pointer" }}
        >
          <span className={`score-col-main${scoreOwnsSort ? " sort-active" : ""}`}>
            Score
            {scoreOwnsSort && <span className="sort-arrow">{dirArrow}</span>}
          </span>
          <span className="score-col-sub">
            {predictionsOn && sort.field === "fitness" ? (
              <span style={{ color: "var(--predict-accent)" }}>Pred. Fitness</span>
            ) : (
              scoreSubtitle
            )}
          </span>
        </div>
      </div>

      {/* Rows with value */}
      {withValue.map((gws, i) => (
        <GameRow
          key={gws.game.id}
          gws={gws}
          rank={i + 1}
          sortField={sort.field}
          tournamentStats={tournamentStats}
          axisMap={axisMap}
          isAxisSort={isAxisSort}
          showConfidence={predictionsOn}
        />
      ))}

      {/* Separator */}
      {separatorLabel && (
        <div className="section-sep">
          <span className="section-sep-label">{separatorLabel}</span>
          <span className="section-sep-line" />
        </div>
      )}

      {/* Rows without value */}
      {withoutValue.map((gws) => (
        <GameRow
          key={gws.game.id}
          gws={gws}
          rank={null}
          sortField={sort.field}
          tournamentStats={tournamentStats}
          axisMap={axisMap}
          isAxisSort={isAxisSort}
          showConfidence={predictionsOn}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// GameRow sub-component
// ---------------------------------------------------------------------------

interface GameRowProps {
  gws: GameWithScore;
  rank: number | null;
  sortField: string;
  tournamentStats: Record<string, TournamentGameStatsDisplay>;
  axisMap: Map<string, Axis>;
  isAxisSort: boolean;
  showConfidence: boolean;
}

function GameRow({
  gws,
  rank,
  sortField,
  tournamentStats,
  axisMap,
  isAxisSort,
  showConfidence,
}: GameRowProps) {
  const { game, score } = gws;
  const display = getScoreDisplay(gws, sortField, tournamentStats);
  const isPredictedOnly =
    score !== null && score.predictionMeta !== null && score.ratedAxisCount === 0;
  const hasPrediction = score?.predictionMeta !== null && score?.predictionMeta !== undefined;
  const isUnrated = score === null && rank === null;

  const ratedAxisIds = Object.keys(game.ratings);
  const ratedAxisNames = ratedAxisIds
    .map((id) => axisMap.get(id)?.name)
    .filter((name): name is string => name !== undefined);
  const visibleAxes = ratedAxisNames.slice(0, 3);
  const extraCount = ratedAxisNames.length - visibleAxes.length;

  const rowClass = [
    "game-row",
    isUnrated || isPredictedOnly ? " unrated" : "",
    isPredictedOnly ? " predicted-row" : "",
  ].join("");

  return (
    <Link href={`/games/${game.id}`} className={rowClass}>
      <div className="rank">{rank !== null ? rank : "\u2014"}</div>
      <div className="game-thumb-col">
        {game.imageUrl ? (
          <img src={game.imageUrl} alt="" className="game-thumb" />
        ) : (
          <div className="game-thumb-placeholder" />
        )}
      </div>
      <div className="game-info">
        <div className="game-name">
          {game.name}
          {isPredictedOnly && <span className="predicted-label">&middot; not rated</span>}
        </div>
        <div className="game-meta">
          {game.numPlays != null && game.numPlays > 0 && <span>x{game.numPlays}</span>}
          {game.yearPublished && <span>{game.yearPublished}</span>}
          {game.minPlayers != null && game.maxPlayers != null && (
            <span>
              {game.minPlayers === game.maxPlayers
                ? `${game.minPlayers}p`
                : `${game.minPlayers}-${game.maxPlayers}p`}
            </span>
          )}
          {game.bggData && <span className="bgg-badge">BGG</span>}
        </div>
      </div>
      <div className="axes-used">
        {isAxisSort ? (
          <AxisSortAltScores gws={gws} tournamentStats={tournamentStats} />
        ) : isUnrated || isPredictedOnly ? (
          <span className="no-ratings">{isPredictedOnly ? "Predicted" : "No ratings yet"}</span>
        ) : (
          <>
            {visibleAxes.map((name) => (
              <span key={name} className="axis-chip">
                {name}
              </span>
            ))}
            {extraCount > 0 && <span className="axis-chip-more">+{extraCount}</span>}
          </>
        )}
      </div>
      {showConfidence && (
        <div className="axes-used">
          {hasPrediction ? (
            <ConfidencePill level={score!.predictionMeta!.confidence} />
          ) : score ? (
            <ConfidencePill level="actual" />
          ) : (
            <span className="breakdown-dash">&mdash;</span>
          )}
        </div>
      )}
      <div className="last-rated">{relativeDate(game.updatedAt)}</div>
      <div className="score-cell">
        {score?.vetoed ? (
          <div className="score-vetoed-cell">
            <span className="vetoed-badge">VETOED</span>
            {score.hypotheticalScore !== null && (
              <span className="vetoed-hypothetical">{score.hypotheticalScore.toFixed(1)}</span>
            )}
          </div>
        ) : isPredictedOnly ? (
          <span className="score-predicted-inline">
            <span className="score-predicted-tilde-inline">~</span>
            {score!.score.toFixed(1)}
          </span>
        ) : display.className === "score-unrated" ? (
          <span className="score-unrated">{display.text}</span>
        ) : (
          <>
            {display.dotClass && <span className={`score-dot ${display.dotClass}`} />}
            <span className={display.className}>{display.text}</span>
          </>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Confidence pill for collection table
// ---------------------------------------------------------------------------

function ConfidencePill({ level }: { level: string }) {
  const label =
    level === "actual"
      ? "Actual"
      : level === "strong"
        ? "Strong"
        : level === "moderate"
          ? "Moderate"
          : level === "weak"
            ? "Weak"
            : "Insufficient";

  return <span className={`conf-badge conf-${level}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// Alternate axes column when sorting by axis (REQ-CFS-10)
// ---------------------------------------------------------------------------

function AxisSortAltScores({
  gws,
  tournamentStats,
}: {
  gws: GameWithScore;
  tournamentStats: Record<string, TournamentGameStatsDisplay>;
}) {
  const { game, score } = gws;
  const eloStats = tournamentStats[game.id];
  return (
    <span className="axis-sort-alt">
      {score ? (
        score.vetoed ? (
          <span className="axis-sort-fitness">
            <span className="vetoed-badge-small">V</span>
            {score.hypotheticalScore !== null ? score.hypotheticalScore.toFixed(1) : "--"}
          </span>
        ) : (
          <span className="axis-sort-fitness">
            <span className={`score-dot ${scoreRangeClass(score.score)}`} />
            {score.score.toFixed(1)}
          </span>
        )
      ) : (
        <span className="axis-sort-fitness muted">--</span>
      )}
      {eloStats && <span className="axis-sort-elo">{eloStats.displayLabel}</span>}
    </span>
  );
}
