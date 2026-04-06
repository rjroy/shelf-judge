import type { Metadata } from "next";
import Link from "next/link";
import { listGames, listAxes } from "@/lib/api";
import { RefreshAllButton } from "@/components/refresh-all-button";
import { scoreRangeClass } from "@/lib/score-utils";

export const metadata: Metadata = { title: "Collection" };
export const dynamic = "force-dynamic";

function relativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hr ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  if (diffWeek === 1) return "1 week ago";
  if (diffWeek < 5) return `${diffWeek} weeks ago`;
  if (diffMonth === 1) return "1 month ago";
  return `${diffMonth} months ago`;
}

export default async function CollectionPage() {
  let games;
  let axes;
  try {
    [games, axes] = await Promise.all([listGames(), listAxes()]);
  } catch {
    return (
      <div className="error-banner">
        Could not connect to the shelf-judge daemon. Is it running?
      </div>
    );
  }

  const axisMap = new Map(axes.map((a) => [a.id, a.name]));

  const rated = games
    .filter(({ score }) => score !== null)
    .sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0));
  const unrated = games.filter(({ score }) => score === null);

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

        <div className="collection-header">
          <div className="rank">#</div>
          <div className="game-thumb-col"></div>
          <div className="game-info-col">Game</div>
          <div className="axes-used-col">Axes Rated</div>
          <div className="last-rated-col">Last Rated</div>
          <div className="score-col">Score</div>
        </div>

        {rated.map(({ game, score }, i) => {
          const ratedAxisIds = Object.keys(game.ratings);
          const ratedAxisNames = ratedAxisIds
            .map((id) => axisMap.get(id))
            .filter((name): name is string => name !== undefined);
          const visibleAxes = ratedAxisNames.slice(0, 3);
          const extraCount = ratedAxisNames.length - visibleAxes.length;

          return (
            <Link href={`/games/${game.id}`} key={game.id} className="game-row">
              <div className="rank">{i + 1}</div>
              <div className="game-thumb-col">
                {game.imageUrl ? (
                  <img src={game.imageUrl} alt="" className="game-thumb" />
                ) : (
                  <div className="game-thumb-placeholder" />
                )}
              </div>
              <div className="game-info">
                <div className="game-name">{game.name}</div>
                <div className="game-meta">
                  {game.yearPublished && <span>{game.yearPublished}</span>}
                  {game.minPlayers && game.maxPlayers && (
                    <span>
                      {game.minPlayers === game.maxPlayers
                        ? `${game.minPlayers}p`
                        : `${game.minPlayers}-${game.maxPlayers}p`}
                    </span>
                  )}
                  {game.bggData && <span className="bgg-badge">BGG</span>}
                </div>
              </div>
              <div className="axes-used">
                {visibleAxes.map((name) => (
                  <span key={name} className="axis-chip">
                    {name}
                  </span>
                ))}
                {extraCount > 0 && <span className="axis-chip-more">+{extraCount}</span>}
              </div>
              <div className="last-rated">{relativeDate(game.updatedAt)}</div>
              <div className="score-cell">
                <span className={`score-dot ${scoreRangeClass(score!.score)}`} />
                <span className="score-value">{score!.score.toFixed(1)}</span>
              </div>
            </Link>
          );
        })}

        {unrated.length > 0 && (
          <>
            <div className="section-sep">
              <span className="section-sep-label">
                Not yet rated &middot; {unrated.length} game{unrated.length !== 1 && "s"}
              </span>
            </div>

            {unrated.map(({ game }) => (
              <Link href={`/games/${game.id}`} key={game.id} className="game-row unrated">
                <div className="rank">&mdash;</div>
                <div className="game-thumb-col">
                  {game.imageUrl ? (
                    <img src={game.imageUrl} alt="" className="game-thumb" />
                  ) : (
                    <div className="game-thumb-placeholder" />
                  )}
                </div>
                <div className="game-info">
                  <div className="game-name">{game.name}</div>
                  <div className="game-meta">
                    {game.yearPublished && <span>{game.yearPublished}</span>}
                    {game.minPlayers && game.maxPlayers && (
                      <span>
                        {game.minPlayers === game.maxPlayers
                          ? `${game.minPlayers}p`
                          : `${game.minPlayers}-${game.maxPlayers}p`}
                      </span>
                    )}
                    {game.bggData && <span className="bgg-badge">BGG</span>}
                  </div>
                </div>
                <div className="axes-used">
                  <span className="no-ratings">No ratings yet</span>
                </div>
                <div className="last-rated">&mdash;</div>
                <div className="score-cell">
                  <span className="score-unrated">not rated</span>
                </div>
              </Link>
            ))}
          </>
        )}
      </div>
    </>
  );
}
