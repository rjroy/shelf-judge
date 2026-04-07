"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { GameWithScore, Axis, TournamentGameStatsDisplay } from "@shelf-judge/shared";
import { scoreRangeClass } from "@/lib/score-utils";
import { relativeDate } from "@/lib/date-utils";

// ---------------------------------------------------------------------------
// Sort field definitions
// ---------------------------------------------------------------------------

type SortGroup = "score" | "identity" | "specs" | "axes";

interface SortFieldDef {
  id: string;
  label: string;
  group: SortGroup;
  defaultDirection: "asc" | "desc";
}

const BUILT_IN_SORT_FIELDS: SortFieldDef[] = [
  // Score group
  { id: "fitness", label: "Fitness Score", group: "score", defaultDirection: "desc" },
  { id: "tournament", label: "Tournament ELO", group: "score", defaultDirection: "desc" },
  // Identity group
  { id: "name", label: "Name", group: "identity", defaultDirection: "asc" },
  { id: "yearPublished", label: "Year Published", group: "identity", defaultDirection: "desc" },
  { id: "createdAt", label: "Date Added", group: "identity", defaultDirection: "desc" },
  { id: "updatedAt", label: "Last Updated", group: "identity", defaultDirection: "desc" },
  // Specs group
  { id: "playerCount", label: "Player Count", group: "specs", defaultDirection: "asc" },
  { id: "playTime", label: "Play Time", group: "specs", defaultDirection: "asc" },
  { id: "bggRating", label: "BGG Community Rating", group: "specs", defaultDirection: "desc" },
  { id: "bggWeight", label: "BGG Weight", group: "specs", defaultDirection: "desc" },
];

const GROUP_LABELS: Record<SortGroup, string> = {
  score: "Score",
  identity: "Identity",
  specs: "Specs",
  axes: "Your Axes",
};

const GROUP_ORDER: SortGroup[] = ["score", "identity", "specs", "axes"];

function buildSortFields(
  axes: Axis[],
  hasTournamentData: boolean,
  hasBggData: boolean,
): SortFieldDef[] {
  const fields = BUILT_IN_SORT_FIELDS.filter((f) => {
    if (f.id === "tournament" && !hasTournamentData) return false;
    if ((f.id === "bggRating" || f.id === "bggWeight") && !hasBggData) return false;
    return true;
  });
  for (const axis of axes) {
    fields.push({
      id: `axis:${axis.id}`,
      label: axis.name,
      group: "axes",
      defaultDirection: "desc",
    });
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Sort state persistence
// ---------------------------------------------------------------------------

interface SortState {
  field: string;
  direction: "asc" | "desc";
}

const SORT_STORAGE_KEY = "shelf-judge-sort";
const DEFAULT_SORT: SortState = { field: "fitness", direction: "desc" };

function loadSort(): SortState {
  if (typeof window === "undefined") return DEFAULT_SORT;
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw) as SortState;
    if (parsed.field && (parsed.direction === "asc" || parsed.direction === "desc")) {
      return parsed;
    }
  } catch {
    // Corrupt data, fall back
  }
  return DEFAULT_SORT;
}

function saveSort(sort: SortState): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // Storage full or unavailable
  }
}

// ---------------------------------------------------------------------------
// Sort comparator
// ---------------------------------------------------------------------------

type SortValue = number | string | null;

function getSortValue(
  gws: GameWithScore,
  field: string,
  tournamentStats: Record<string, TournamentGameStatsDisplay>,
): SortValue {
  const { game, score } = gws;
  switch (field) {
    case "fitness":
      return score?.score ?? null;
    case "tournament":
      return tournamentStats[game.id]?.normalizedScore ?? null;
    case "name":
      return game.name.toLowerCase();
    case "yearPublished":
      return game.yearPublished;
    case "createdAt":
      return game.createdAt;
    case "updatedAt":
      return game.updatedAt;
    case "playerCount":
      return game.minPlayers;
    case "playTime":
      return game.playingTime;
    case "bggRating":
      return game.bggData?.communityRating ?? null;
    case "bggWeight":
      return game.bggData?.weight ?? null;
    default:
      if (field.startsWith("axis:")) {
        const axisId = field.slice(5);
        return game.ratings[axisId] ?? null;
      }
      return null;
  }
}

function sortGames(
  games: GameWithScore[],
  field: string,
  direction: "asc" | "desc",
  tournamentStats: Record<string, TournamentGameStatsDisplay>,
): { withValue: GameWithScore[]; withoutValue: GameWithScore[] } {
  const withValue: GameWithScore[] = [];
  const withoutValue: GameWithScore[] = [];

  for (const g of games) {
    const v = getSortValue(g, field, tournamentStats);
    if (v === null) {
      withoutValue.push(g);
    } else {
      withValue.push(g);
    }
  }

  const dir = direction === "asc" ? 1 : -1;
  withValue.sort((a, b) => {
    const av = getSortValue(a, field, tournamentStats)!;
    const bv = getSortValue(b, field, tournamentStats)!;
    if (typeof av === "string" && typeof bv === "string") {
      return dir * av.localeCompare(bv);
    }
    return dir * ((av as number) - (bv as number));
  });

  withoutValue.sort((a, b) => a.game.name.localeCompare(b.game.name));

  return { withValue, withoutValue };
}

