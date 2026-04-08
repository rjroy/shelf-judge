import type { Metadata } from "next";
import Link from "next/link";
import { getGame, listAxes, getTournamentGameStats } from "@/lib/api";
import type { TournamentGameStatsDisplay } from "@shelf-judge/shared";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { RatingForm } from "@/components/rating-form";
import { GameActions } from "@/components/game-actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const { game } = await getGame(id);
    return { title: game.name };
  } catch {
    return { title: "Game" };
  }
}

export const dynamic = "force-dynamic";

export default async function GameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let familyPrefix: string | null = null;
  let data;
  let axes;
  let tournamentStats: TournamentGameStatsDisplay | null = null;
  try {
    [data, axes] = await Promise.all([getGame(id), listAxes()]);
    try {
      tournamentStats = await getTournamentGameStats(id);
    } catch {
      // Tournament stats may not exist yet
    }
  } catch (err) {
    return (
      <div className="error-banner">
        {err instanceof Error ? err.message : "Could not load game data."}
      </div>
    );
  }

  const { game, score } = data;

  // Divergence check: > 2.0 difference between fitness and tournament, both non-provisional
  const hasDivergence =
    score !== null &&
    tournamentStats !== null &&
    tournamentStats.normalizedScore !== null &&
    !tournamentStats.isProvisional &&
    Math.abs(score.score - tournamentStats.normalizedScore) > 2.0;

  return (
    <>
      {/* Topbar with breadcrumb */}
      <div className="topbar">
        <div className="breadcrumb">
          <Link href="/">Collection</Link>
          <span>›</span>
          <strong>{game.name}</strong>
        </div>
        <GameActions gameId={game.id} gameName={game.name} hasBggId={game.bggId !== null} />
      </div>

      <div className="main-scroll">
        {/* Game hero section */}
        <div className="game-hero">
          <div className="game-cover">
            {game.imageUrl ? <img src={game.imageUrl} alt={game.name} /> : <span>🎲</span>}
          </div>
          <div className="game-hero-info">
            <div className="game-hero-title">{game.name}</div>
            <div className="game-hero-meta">
              {game.yearPublished && <span>📅 {game.yearPublished}</span>}
              {game.minPlayers && (
                <span>
                  👥{" "}
                  {game.minPlayers === game.maxPlayers
                    ? game.minPlayers
                    : `${game.minPlayers}–${game.maxPlayers}`}{" "}
                  players
                </span>
              )}
              {game.playingTime && <span>⏱ {game.playingTime} min</span>}
              {game.bggData?.weight && <span>⚖️ BGG Weight: {game.bggData.weight.toFixed(2)}</span>}
              {game.numPlays && game.numPlays > 0 && <span>🎲 Plays: {game.numPlays}</span>}
              {game.bggId && (
                <a
                  className="bgg-link"
                  href={`https://boardgamegeek.com/boardgame/${game.bggId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  BGG ↗
                </a>
              )}
            </div>
            {game.bggData && (
              <div className="bgg-data-line">
                BGG data refreshed <strong>{formatRelativeDate(game.bggData.fetchedAt)}</strong>
                {" · "}BGG community rating:{" "}
                <span className="bgg-value">{game.bggData.communityRating.toFixed(1)}</span>
              </div>
            )}
            {game.bggData && (
              <div className="bgg-data-section">
                {game.bggData?.mechanics && game.bggData.mechanics.length > 0 && (
                  <div className="bgg-data-line">
                    <strong>Mechanics:</strong> {game.bggData.mechanics.map((mechanic) => mechanic.name).join(", ")}
                  </div>
                )}
                {game.bggData?.categories && game.bggData.categories.length > 0 && (
                  <div className="bgg-data-line">
                    <strong>Categories:</strong> {game.bggData.categories.map((category) => category.name).join(", ")}
                  </div>
                )}
                {game.bggData?.families && game.bggData.families.length > 0 && (
                  <div className="bgg-data-line">
                    {familyPrefix = null}
                    <strong>Families:</strong> {game.bggData.families.map((family) => {
                      if (family.name.includes(':')) {
                        const parts = family.name.split(':');
                        const familyElement = <span key={parts[1]}>{familyPrefix ? familyPrefix : ''}<em>{parts[0]}:</em>{parts[1]}</span>;
                        familyPrefix = ', ';
                        return familyElement;
                      } else {
                        return <span key={family.name}> {family.name}</span>;
                      }
                    })}
                  </div>
                )}
                {game.bggData?.description && (
                  <div className="bgg-data-line">
                    <strong>Description:</strong> {game.bggData.description}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="game-hero-score-section">
            {score ? (
              <>
                <div className="score-hero-label">Fitness Score</div>
                <div className="score-hero-number">{score.score.toFixed(1)}</div>
                <div className="score-hero-out-of">out of 10.0</div>
                <div className="score-hero-rated">{score.ratedAxisCount} axes rated</div>
              </>
            ) : (
              <>
                <div className="score-hero-label">Fitness Score</div>
                <div className="score-hero-number score-hero-unrated">—</div>
                <div className="score-hero-out-of">not yet rated</div>
              </>
            )}
            {tournamentStats && (
              <div className="tournament-hero-rank">
                <div className="score-hero-label">Tournament Rank</div>
                <div
                  className={`tournament-hero-value${tournamentStats.isProvisional ? " provisional" : ""}`}
                >
                  {tournamentStats.displayLabel}
                </div>
              </div>
            )}
          </div>
        </div>

        {hasDivergence && (
          <div className="divergence-banner">
            <strong>Score divergence:</strong> This game&apos;s fitness score (
            {score.score.toFixed(1)}) and tournament rank (
            {tournamentStats!.normalizedScore!.toFixed(1)}) differ by more than 2.0 points. This may
            indicate your axis ratings and head-to-head preferences are measuring different things.
          </div>
        )}

        {tournamentStats && tournamentStats.comparisonCount > 0 && (
          <div className="tournament-breakdown-panel">
            <div className="panel-section-title">Tournament Breakdown</div>
            <div className="tournament-breakdown-grid">
              <div className="tournament-stat">
                <div className="tournament-stat-value">{tournamentStats.comparisonCount}</div>
                <div className="tournament-stat-label">Comparisons</div>
              </div>
              <div className="tournament-stat">
                <div className="tournament-stat-value">
                  {tournamentStats.wins}W / {tournamentStats.losses}L
                </div>
                <div className="tournament-stat-label">Record</div>
              </div>
              <div className="tournament-stat">
                <div className="tournament-stat-value">{Math.round(tournamentStats.eloRating)}</div>
                <div className="tournament-stat-label">Raw ELO</div>
              </div>
              <div className="tournament-stat">
                <div className="tournament-stat-value">
                  {tournamentStats.normalizedScore !== null
                    ? tournamentStats.normalizedScore.toFixed(1)
                    : "-"}
                </div>
                <div className="tournament-stat-label">Normalized</div>
              </div>
            </div>
            {tournamentStats.recentComparisons.length > 0 && (
              <div className="tournament-recent">
                <div className="tournament-recent-title">Last 5 comparisons</div>
                {tournamentStats.recentComparisons.map((c, i) => (
                  <div key={i} className={`tournament-recent-row ${c.won ? "win" : "loss"}`}>
                    <span className="tournament-result-badge">{c.won ? "W" : "L"}</span>
                    <span className="tournament-opponent-id">
                      vs {c.opponentGameName ?? c.opponentGameId.slice(0, 8)}
                    </span>
                    <span className="tournament-recent-date">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Two-panel layout */}
        <div className="detail-panels">
          <div className="panel-left">
            <div className="panel-section-title">
              Score Breakdown
              {score && <span className="badge">How {score.score.toFixed(1)} was calculated</span>}
            </div>
            <ScoreBreakdown score={score} />
            <div className="calc-explanation">
              <strong>How this is calculated:</strong> weighted average of all rated axes. Formula:{" "}
              <code>sum(rating × weight) / sum(weight)</code>. Axes without ratings are excluded
              from both the numerator and denominator.
            </div>
          </div>
          <div className="panel-right">
            <div className="panel-section-title">Your Ratings</div>
            <RatingForm gameId={game.id} axes={axes} currentRatings={game.ratings} />
          </div>
        </div>
      </div>
    </>
  );
}

function formatRelativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 7) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return "1 week ago";
  if (diffWeeks < 4) return `${diffWeeks} weeks ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month ago";
  return `${diffMonths} months ago`;
}
