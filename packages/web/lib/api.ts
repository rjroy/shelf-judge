// Daemon API client for server-side use.
// Uses Bun's fetch with unix socket option to talk directly to the daemon.
// Client components go through the /api/daemon/[...path] proxy instead.

import type { Game, Axis, FitnessResult, FitnessBreakdownEntry } from "@shelf-judge/shared";

const SOCKET_PATH = process.env.SHELF_JUDGE_SOCKET ?? "/tmp/shelf-judge.sock";
const DAEMON_BASE = "http://localhost";

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

async function daemonFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${DAEMON_BASE}${path}`;
  return fetch(url, {
    ...init,
    // @ts-expect-error Bun extension for unix socket transport
    unix: SOCKET_PATH,
  });
}

export async function listGames(): Promise<GameWithScore[]> {
  const res = await daemonFetch("/api/games");
  if (!res.ok) throw new Error(`Failed to list games: ${res.status}`);
  return res.json();
}

export async function getGame(id: string): Promise<GameWithScore> {
  const res = await daemonFetch(`/api/games/${id}`);
  if (!res.ok) throw new Error(`Failed to get game: ${res.status}`);
  return res.json();
}

export async function addGame(
  body: { bggId: number } | { name: string; yearPublished?: number },
): Promise<AddGameResult> {
  const res = await daemonFetch("/api/games", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  const res = await daemonFetch(`/api/games/${id}/ratings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ratings }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error ?? `Failed to rate game: ${res.status}`);
  }
  return res.json();
}

export async function removeGame(id: string): Promise<void> {
  const res = await daemonFetch(`/api/games/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to remove game: ${res.status}`);
}

export async function refreshBggData(id: string): Promise<{ game: Game }> {
  const res = await daemonFetch(`/api/games/${id}/refresh`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error ?? `Failed to refresh: ${res.status}`);
  }
  return res.json();
}

export async function searchGames(query: string): Promise<BggSearchResult[]> {
  const res = await daemonFetch(`/api/games/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error ?? `Failed to search: ${res.status}`);
  }
  return res.json();
}

export async function listAxes(): Promise<Axis[]> {
  const res = await daemonFetch("/api/axes");
  if (!res.ok) throw new Error(`Failed to list axes: ${res.status}`);
  return res.json();
}

export async function createAxis(body: {
  name: string;
  description?: string;
  weight: number;
}): Promise<Axis> {
  const res = await daemonFetch("/api/axes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error ?? `Failed to create axis: ${res.status}`);
  }
  return res.json();
}

export async function updateAxis(
  id: string,
  body: { name?: string; description?: string; weight?: number },
): Promise<Axis> {
  const res = await daemonFetch(`/api/axes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error ?? `Failed to update axis: ${res.status}`);
  }
  return res.json();
}

export async function deleteAxis(id: string): Promise<{ deletedRatingsCount: number }> {
  const res = await daemonFetch(`/api/axes/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(data.error ?? `Failed to delete axis: ${res.status}`);
  }
  return res.json();
}

export async function importBggCollection(username: string): Promise<Response> {
  // Returns the raw response so the caller can read the SSE stream
  return daemonFetch("/api/import/bgg", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
}

// Re-export types for convenience
export type { Game, Axis, FitnessResult, FitnessBreakdownEntry };