// ---------------------------------------------------------------------------
// Score display (Phase 2)
// ---------------------------------------------------------------------------

interface ScoreDisplay {
  text: string;
  className: string;
  dotClass?: string; // For fitness color dot
}

function getScoreDisplay(
  gws: GameWithScore,
  field: string,
  tournamentStats: Record<string, TournamentGameStatsDisplay>,
  axes: Axis[],
): ScoreDisplay {
  const { game, score } = gws;

  switch (field) {
    case "fitness":
    case "name": {
      // Name sort falls back to fitness display (REQ-CFS-8)
      if (!score) return { text: "not rated", className: "score-unrated" };
      return {
        text: score.score.toFixed(1),
        className: "score-value",
        dotClass: scoreRangeClass(score.score),
      };
    }
    case "tournament": {
      const stats = tournamentStats[game.id];
      return {
        text: stats?.displayLabel ?? "-",
        className: "score-value tournament-score",
      };
    }
    case "yearPublished":
      return {
        text: game.yearPublished != null ? String(game.yearPublished) : "---",
        className: "score-value",
      };
    case "playerCount": {
      if (game.minPlayers == null || game.maxPlayers == null)
        return { text: "---", className: "score-value" };
      const range =
        game.minPlayers === game.maxPlayers
          ? `${game.minPlayers}p`
          : `${game.minPlayers}-${game.maxPlayers}`;
      return { text: range, className: "score-value" };
    }
    case "playTime":
      return {
        text: game.playingTime != null ? `${game.playingTime} min` : "---",
        className: "score-value",
      };
    case "bggRating":
      return {
        text:
          game.bggData?.communityRating != null ? game.bggData.communityRating.toFixed(1) : "---",
        className: "score-value",
      };
    case "bggWeight":
      return {
        text: game.bggData?.weight != null ? game.bggData.weight.toFixed(1) : "---",
        className: "score-value",
      };
    case "createdAt":
      return { text: relativeDate(game.createdAt), className: "score-value" };
    case "updatedAt":
      return { text: relativeDate(game.updatedAt), className: "score-value" };
    default: {
      if (field.startsWith("axis:")) {
        const axisId = field.slice(5);
        const rating = game.ratings[axisId];
        if (rating == null) return { text: "---", className: "score-value" };
        return { text: String(rating), className: "score-value axis-score" };
      }
      return { text: "---", className: "score-value" };
    }
  }
}

// ---------------------------------------------------------------------------
// Separator label (Phase 2)
// ---------------------------------------------------------------------------

