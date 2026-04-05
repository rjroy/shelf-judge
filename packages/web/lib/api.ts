// Daemon API client for server-side use (Next.js server components).
// Client components go through the /api/daemon/[...path] proxy instead.

import type { Game, Axis, FitnessResult, FitnessBreakdownEntry } from "@shelf-judge/shared";
import { daemonFetch, daemonJson } from "./daemon";

export interface GameWithScore {
  game: Game;
  score: FitnessResult | null;
}

export interface AddGameResult {
  game: Game;
  bggImported: boolean;
  warning?: string;
}

export interface BggSearchResult {
  bggId: number;
  name: string;
  yearPublished: number | null;
}

export interface ImportProgress {
  imported: number;
  total: number;
  current: string;
}

export interface ImportComplete {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function listGames(): Promise<GameWithScore[]> {
  return daemonJson("/api/games");
}

export async function getGame(id: string): Promise<GameWithScore> {
  return daemonJson(`/api/games/${id}`);
}

export async function addGame(
  body: { bggId: number } | { name: string; yearPublished?: number },
): Promise<AddGameResult> {
  const res = await daemonFetch("/api/games", {
    method: "POST",
    body,
  });
  if (res.status === 409) {
    const data = await res.json();
    throw new Error(data.error ?? "Duplicate game");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error ?? `Failed to add game: ${res.status}`);
  }
  return res.json();
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
  const res = await daemonFetch(`/api/games/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to remove game: ${res.status}`);
}

export async function refreshBggData(id: string): Promise<{ game: Game }> {
  return daemonJson(`/api/games/${id}/refresh`, { method: "POST" });
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
}): Promise<Axis> {
  return daemonJson("/api/axes", {
    method: "POST",
    body,
  });
}

export async function updateAxis(
  id: string,
  body: { name?: string; description?: string; weight?: number },
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
  return daemonFetch("/api/import/bgg", {
    method: "POST",
    body: { username },
  });
}

// Re-export types for convenience
export type { Game, Axis, FitnessResult, FitnessBreakdownEntry };
