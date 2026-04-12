import type { GameWithScore, Axis, TournamentGameStatsDisplay } from "@shelf-judge/shared";
import { resolveAxisValues } from "@shelf-judge/shared";
import { scoreRangeClass } from "@/lib/score-utils";
import { relativeDate } from "@/lib/date-utils";

// ---------------------------------------------------------------------------
// Sort field definitions
// ---------------------------------------------------------------------------

export type SortGroup = "score" | "identity" | "specs" | "axes";

export interface SortFieldDef {
  id: string;
  label: string;
  group: SortGroup;
  defaultDirection: "asc" | "desc";
}

const BUILT_IN_SORT_FIELDS: SortFieldDef[] = [
  { id: "fitness", label: "Fitness Score", group: "score", defaultDirection: "desc" },
  { id: "redundancy", label: "Redundancy Penalty", group: "score", defaultDirection: "desc" },
  { id: "tournament", label: "Tournament ELO", group: "score", defaultDirection: "desc" },
  { id: "name", label: "Name", group: "identity", defaultDirection: "asc" },
  { id: "yearPublished", label: "Year Published", group: "identity", defaultDirection: "desc" },
  { id: "createdAt", label: "Date Added", group: "identity", defaultDirection: "desc" },
  { id: "updatedAt", label: "Last Updated", group: "identity", defaultDirection: "desc" },
  { id: "playerCount", label: "Player Count", group: "specs", defaultDirection: "asc" },
  { id: "numPlays", label: "Number of Plays", group: "specs", defaultDirection: "desc" },
  { id: "playTime", label: "Play Time", group: "specs", defaultDirection: "asc" },
  { id: "bggRating", label: "BGG Community Rating", group: "specs", defaultDirection: "desc" },
  { id: "bggWeight", label: "BGG Weight", group: "specs", defaultDirection: "desc" },
];

export const GROUP_LABELS: Record<SortGroup, string> = {
  score: "Score",
  identity: "Identity",
  specs: "Specs",
  axes: "Your Axes",
};

export const GROUP_ORDER: SortGroup[] = ["score", "identity", "specs", "axes"];

export function buildSortFields(
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

export interface SortState {
  field: string;
  direction: "asc" | "desc";
}

const SORT_STORAGE_KEY = "shelf-judge-sort";
export const DEFAULT_SORT: SortState = { field: "fitness", direction: "desc" };

export function loadSort(): SortState {
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

export function saveSort(sort: SortState): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // Storage full or unavailable
  }
}

// ---------------------------------------------------------------------------
// Filter state persistence (REQ-CFS-22)
// ---------------------------------------------------------------------------

export interface FilterState {
  search: string;
  ratedStatus: "all" | "rated" | "unrated";
  playedStatus: "all" | "played" | "unplayed";
  playerCount: number | null;
}

const FILTER_STORAGE_KEY = "shelf-judge-filters";
export const DEFAULT_FILTERS: FilterState = {
  search: "",
  ratedStatus: "all",
  playedStatus: "all",
  playerCount: null,
};

export function loadFilters(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as FilterState;
    if (
      typeof parsed.search === "string" &&
      (parsed.ratedStatus === "all" ||
        parsed.ratedStatus === "rated" ||
        parsed.ratedStatus === "unrated") &&
      (parsed.playedStatus === "all" ||
        parsed.playedStatus === "played" ||
        parsed.playedStatus === "unplayed") &&
      (parsed.playerCount === null || typeof parsed.playerCount === "number")
    ) {
      return parsed;
    }
  } catch {
    // Corrupt data, fall back
  }
  return DEFAULT_FILTERS;
}

export function saveFilters(filters: FilterState): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Storage full or unavailable
  }
}

// ---------------------------------------------------------------------------
// Filter predicate (REQ-CFS-18)
// ---------------------------------------------------------------------------

