// Daemon API client for server-side use (Next.js server components).
// Client components go through the /api/daemon/[...path] proxy instead.

import type {
  Game,
  OwnershipStatus,
  Axis,
  BoxDimensions,
  FitnessResult,
  FitnessBreakdownEntry,
  GameWithScore,
  AddGameResult,
  BggSearchResult,
  ImportProgress,
  ImportComplete,
  NichePosition,
  NicheEntry,
  NicheNeighbor,
  NicheImpact,
  NicheImpactEntry,
  CreateAxisInput,
  UpdateAxisInput,
  LegacyAxisRepairInput,
  DerivedFieldDiscoveryResponse,
  AcquisitionMutationRequest,
  EntertainmentBenchmark,
  EntertainmentBenchmarkMutationRequest,
  GameWithPurchaseUtilization,
  PlayEvidenceMutationResult,
  OwnershipMutationResult,
  GameDetailWithPurchaseUtilization,
  OwnerGameNoteReadResult,
} from "@shelf-judge/shared";
import {
  GameDetailWithPurchaseUtilizationSchema,
  AddGameResultSchema,
  GameListResponseSchema,
  GameWithScoreSchema,
  OwnerGameNoteReadResultSchema,
  OwnershipMutationResultSchema,
  PlayEvidenceMutationResultSchema,
  PredictedGameResponseSchema,
  PublicGameMutationResultSchema,
  TournamentNextPairResponseSchema,
} from "@shelf-judge/shared";
import { daemonRequest, daemonJson } from "./daemon";

export async function listGames(opts?: {
  includeNiches?: boolean;
  ownership?: "owned" | "previously-owned" | "all";
}): Promise<GameWithPurchaseUtilization[]> {
  const params = new URLSearchParams();
  if (opts?.includeNiches) params.set("includeNiches", "true");
  if (opts?.ownership) params.set("ownership", opts.ownership);
  const qs = params.toString();
  return GameListResponseSchema.parse(await daemonJson(`/api/games${qs ? `?${qs}` : ""}`));
}

export async function getGame(
  id: string,
  load: () => Promise<unknown> = () => daemonJson(`/api/games/${id}?includePredicted=true`),
): Promise<GameDetailWithPurchaseUtilization> {
  const result = GameDetailWithPurchaseUtilizationSchema.parse(await load());
  if (result.game.id !== id) throw new Error("Daemon returned detail for a different game.");
  return result;
}

export async function getOwnerGameNote(
  id: string,
  load: () => Promise<unknown> = () => daemonJson(`/api/games/${id}/note`),
): Promise<OwnerGameNoteReadResult> {
  const result = OwnerGameNoteReadResultSchema.parse(await load());
  if (result.gameId !== id) throw new Error("Daemon returned a note for a different game.");
  return result;
}

export async function setGameAcquisition(
  id: string,
  body: AcquisitionMutationRequest,
): Promise<{ game: Game }> {
  const result = PublicGameMutationResultSchema.parse(
    await daemonJson(`/api/games/${id}/acquisition`, { method: "PUT", body }),
  );
  if (result.game.id !== id) throw new Error("Daemon returned a game for a different request.");
  return result;
}

export async function getEntertainmentBenchmark(): Promise<{
  entertainmentBenchmark: EntertainmentBenchmark;
}> {
  return daemonJson("/api/collection/entertainment-benchmark");
}

export async function setEntertainmentBenchmark(
  body: EntertainmentBenchmarkMutationRequest,
): Promise<{ entertainmentBenchmark: EntertainmentBenchmark }> {
  return daemonJson("/api/collection/entertainment-benchmark", { method: "PUT", body });
}

export async function clearEntertainmentBenchmark(): Promise<{
  entertainmentBenchmark: EntertainmentBenchmark;
}> {
  return daemonJson("/api/collection/entertainment-benchmark", { method: "DELETE" });
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
  return AddGameResultSchema.parse(await res.json());
}

export async function rateGame(
  id: string,
  ratings: Record<string, number | null>,
): Promise<GameWithScore> {
  const result = GameWithScoreSchema.parse(
    await daemonJson(`/api/games/${id}/ratings`, {
      method: "PUT",
      body: { ratings },
    }),
  );
  if (result.game.id !== id) throw new Error("Daemon returned a game for a different request.");
  return result;
}

export async function removeGame(id: string): Promise<void> {
  const { response: res } = await daemonRequest(`/api/games/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to remove game: ${res.status}`);
}

export async function setGameOwnership(
  id: string,
  ownership: "owned" | "previously-owned",
  load: () => Promise<unknown> = () =>
    daemonJson(`/api/games/${id}/ownership`, {
      method: "PATCH",
      body: { ownership },
    }),
): Promise<OwnershipMutationResult> {
  const result = OwnershipMutationResultSchema.parse(await load());
  if (result.game.id !== id || result.game.ownership !== ownership) {
    throw new Error("Daemon returned a game for a different ownership request.");
  }
  return result;
}

