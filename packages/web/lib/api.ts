// Daemon API client for server-side use (Next.js server components).
// Client components go through the /api/daemon/[...path] proxy instead.

import type {
  Game,
  Axis,
  FitnessResult,
  FitnessBreakdownEntry,
  GameWithScore,
  AddGameResult,
  BggSearchResult,
  ImportProgress,
  ImportComplete,
  PreferenceShape,
  ToleranceLevel,
  LeanDirection,
  VetoConfig,
} from "@shelf-judge/shared";
import { daemonRequest, daemonJson } from "./daemon";

export async function listGames(): Promise<GameWithScore[]> {
  return daemonJson("/api/games");
}

export async function getGame(id: string): Promise<GameWithScore> {
  return daemonJson(`/api/games/${id}`);
}

export async function addGame(
  body: { bggId: number } | { name: string; yearPublished?: number },
): Promise<AddGameResult> {
  const { response: res } = await daemonRequest("/api/games", {
    method: "POST",
    body,
  });
  if (res.status === 409) {
    const data = (await res.json()) as { error?: string };
    throw new Error(data.error ?? "Duplicate game");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
      error?: string;
    };
    throw new Error(data.error ?? `Failed to add game: ${res.status}`);
  }
  return res.json() as Promise<AddGameResult>;
}

export async function rateGame(
  id: string,
  ratings: Record<string, number>,
): Promise<GameWithScore> {
  return daemonJson(`/api/games/${id}/ratings`, {
    method: "PUT",
    body: { ratings },
  });
}

export async function removeGame(id: string): Promise<void> {
  const { response: res } = await daemonRequest(`/api/games/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to remove game: ${res.status}`);
}

export async function refreshBggData(id: string): Promise<{ game: Game }> {
  return daemonJson(`/api/games/${id}/refresh`, { method: "POST" });
}

export async function refreshAllBggData(): Promise<{ refreshed: number; errors: string[] }> {
  return daemonJson("/api/games/refresh", { method: "POST" });
}

export async function searchGames(query: string): Promise<BggSearchResult[]> {
  return daemonJson(`/api/games/search?q=${encodeURIComponent(query)}`);
}

export async function listAxes(): Promise<Axis[]> {
  return daemonJson("/api/axes");
}

export async function createAxis(body: {
  name: string;
  description?: string;
  weight: number;
  preferenceShape?: PreferenceShape;
  idealValue?: number | null;
  tolerance?: ToleranceLevel;
  leanDirection?: LeanDirection | null;
  veto?: VetoConfig | null;
}): Promise<Axis> {
  return daemonJson("/api/axes", {
    method: "POST",
    body,
  });
}

export async function updateAxis(
  id: string,
  body: {
    name?: string;
    description?: string;
    weight?: number;
    preferenceShape?: PreferenceShape;
    idealValue?: number | null;
    tolerance?: ToleranceLevel;
    leanDirection?: LeanDirection | null;
    veto?: VetoConfig | null;
  },
): Promise<Axis> {
  return daemonJson(`/api/axes/${id}`, {
    method: "PUT",
    body,
  });
}

export async function deleteAxis(id: string): Promise<{ deletedRatingsCount: number }> {
  return daemonJson(`/api/axes/${id}`, { method: "DELETE" });
}

export async function importBggCollection(username: string): Promise<Response> {
  const { response } = await daemonRequest("/api/import/bgg", {
    method: "POST",
    body: { username },
  });
  return response;
}

// Profile API functions

import type { CollectionProfile } from "@shelf-judge/shared";

export async function getProfile(): Promise<CollectionProfile> {
  return daemonJson("/api/profile");
}

// Tournament API functions

import type {
  TournamentSession,
  SessionFilter,
  TournamentGameStatsDisplay,
  Comparison,
  TournamentSettings,
} from "@shelf-judge/shared";

export async function getActiveSession(): Promise<TournamentSession | null> {
  try {
    return await daemonJson("/api/tournament/sessions/active");
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

export async function startTournamentSession(
  filters?: SessionFilter[],
): Promise<{ session: TournamentSession }> {
  return daemonJson("/api/tournament/sessions", {
    method: "POST",
    body: filters ? { filters } : {},
  });
}

export async function endSession(id: string): Promise<{ session: TournamentSession }> {
  return daemonJson(`/api/tournament/sessions/${id}/end`, { method: "POST" });
}

export async function getNextPair(sessionId: string): Promise<{
  done?: boolean;
  gameA?: Game;
  gameB?: Game;
  gameAStats?: TournamentGameStatsDisplay;
  gameBStats?: TournamentGameStatsDisplay;
}> {
  return daemonJson(`/api/tournament/sessions/${sessionId}/next`);
}

export async function submitComparison(
  sessionId: string,
  gameAId: string,
  gameBId: string,
  winnerId: string,
): Promise<{
  comparison: Comparison;
  updatedStats: { gameA: TournamentGameStatsDisplay; gameB: TournamentGameStatsDisplay };
}> {
  return daemonJson(`/api/tournament/sessions/${sessionId}/compare`, {
    method: "POST",
    body: { gameAId, gameBId, winnerId },
  });
}

export async function getTournamentGameStats(gameId: string): Promise<TournamentGameStatsDisplay> {
  return daemonJson(`/api/tournament/games/${gameId}/stats`);
}

export async function getAllTournamentStats(): Promise<Record<string, TournamentGameStatsDisplay>> {
  const entries =
    await daemonJson<{ gameId: string; gameName: string; stats: TournamentGameStatsDisplay }[]>(
      "/api/tournament/stats",
    );
  return Object.fromEntries(entries.map((e) => [e.gameId, e.stats]));
}

export async function getTournamentSettings(): Promise<TournamentSettings> {
  return daemonJson("/api/tournament/settings");
}

export async function listTournamentSessions(): Promise<TournamentSession[]> {
  return daemonJson("/api/tournament/sessions");
}

// Prediction API functions

import type { PredictionReadiness, PredictedGameResponse } from "@shelf-judge/shared";

export async function predictGame(id: string): Promise<PredictedGameResponse> {
  return daemonJson(`/api/predictions/${id}`);
}

export async function getReadiness(): Promise<PredictionReadiness> {
  return daemonJson("/api/predictions/readiness");
}

export async function listGamesWithPredictions(): Promise<GameWithScore[]> {
  return daemonJson("/api/games?includePredicted=true");
}

// Re-export types for convenience
export type {
  Game,
  Axis,
  FitnessResult,
  FitnessBreakdownEntry,
  GameWithScore,
  AddGameResult,
  BggSearchResult,
  ImportProgress,
  ImportComplete,
  CollectionProfile,
  PredictionReadiness,
};
