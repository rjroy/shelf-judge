import type {
  Axis,
  Game,
  GameWithPurchaseUtilization,
  NicheTagFilter,
  ShelfCapacityResult,
  TournamentGameStatsDisplay,
  CollectionSnapshot,
} from "@shelf-judge/shared";

/** Typed input matching CollectionTable's data props (navigation props are supplied by the page). */
export interface CollectionSnapshotTableData {
  readonly games: GameWithPurchaseUtilization[];
  readonly ownerNotePresence: Record<string, boolean>;
  readonly predictedGames: GameWithPurchaseUtilization[] | null;
  readonly nicheGames: GameWithPurchaseUtilization[] | null;
  readonly axes: Axis[];
  readonly tournamentStats: Record<string, TournamentGameStatsDisplay>;
  readonly hasTournamentData: boolean;
  readonly totalGames: number;
  readonly ratedCount: number;
  readonly avgFitness: number | null;
  readonly predictedCount: number;
  readonly ignoredTags: NicheTagFilter[];
  readonly isIntegratedRedundancy: boolean;
  readonly previouslyOwnedCount: number;
  readonly capacity: ShelfCapacityResult | null;
}

/**
 * Compact wire fields mapped for the existing table's read-only contract.
 * Game and Axis are cast at this boundary because their legacy domain types include
 * fields intentionally omitted from the compact snapshot; see projection gaps below.
 */
export function projectCollectionSnapshot(
  snapshot: CollectionSnapshot,
): CollectionSnapshotTableData {
  const projectedGame = (
    row: CollectionSnapshot["games"][number],
    variant: "ordinary" | "predicted",
  ) => {
    const selected =
      variant === "ordinary"
        ? row.ordinary
        : row.predicted.availability === "available"
          ? row.predicted
          : null;
    if (selected === null) return null;
    const game = {
      ...row.game,
      // Table rendering does not inspect acquisition/evidence/metadata fields.
      ratings: Object.fromEntries(
        Object.entries(row.game.ratings).filter(
          (entry): entry is [string, number] => entry[1] !== null,
        ),
      ),
    } as unknown as Game;
    return {
      game,
      score: selected.score,
      displayScore: selected.displayScore,
      purchaseUtilization: selected.purchaseUtilization,
      ...(snapshot.nichePositions.availability === "available"
        ? {
            nichePosition:
              snapshot.nichePositions.positions.find((entry) => entry.gameId === row.game.id)
                ?.position ?? null,
          }
        : {}),
    } as GameWithPurchaseUtilization;
  };

  const games = snapshot.games.map((row) => projectedGame(row, "ordinary")!).filter(Boolean);
  const predictedAvailable = snapshot.games.every(
    (row) => row.predicted.availability === "available",
  );
  const predictedGames = predictedAvailable
    ? snapshot.games.map((row) => projectedGame(row, "predicted")!).filter(Boolean)
    : null;
  const nicheGames =
    snapshot.nichePositions.availability === "available"
      ? snapshot.nichePositions.positions
          .map(({ gameId }) => snapshot.games.find((row) => row.game.id === gameId))
          .filter((row): row is CollectionSnapshot["games"][number] => row !== undefined)
          .map((row) => projectedGame(row, "ordinary")!)
          .filter(Boolean)
      : null;

  const tournamentStats: Record<string, TournamentGameStatsDisplay> = {};
  for (const row of snapshot.games) {
    if (!row.tournament) continue;
    tournamentStats[row.game.id] = { ...row.tournament, recentComparisons: [] };
  }

  return {
    games,
    ownerNotePresence: Object.fromEntries(
      snapshot.games.map((row) => [row.game.id, row.ownerNotePresent]),
    ),
    predictedGames,
    nicheGames,
    axes: snapshot.axes as Axis[],
    tournamentStats,
    // Stats are displayed only when the optional display projection succeeded.
    hasTournamentData: snapshot.games.some((row) => row.tournament !== null),
    totalGames: snapshot.games.filter((row) => row.game.ownership !== "previously-owned").length,
    ratedCount: snapshot.counts.rated,
    avgFitness: snapshot.averageScore,
    predictedCount: snapshot.counts.predicted,
    ignoredTags: snapshot.ignoredTags.map((value) => {
      const separator = value.indexOf(":");
      return {
        type: value.slice(0, separator),
        name: value.slice(separator + 1),
      } as NicheTagFilter;
    }),
    isIntegratedRedundancy: snapshot.redundancyMode === "integrated",
    previouslyOwnedCount: snapshot.games.filter((row) => row.game.ownership === "previously-owned")
      .length,
    capacity:
      snapshot.capacity.availability === "available"
        ? (snapshot.capacity.result as ShelfCapacityResult | null)
        : null,
  };
}

/** Legacy consumer gaps: reduced Game omits evidence/acquisition/shelf metadata; Axis omits descriptive/config fields; tournament recent comparisons are not transferred. */
export const COLLECTION_SNAPSHOT_PROJECTION_GAPS = [
  "Compact Game omits acquisition, evidence, manual shelf, and entity metadata; these are not used by current CollectionTable rendering but are required by the broad Game type.",
  "Compact Axis omits descriptions and timestamps not currently consumed by the table.",
  "Tournament recent comparisons are omitted; current CollectionTable displays aggregate tournament stats only.",
] as const;