export async function setGameDimensions(
  id: string,
  dimensions: { width: number; height: number; depth: number } | { clear: true },
): Promise<{ game: Game }> {
  const result = PublicGameMutationResultSchema.parse(
    await daemonJson(`/api/games/${id}/dimensions`, {
      method: "PUT",
      body: dimensions,
    }),
  );
  if (result.game.id !== id) throw new Error("Daemon returned a game for a different request.");
  return result;
}

export async function refreshBggData(
  id: string,
  load: () => Promise<unknown> = () => daemonJson(`/api/games/${id}/refresh`, { method: "POST" }),
): Promise<PlayEvidenceMutationResult> {
  const result = PlayEvidenceMutationResultSchema.parse(await load());
  if (result.game.id !== id) throw new Error("Daemon returned a game for a different refresh.");
  return result;
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

export async function getDerivedFields(): Promise<DerivedFieldDiscoveryResponse> {
  return daemonJson("/api/axes/derived-fields");
}

export async function createAxis(body: CreateAxisInput): Promise<Axis> {
  return daemonJson("/api/axes", {
    method: "POST",
    body,
  });
}

export async function updateAxis(id: string, body: UpdateAxisInput): Promise<Axis> {
  return daemonJson(`/api/axes/${id}`, {
    method: "PUT",
    body,
  });
}

export async function repairLegacyAxis(id: string, body: LegacyAxisRepairInput): Promise<Axis> {
  return daemonJson(`/api/axes/${id}/repair`, { method: "POST", body });
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

import {
  CollectionProfileEntityPolicySchema,
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  createCollectionProfileResultSchema,
} from "@shelf-judge/shared";
import type { CollectionProfileEntityPolicy, CollectionProfileResult } from "@shelf-judge/shared";

function parseCollectionProfileResponse(
  response: unknown,
  entityPolicy: CollectionProfileEntityPolicy,
): CollectionProfileResult {
  const parsed = createCollectionProfileResultSchema(entityPolicy).safeParse(response);
  if (!parsed.success) {
    throw new Error(`Invalid profile response: ${parsed.error.message}`);
  }
  return parsed.data;
}

function profileEntityPolicy(response: unknown): CollectionProfileEntityPolicy {
  if (
    typeof response === "object" &&
    response !== null &&
    "status" in response &&
    response.status === "available" &&
    "entityPolicy" in response
  ) {
    return CollectionProfileEntityPolicySchema.parse(response.entityPolicy);
  }
  return DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY;
}

export async function getProfile(
  load: () => Promise<unknown> = () => daemonJson("/api/profile"),
): Promise<CollectionProfileResult> {
  const response = await load();
  return parseCollectionProfileResponse(response, profileEntityPolicy(response));
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
  return TournamentNextPairResponseSchema.parse(
    await daemonJson(`/api/tournament/sessions/${sessionId}/next`),
  );
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
  const result = PredictedGameResponseSchema.parse(await daemonJson(`/api/predictions/${id}`));
  if (result.game.id !== id) throw new Error("Daemon returned a game for a different prediction.");
  return result;
}

export async function predictBggGame(bggId: number): Promise<PredictedGameResponse> {
  return PredictedGameResponseSchema.parse(await daemonJson(`/api/predictions/bgg/${bggId}`));
}

export async function getReadiness(): Promise<PredictionReadiness> {
  return daemonJson("/api/predictions/readiness");
}

export async function listGamesWithPredictions(): Promise<GameWithPurchaseUtilization[]> {
  return GameListResponseSchema.parse(
    await daemonJson("/api/games?includePredicted=true&&ownership=all"),
  );
}

// Niche settings API functions

import type { NicheSettings, NicheTagFilter } from "@shelf-judge/shared";

export async function getNicheSettings(): Promise<NicheSettings> {
  return daemonJson("/api/niches/settings");
}

export async function updateNicheSettings(patch: Partial<NicheSettings>): Promise<NicheSettings> {
  return daemonJson("/api/niches/settings", {
    method: "PATCH",
    body: patch,
  });
}

export async function ignoreNicheTag(tag: NicheTagFilter): Promise<NicheSettings> {
  return daemonJson("/api/niches/settings/ignore", {
    method: "POST",
    body: tag,
  });
}

export async function unignoreNicheTag(tag: NicheTagFilter): Promise<NicheSettings> {
  return daemonJson("/api/niches/settings/ignore", {
    method: "DELETE",
    body: tag,
  });
}

// Shelf configuration API functions

import type {
  Shelf,
  ShelfUnit,
  ShelfConfiguration,
  ShelfConfigMutationResult,
  ShelfUnitMutationResult,
  ShelfUnitRemovalResult,
  ShelfCapacityResult,
  ShelfAssignment,
  AssignedGame,
  UnfittableEntry,
  OverflowEntry,
} from "@shelf-judge/shared";

export async function getShelfConfig(): Promise<ShelfConfiguration> {
  return daemonJson("/api/shelf/config");
}

export async function setShelfConfig(units: ShelfUnit[]): Promise<ShelfConfigMutationResult> {
  return daemonJson("/api/shelf/config", { method: "PUT", body: { units } });
}

export async function addShelfUnit(input: {
  name: string;
  shelves: Array<{ name: string; width: number; height: number | null; depth: number }>;
}): Promise<ShelfUnit> {
  return daemonJson("/api/shelf/units", { method: "POST", body: input });
}

export async function updateShelfUnit(
  id: string,
  input: {
    name?: string;
    shelves?: Array<{
      id?: string;
      name: string;
      width: number;
      height: number | null;
      depth: number;
    }>;
  },
): Promise<ShelfUnitMutationResult> {
  return daemonJson(`/api/shelf/units/${id}`, { method: "PUT", body: input });
}

export async function removeShelfUnit(id: string): Promise<ShelfUnitRemovalResult> {
  return daemonJson(`/api/shelf/units/${id}`, { method: "DELETE" });
}

export async function getShelfCapacity(): Promise<ShelfCapacityResult> {
  return daemonJson("/api/shelf/capacity");
}

export async function setGameShelfAssignment(
  gameId: string,
  shelfId: string | null,
): Promise<{ game: import("@shelf-judge/shared").Game }> {
  const result = PublicGameMutationResultSchema.parse(
    await daemonJson(`/api/games/${gameId}/shelf-assignment`, {
      method: "PUT",
      body: { shelfId },
    }),
  );
  if (result.game.id !== gameId) throw new Error("Daemon returned a game for a different request.");
  return result;
}

// Redundancy settings API functions

import type {
  RedundancySettings,
  RedundancyAdjustment,
  RedundancyNeighbor,
} from "@shelf-judge/shared";

export async function getRedundancySettings(): Promise<RedundancySettings> {
  return daemonJson("/api/redundancy/settings");
}

export async function updateRedundancySettings(
  patch: Partial<RedundancySettings>,
): Promise<RedundancySettings> {
  return daemonJson("/api/redundancy/settings", {
    method: "PATCH",
    body: patch,
  });
}

// Wishlist API functions

import type { WishlistEntry, WishlistBreakdownEntry } from "@shelf-judge/shared";

export async function listWishlist(): Promise<WishlistEntry[]> {
  return daemonJson("/api/wishlist");
}

export async function addToWishlist(bggId: number): Promise<{ entry: WishlistEntry }> {
  return daemonJson("/api/wishlist", {
    method: "POST",
    body: { bggId },
  });
}

export async function removeFromWishlist(id: string): Promise<{ removed: boolean }> {
  return daemonJson(`/api/wishlist/${id}`, { method: "DELETE" });
}

export async function clearWishlist(): Promise<{ removed: number }> {
  return daemonJson("/api/wishlist", { method: "DELETE" });
}

export async function refreshWishlistEntry(id: string): Promise<{ entry: WishlistEntry }> {
  return daemonJson(`/api/wishlist/${id}/refresh`, { method: "POST" });
}

export async function refreshAllWishlist(): Promise<{ refreshed: number; errors: string[] }> {
  return daemonJson("/api/wishlist/refresh", { method: "POST" });
}

// Re-export types for convenience
export type {
  Game,
  OwnershipStatus,
  Axis,
  BoxDimensions,
  FitnessResult,
  FitnessBreakdownEntry,
  GameWithScore,
  AddGameResult,
  BggSearchResult,
  ImportProgress,
  ImportComplete,
  CollectionProfileResult,
  PredictionReadiness,
  NichePosition,
  NicheEntry,
  NicheNeighbor,
  NicheImpact,
  NicheImpactEntry,
  NicheSettings,
  NicheTagFilter,
  RedundancySettings,
  RedundancyAdjustment,
  RedundancyNeighbor,
  WishlistEntry,
  WishlistBreakdownEntry,
  Shelf,
  ShelfUnit,
  ShelfConfiguration,
  ShelfCapacityResult,
  ShelfAssignment,
  AssignedGame,
  UnfittableEntry,
  OverflowEntry,
  AcquisitionMutationRequest,
  EntertainmentBenchmark,
  EntertainmentBenchmarkMutationRequest,
  GameWithPurchaseUtilization,
};
