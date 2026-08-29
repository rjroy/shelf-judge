import type { Metadata } from "next";
import {
  listGames,
  listAxes,
  getAllTournamentStats,
  listGamesWithPredictions,
  getNicheSettings,
  getRedundancySettings,
  getShelfCapacity,
} from "@/lib/api";
import type {
  TournamentGameStatsDisplay,
  NicheTagFilter,
  ShelfCapacityResult,
} from "@shelf-judge/shared";
import { RefreshAllButton } from "@/components/refresh-all-button";
import { NormalizeFitnessButton } from "@/components/normalize-fitness-button";
import { CollectionTable } from "@/components/collection-table";

export const metadata: Metadata = { title: "Collection" };
export const dynamic = "force-dynamic";

function singularParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const showPrevOwned = params.ownership === "all";
  // Server-side cull filter from capacity surfaces (REQ-SHELF-31).
  const missingDimensionsOnly = params.dimensions === "missing";
  const collectionContext = singularParam(params.collectionContext);
  const collectionOrigin = singularParam(params.collectionOrigin);
  const collectionReturnAttempt =
    params.collectionContext !== undefined || params.collectionOrigin !== undefined;

  let games;
  let predictedGames;
  let nicheGames;
  let axes;
  let isIntegrated = false;
  let previouslyOwnedCount = 0;
  let tournamentStats: Record<string, TournamentGameStatsDisplay> = {};
  let ignoredTags: NicheTagFilter[] = [];
  let capacity: ShelfCapacityResult | null = null;
  try {
    const ownershipParam = showPrevOwned ? ("all" as const) : undefined;
    [games, axes] = await Promise.all([listGames({ ownership: "all" }), listAxes()]);

    previouslyOwnedCount = games.filter((g) => g.game.ownership === "previously-owned").length;

    try {
      tournamentStats = await getAllTournamentStats();
    } catch {
      // Tournament data may not exist yet
    }
    try {
      predictedGames = await listGamesWithPredictions();
    } catch {
      // Prediction data may not be available
    }
    try {
      nicheGames = await listGames({ includeNiches: true, ownership: ownershipParam });
    } catch {
      // Niche data may not be available
    }
    try {
      const nicheSettings = await getNicheSettings();
      ignoredTags = nicheSettings.ignoredTags;
    } catch {
      // Niche settings may not be available
    }
    try {
      const redundancySettings = await getRedundancySettings();
      isIntegrated = redundancySettings.enabled && redundancySettings.stage === "integrated";
    } catch {
      // Redundancy settings may not be available
    }
    try {
      capacity = await getShelfCapacity();
    } catch (err) {
      console.warn("Failed to load shelf capacity:", err);
    }
  } catch {
    return (
      <div className="error-banner">
        Could not connect to the shelf-judge daemon. Is it running?
      </div>
    );
  }

  const hasTournamentData = Object.keys(tournamentStats).length > 0;

  // Exclude predicted-only scores and previously-owned from the "rated" average
  const ownedGames = games.filter((g) => g.game.ownership !== "previously-owned");
  const rated = ownedGames.filter(({ score }) => score !== null);
  const avgFitness =
    rated.length > 0
      ? rated.reduce((sum, { score }) => sum + (score?.score ?? 0), 0) / rated.length
      : null;

  console.log(
    `CollectionPage data: ${games.length} total games, ${predictedGames ? predictedGames.length : 0} predicted games, ${nicheGames ? nicheGames.length : 0} niche games, ${axes.length} axes, previously owned count: ${previouslyOwnedCount}, avg fitness: ${avgFitness}, hasTournamentData: ${hasTournamentData}, ignoredTags: ${ignoredTags.length}, isIntegratedRedundancy: ${isIntegrated}`,
  );

  const predictedCount = predictedGames
    ? predictedGames.filter(
        (g) => g.score?.predictionMeta !== null && g.score?.predictionMeta !== undefined,
      ).length
    : 0;

  return (
    <>
      <div className="topbar">
        <h1 id="collection-heading" className="topbar-title" tabIndex={-1}>
          My Collection
        </h1>
        {games.length > 0 && (
          <div className="topbar-meta">
            <NormalizeFitnessButton />
            <RefreshAllButton />
          </div>
        )}
      </div>

      <div className="main-scroll">
        <CollectionTable
          games={games}
          predictedGames={predictedGames ?? null}
          nicheGames={nicheGames ?? null}
          axes={axes}
          tournamentStats={tournamentStats}
          hasTournamentData={hasTournamentData}
          totalGames={ownedGames.length}
          ratedCount={rated.length}
          avgFitness={avgFitness}
          predictedCount={predictedCount > 0 ? predictedCount : 0}
          ignoredTags={ignoredTags}
          isIntegratedRedundancy={isIntegrated}
          previouslyOwnedCount={previouslyOwnedCount}
          showPreviouslyOwned={showPrevOwned}
          missingDimensionsOnly={missingDimensionsOnly}
          capacity={capacity}
          collectionContext={collectionContext}
          collectionOrigin={collectionOrigin}
          collectionReturnAttempt={collectionReturnAttempt}
        />
      </div>
    </>
  );
}