function getSeparatorLabel(field: string, count: number, axes: Axis[]): string | null {
  if (field === "name") return null; // Every game has a name
  const n = `${count} game${count !== 1 ? "s" : ""}`;
  switch (field) {
    case "fitness":
      return `Not yet rated \u00b7 ${n}`;
    case "tournament":
      return `Not yet ranked \u00b7 ${n}`;
    case "playerCount":
      return `No player count data \u00b7 ${n}`;
    case "playTime":
      return `No play time data \u00b7 ${n}`;
    case "bggRating":
      return `No BGG rating data \u00b7 ${n}`;
    case "bggWeight":
      return `No BGG weight data \u00b7 ${n}`;
    case "yearPublished":
      return `No year published \u00b7 ${n}`;
    case "createdAt":
    case "updatedAt":
      return null; // Every game has timestamps
    default: {
      if (field.startsWith("axis:")) {
        const axisId = field.slice(5);
        const axis = axes.find((a) => a.id === axisId);
        const axisName = axis?.name ?? "unknown";
        return `No rating on \u2018${axisName}\u2019 \u00b7 ${n}`;
      }
      return `No data \u00b7 ${n}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Score column header subtitle (Phase 2)
// ---------------------------------------------------------------------------

function getScoreSubtitle(field: string, axes: Axis[]): string {
  switch (field) {
    case "fitness":
    case "name":
      return "Fitness";
    case "tournament":
      return "Tournament ELO";
    case "yearPublished":
      return "Year";
    case "createdAt":
      return "Date Added";
    case "updatedAt":
      return "Last Updated";
    case "playerCount":
      return "Player Count";
    case "playTime":
      return "Play Time";
    case "bggRating":
      return "BGG Rating";
    case "bggWeight":
      return "BGG Weight";
    default: {
      if (field.startsWith("axis:")) {
        const axisId = field.slice(5);
        return axes.find((a) => a.id === axisId)?.name ?? "Axis";
      }
      return "";
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CollectionTableProps {
  games: GameWithScore[];
  axes: Axis[];
  tournamentStats: Record<string, TournamentGameStatsDisplay>;
  hasTournamentData: boolean;
}

export function CollectionTable({
  games,
  axes,
  tournamentStats,
  hasTournamentData,
}: CollectionTableProps) {
  // Sort state: default on SSR, hydrate from localStorage after mount
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [hydrated, setHydrated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSort(loadSort());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveSort(sort);
  }, [sort, hydrated]);

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

  const hasBggData = games.some((g) => g.game.bggData !== null);
  const sortFields = buildSortFields(axes, hasTournamentData, hasBggData);
  const activeDef = sortFields.find((f) => f.id === sort.field) ?? sortFields[0];

  const handleSortSelect = useCallback(
    (fieldId: string) => {
      if (fieldId === sort.field) {
        // Toggle direction
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

  // Clickable column headers (Phase 2, REQ-CFS-11, 12, 13)
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

  // Build sorted lists
  const { withValue, withoutValue } = sortGames(games, sort.field, sort.direction, tournamentStats);
  const axisMap = new Map(axes.map((a) => [a.id, a]));
  const isAxisSort = sort.field.startsWith("axis:");
  const separatorLabel =
    withoutValue.length > 0 ? getSeparatorLabel(sort.field, withoutValue.length, axes) : null;
  const scoreSubtitle = getScoreSubtitle(sort.field, axes);
  const dirArrow = sort.direction === "asc" ? "\u2191" : "\u2193";

  // Group fields for the dropdown menu
  const groupedFields = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    fields: sortFields.filter((f) => f.group === group),
  })).filter((g) => g.fields.length > 0);

  return (
    <>
      {/* Sort control in topbar area */}
      <div className="sort-control" ref={menuRef}>
        <span className="sort-label-prefix">Sort by</span>
        <button className="sort-select" onClick={() => setMenuOpen((v) => !v)}>
          <span className="sort-select-label">{activeDef.label}</span>
          <span className="chevron">{menuOpen ? "\u25B2" : "\u25BC"}</span>
        </button>
        <button className="sort-dir-btn" onClick={toggleDirection} title="Toggle sort direction">
          {dirArrow}
        </button>

        {menuOpen && (
          <div className="sort-menu">
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
                    <div key={f.id} className={itemClass} onClick={() => handleSortSelect(f.id)}>
                      <span className="check">{isActive ? "\u2713" : ""}</span>
                      <span className="item-label">{f.label}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Table header with clickable columns (Phase 2) */}
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
          <span className={`score-col-main${sort.field !== "name" ? " sort-active" : ""}`}>
            Score
            <span className="sort-arrow">{dirArrow}</span>
          </span>
          <span className="score-col-sub">{scoreSubtitle}</span>
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
          axes={axes}
          axisMap={axisMap}
          isAxisSort={isAxisSort}
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
          axes={axes}
          axisMap={axisMap}
          isAxisSort={isAxisSort}
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
  axes: Axis[];
  axisMap: Map<string, Axis>;
  isAxisSort: boolean;
}

function GameRow({
  gws,
  rank,
  sortField,
  tournamentStats,
  axes,
  axisMap,
  isAxisSort,
}: GameRowProps) {
  const { game, score } = gws;
  const display = getScoreDisplay(gws, sortField, tournamentStats, axes);
  const isUnrated = score === null && rank === null;

  // Axes column: show rated axis chips, or alternate context when axis-sorting (REQ-CFS-10)
  const ratedAxisIds = Object.keys(game.ratings);
  const ratedAxisNames = ratedAxisIds
    .map((id) => axisMap.get(id)?.name)
    .filter((name): name is string => name !== undefined);
  const visibleAxes = ratedAxisNames.slice(0, 3);
  const extraCount = ratedAxisNames.length - visibleAxes.length;

  return (
    <Link href={`/games/${game.id}`} className={`game-row${isUnrated ? " unrated" : ""}`}>
      <div className="rank">{rank !== null ? rank : "\u2014"}</div>
      <div className="game-thumb-col">
        {game.imageUrl ? (
          <img src={game.imageUrl} alt="" className="game-thumb" />
        ) : (
          <div className="game-thumb-placeholder" />
        )}
      </div>
      <div className="game-info">
        <div className="game-name">{game.name}</div>
        <div className="game-meta">
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
          // REQ-CFS-10: Show fitness + ELO when sorting by axis
          <AxisSortAltScores gws={gws} tournamentStats={tournamentStats} />
        ) : isUnrated ? (
          <span className="no-ratings">No ratings yet</span>
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
      <div className="last-rated">{relativeDate(game.updatedAt)}</div>
      <div className="score-cell">
        {display.className === "score-unrated" ? (
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
        <span className="axis-sort-fitness">
          <span className={`score-dot ${scoreRangeClass(score.score)}`} />
          {score.score.toFixed(1)}
        </span>
      ) : (
        <span className="axis-sort-fitness muted">--</span>
      )}
      {eloStats && <span className="axis-sort-elo">{eloStats.displayLabel}</span>}
    </span>
  );
}
