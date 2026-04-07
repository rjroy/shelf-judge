import type { Metadata } from "next";
import Link from "next/link";
import { listGames, listAxes, getAllTournamentStats } from "@/lib/api";
import type { TournamentGameStatsDisplay } from "@shelf-judge/shared";
import { RefreshAllButton } from "@/components/refresh-all-button";
import { CollectionTable } from "@/components/collection-table";

export const metadata: Metadata = { title: "Collection" };
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
          <Link href="/import" className="btn btn-secondary">
            Import BGG
          </Link>
          <Link href="/search" className="btn btn-primary">
            Add Game
          </Link>
          <RefreshAllButton />
        </div>
      </div>

      <div className="main-scroll">
        <div className="stats-strip">
          <div className="stat-block">
            <div className="stat-value">{games.length}</div>
            <div className="stat-label">Games</div>
          </div>
          <div className="stat-block">
            <div className="stat-value score">
              {avgFitness !== null ? avgFitness.toFixed(1) : "-"}
            </div>
            <div className="stat-label">Avg Fitness</div>
          </div>
          <div className="stat-block">
            <div className="stat-value">{rated.length}</div>
            <div className="stat-label">Rated</div>
          </div>
          <div className="stat-block">
            <div className="stat-value">{axes.length}</div>
            <div className="stat-label">Axes</div>
          </div>
        </div>

        <CollectionTable
          games={games}
          axes={axes}
          tournamentStats={tournamentStats}
          hasTournamentData={hasTournamentData}
        />
      </div>
    </>
  );
}
