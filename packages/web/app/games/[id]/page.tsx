import type { Metadata } from "next";
import Link from "next/link";
import { getGame, listAxes } from "@/lib/api";
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

  let data;
  let axes;
  try {
    [data, axes] = await Promise.all([getGame(id), listAxes()]);
  } catch (err) {
    return (
      <div className="error-banner">
        {err instanceof Error ? err.message : "Could not load game data."}
      </div>
    );
  }

  const { game, score } = data;

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
          </div>
        </div>

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
