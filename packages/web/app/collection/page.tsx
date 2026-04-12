import type { Metadata } from "next";
import Link from "next/link";
import {
  listGames,
  listAxes,
  getAllTournamentStats,
  listGamesWithPredictions,
  getNicheSettings,
  getRedundancySettings,
} from "@/lib/api";
import type { TournamentGameStatsDisplay, NicheTagFilter } from "@shelf-judge/shared";
import { RefreshAllButton } from "@/components/refresh-all-button";
import { NormalizeFitnessButton } from "@/components/normalize-fitness-button";
import { CollectionTable } from "@/components/collection-table";
import { RedundancySettingsPanel } from "@/components/redundancy-settings";

export const metadata: Metadata = { title: "Collection" };
export const dynamic = "force-dynamic";

export default async function CollectionPage() {
  let games;
  let predictedGames;
  let nicheGames;
  let axes;
  let isIntegrated = false;
  let tournamentStats: Record<string, TournamentGameStatsDisplay> = {};
  let ignoredTags: NicheTagFilter[] = [];
  try {
    [games, axes] = await Promise.all([listGames(), listAxes()]);
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
      nicheGames = await listGames({ includeNiches: true });
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
  } catch {
    return (
      <div className="error-banner">
        Could not connect to the shelf-judge daemon. Is it running?
      </div>
    );
  }

  const hasTournamentData = Object.keys(tournamentStats).length > 0;

  // Exclude predicted-only scores from the "rated" average
  const rated = games.filter(({ score }) => score !== null);
  const avgFitness =
    rated.length > 0
      ? rated.reduce((sum, { score }) => sum + (score?.score ?? 0), 0) / rated.length
      : null;

  const predictedCount = predictedGames
    ? predictedGames.filter(
        (g) => g.score?.predictionMeta !== null && g.score?.predictionMeta !== undefined,
      ).length
    : 0;

  if (games.length === 0) {
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">My Collection</div>
        </div>
        <div className="main-scroll">
          <div className="empty-state">
            <h3>No games yet</h3>
            <p>Add games to your collection to start rating and tracking fitness scores.</p>
            <div className="empty-state-actions">
              <Link href="/import" className="btn btn-secondary">
                Import BGG Collection
              </Link>
              <Link href="/search" className="btn btn-primary">
                Add Game
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">My Collection</div>
        <div className="topbar-meta">
          <span>
            {games.length} game{games.length !== 1 && "s"} &middot; {axes.length} ax
            {axes.length === 1 ? "is" : "es"}
          </span>
          <NormalizeFitnessButton />
          <RefreshAllButton />
        </div>
      </div>

      <div className="main-scroll">
        <RedundancySettingsPanel />
        <CollectionTable
          games={games}
          predictedGames={predictedGames ?? null}
          nicheGames={nicheGames ?? null}
          axes={axes}
          tournamentStats={tournamentStats}
          hasTournamentData={hasTournamentData}
          totalGames={games.length}
          ratedCount={rated.length}
          avgFitness={avgFitness}
          predictedCount={predictedCount > 0 ? predictedCount : 0}
          ignoredTags={ignoredTags}
          isIntegratedRedundancy={isIntegrated}
        />
      </div>
    </>
  );
}
