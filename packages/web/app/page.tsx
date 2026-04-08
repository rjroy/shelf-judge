import type { Metadata } from "next";
import Link from "next/link";
import { listGames, listAxes, getAllTournamentStats } from "@/lib/api";
import type { TournamentGameStatsDisplay } from "@shelf-judge/shared";
import { RefreshAllButton } from "@/components/refresh-all-button";
import { NormalizeFitnessButton } from "@/components/normalize-fitness-button";
import { CollectionTable } from "@/components/collection-table";

export const metadata: Metadata = { title: "Shelf Judge" };
export const dynamic = "force-dynamic";

export default async function CollectionPage() {
  let games;
  let axes;
  let tournamentStats: Record<string, TournamentGameStatsDisplay> = {};
  try {
    [games, axes] = await Promise.all([listGames(), listAxes()]);
    try {
      tournamentStats = await getAllTournamentStats();
    } catch {
      // Tournament data may not exist yet
    }
  } catch {
    return (
      <div className="error-banner">
        Could not connect to the shelf-judge daemon. Is it running?
      </div>
    );
  }

  const hasTournamentData = Object.keys(tournamentStats).length > 0;

  const rated = games.filter(({ score }) => score !== null);
  const avgFitness =
    rated.length > 0
      ? rated.reduce((sum, { score }) => sum + (score?.score ?? 0), 0) / rated.length
      : null;

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
        <CollectionTable
          games={games}
          axes={axes}
          tournamentStats={tournamentStats}
          hasTournamentData={hasTournamentData}
          totalGames={games.length}
          ratedCount={rated.length}
          avgFitness={avgFitness}
        />
      </div>
    </>
  );
}