export function matchesFilters(gws: GameWithScore, filters: FilterState): boolean {
  const { game, score } = gws;
  const numPlays = game?.numPlays ?? 0;

  if (filters.search && !game.name.toLowerCase().includes(filters.search.toLowerCase())) {
    return false;
  }

  // A predicted-only game has score !== null but ratedAxisCount === 0.
  // For filter purposes, classify it as "unrated" based on actual ratings.
  const isActuallyRated =
    score !== null && (score.predictionMeta === null || score.ratedAxisCount > 0);
  if (filters.ratedStatus === "rated" && !isActuallyRated) return false;
  if (filters.ratedStatus === "unrated" && isActuallyRated) return false;

  if (filters.playedStatus === "played" && numPlays === 0) return false;
  if (filters.playedStatus === "unplayed" && numPlays > 0) return false;

  if (filters.playerCount !== null) {
    if (game.minPlayers == null || game.maxPlayers == null) return false;
    if (game.minPlayers > filters.playerCount || game.maxPlayers < filters.playerCount) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Sort comparator
// ---------------------------------------------------------------------------

type SortValue = number | string | null;

export function getSortValue(
  gws: GameWithScore,
  field: string,
  tournamentStats: Record<string, TournamentGameStatsDisplay>,
  axes?: Axis[],
): SortValue {
  const { game, score } = gws;
  switch (field) {
    case "fitness":
      return score?.score ?? null;
    case "redundancy":
      return score?.redundancyAdjustment?.penalty ?? null;
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
    case "numPlays":
      return game.numPlays;
    case "playTime":
      return game.playingTime;
    case "bggRating":
      return game.bggData?.communityRating ?? null;
    case "bggWeight":
      return game.bggData?.weight ?? null;
    default:
      if (field.startsWith("axis:")) {
        const axisId = field.slice(5);
        if (axes) {
          const resolved = resolveAxisValues(game, axes);
          return resolved[axisId] ?? null;
        }
        return game.ratings[axisId] ?? null;
      }
      return null;
  }
}

export function sortGames(
  games: GameWithScore[],
  field: string,
  direction: "asc" | "desc",
  tournamentStats: Record<string, TournamentGameStatsDisplay>,
  axes?: Axis[],
): { withValue: GameWithScore[]; withoutValue: GameWithScore[] } {
  const withValue: GameWithScore[] = [];
  const withoutValue: GameWithScore[] = [];

  for (const g of games) {
    const v = getSortValue(g, field, tournamentStats, axes);
    if (v === null) {
      withoutValue.push(g);
    } else {
      withValue.push(g);
    }
  }

  const dir = direction === "asc" ? 1 : -1;
  withValue.sort((a, b) => {
    const av = getSortValue(a, field, tournamentStats, axes)!;
    const bv = getSortValue(b, field, tournamentStats, axes)!;
    if (typeof av === "string" && typeof bv === "string") {
      return dir * av.localeCompare(bv);
    }
    return dir * ((av as number) - (bv as number));
  });

  withoutValue.sort((a, b) => a.game.name.localeCompare(b.game.name));

  return { withValue, withoutValue };
}

// ---------------------------------------------------------------------------
// Score display
// ---------------------------------------------------------------------------

export interface ScoreDisplay {
  text: string;
  className: string;
  dotClass?: string;
  isFitnessValue?: boolean;
}

export function getScoreDisplay(
  gws: GameWithScore,
  field: string,
  tournamentStats: Record<string, TournamentGameStatsDisplay>,
  axes?: Axis[],
): ScoreDisplay {
  const { game, score } = gws;

  switch (field) {
    case "fitness":
    case "name": {
      if (!score || !score.score) return { text: "not rated", className: "score-unrated" };
      return {
        text: score.score.toFixed(1),
        className: "score-value",
        dotClass: scoreRangeClass(score.score),
        isFitnessValue: true,
      };
    }
    case "redundancy": {
      if (!score) return { text: "not rated", className: "score-unrated" };
      const adj = score.redundancyAdjustment;
      const val = adj ? adj.penalty : null;
      if (val == null) return { text: "no penalty", className: "score-unrated" };
      return {
        text: val.toFixed(1),
        className: "score-value",
        dotClass: scoreRangeClass(val),
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
          ? `${game.minPlayers}`
          : `${game.minPlayers}-${game.maxPlayers}`;
      return { text: range, className: "score-value" };
    }
    case "numPlays":
      return {
        text: String(game.numPlays ?? 0),
        className: "score-value",
      };
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
        if (axes) {
          const resolved = resolveAxisValues(game, axes);
          const value = resolved[axisId];
          if (value == null) return { text: "---", className: "score-value" };
          return { text: String(value), className: "score-value axis-score" };
        }
        const rating = game.ratings[axisId];
        if (rating == null) return { text: "---", className: "score-value" };
        return { text: String(rating), className: "score-value axis-score" };
      }
      return { text: "---", className: "score-value" };
    }
  }
}

// ---------------------------------------------------------------------------
// Separator label
// ---------------------------------------------------------------------------

export function getSeparatorLabel(field: string, count: number, axes: Axis[]): string | null {
  if (field === "name") return null;
  const n = `${count} game${count !== 1 ? "s" : ""}`;
  switch (field) {
    case "fitness":
      return `Not yet rated - ${n}`;
    case "redundancy":
      return `Not yet rated - ${n}`;
    case "tournament":
      return `Not yet ranked - ${n}`;
    case "playerCount":
      return `No player count data - ${n}`;
    case "numPlays":
      return `No play count data - ${n}`;
    case "playTime":
      return `No play time data - ${n}`;
    case "bggRating":
      return `No BGG rating data - ${n}`;
    case "bggWeight":
      return `No BGG weight data - ${n}`;
    case "yearPublished":
      return `No year published - ${n}`;
    case "createdAt":
    case "updatedAt":
      return null;
    default: {
      if (field.startsWith("axis:")) {
        const axisId = field.slice(5);
        const axis = axes.find((a) => a.id === axisId);
        const axisName = axis?.name ?? "unknown";
        return `No rating on \u2018${axisName}\u2019 - ${n}`;
      }
      return `No data - ${n}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Score column header subtitle
// ---------------------------------------------------------------------------

export function getScoreSubtitle(field: string, axes: Axis[]): string {
  switch (field) {
    case "fitness":
    case "name":
      return "Fitness";
    case "redundancy":
      return "Penalty";
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
    case "numPlays":
      return "Number of Plays";
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
