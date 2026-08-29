import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  getGame,
  listAxes,
  getTournamentGameStats,
  getNicheSettings,
  getShelfConfig,
} from "@/lib/api";
import type {
  TournamentGameStatsDisplay,
  FitnessResult,
  NichePosition,
  NicheEntry,
  NicheNeighbor,
  NicheTagFilter,
  RedundancyAdjustment,
} from "@shelf-judge/shared";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { RatingForm } from "@/components/rating-form";
import { GameActions, OwnershipActions } from "@/components/game-actions";
import { NicheIgnoreButton, NicheRestoreButton } from "@/components/niche-ignore-button";
import { BoxDimensionsForm } from "@/components/box-dimensions-form";
import { ShelfAssignmentForm } from "@/components/shelf-assignment-form";
import { AcquisitionForm } from "@/components/acquisition-form";
import { PurchaseUtilizationPanel } from "@/components/purchase-utilization-panel";
import { IntentionControls } from "@/components/intention-controls";

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
  let ignoredTags: NicheTagFilter[] = [];
  let shelfOptions: Array<{ shelfId: string; label: string; dimensionless: boolean }> = [];
  try {
    const shelfConfigPromise = getShelfConfig().catch(() => null);
    [data, axes] = await Promise.all([getGame(id), listAxes()]);
    const shelfConfig = await shelfConfigPromise;
    shelfOptions =
      shelfConfig?.units.flatMap((unit) =>
        unit.shelves.map((shelf) => ({
          shelfId: shelf.id,
          label: `${unit.name} — ${shelf.name}`,
          dimensionless: shelf.dimensionless,
        })),
      ) ?? [];
    try {
      tournamentStats = await getTournamentGameStats(id);
    } catch {
      // Tournament stats may not exist yet
    }
    try {
      const nicheSettings = await getNicheSettings();
      ignoredTags = nicheSettings.ignoredTags;
    } catch {
      // Niche settings may not be available
    }
  } catch (err) {
    return (
      <div className="error-banner">
        {err instanceof Error ? err.message : "Could not load game data."}
      </div>
    );
  }

  const { game, score, displayScore, purchaseUtilization, nichePosition } = data;
  const isPreviouslyOwned = game.ownership === "previously-owned";
  const hasPredictions = score?.predictionMeta !== null && score?.predictionMeta !== undefined;

  return (
    <>
      {/* Topbar with breadcrumb */}
      <div className="topbar">
        <div className="breadcrumb">
          <Link href="/collection">Collection</Link>
          <span>&rsaquo;</span>
          <strong>{game.name}</strong>
        </div>
        <GameActions gameId={game.id} gameName={game.name} hasBggId={game.bggId !== null} />
      </div>

      <GameDetailMain>
        {/* Game hero section */}
        <GameDetailHero>
          <div className="game-cover">
            {game.imageUrl ? <img src={game.imageUrl} alt={game.name} /> : <span>🎲</span>}
          </div>
          <div className="game-hero-info">
            <div className="game-hero-title-row">
              <h1 className="game-hero-title">{game.name}</h1>
              {isPreviouslyOwned && (
                <span className="status-badge prev-owned">Previously Owned</span>
              )}
            </div>
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
              {game.boxDimensions ? (
                <span className="box-dims-display">
                  📦 {game.boxDimensions.width} × {game.boxDimensions.height} ×{" "}
                  {game.boxDimensions.depth} in
                </span>
              ) : (
                <span className="box-dims-display box-dims-muted">📦 not measured</span>
              )}
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
                    <strong>Mechanics:</strong>{" "}
                    {game.bggData.mechanics.map((mechanic) => mechanic.name).join(", ")}
                  </div>
                )}
                {game.bggData?.categories && game.bggData.categories.length > 0 && (
                  <div className="bgg-data-line">
                    <strong>Categories:</strong>{" "}
                    {game.bggData.categories.map((category) => category.name).join(", ")}
                  </div>
                )}
                {game.bggData?.families && game.bggData.families.length > 0 && (
                  <div className="bgg-data-line">
                    {(familyPrefix = null)}
                    <strong>Families:</strong>{" "}
                    {game.bggData.families.map((family) => {
                      if (family.name.includes(":")) {
                        const parts = family.name.split(":");
                        const familyElement = (
                          <span key={parts[1]}>
                            {familyPrefix ? familyPrefix : ""}
                            <em>{parts[0]}:</em>
                            {parts[1]}
                          </span>
                        );
                        familyPrefix = ", ";
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
              score.vetoed ? (
                <>
                  <div className="game-hero-score-value">
                    <div className="score-hero-label">Fitness Score</div>
                    <div className="score-hero-number score-hero-vetoed">VETOED</div>
                    {score.hypotheticalScore !== null && (
                      <div className="score-hero-out-of">
                        hypothetical: {score.hypotheticalScore.toFixed(1)}
                      </div>
                    )}
                  </div>
                  <div className="game-hero-score-value">
                    <div className="score-hero-rated">{score.ratedAxisCount} axes rated</div>
                  </div>
                </>
              ) : hasPredictions ? (
                <>
                  <div className="game-hero-score-value">
                    <div className="score-hero-label">Fitness Score</div>
                    <div className="score-hero-number score-predicted">
                      <span className="score-predicted-tilde">~</span>
                      {displayScore}
                    </div>
                    <div className="score-hero-predict-summary">
                      {score.predictionMeta!.actualAxisCount} actual &middot;{" "}
                      {score.predictionMeta!.predictedAxisCount} predicted
                    </div>
                    <div className="score-hero-predict-summary" style={{ marginTop: 2 }}>
                      <span className={`conf-badge conf-${score.predictionMeta!.confidence}`}>
                        {score.predictionMeta!.confidence}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="game-hero-score-value">
                    <div className="score-hero-label">Fitness Score</div>
                    <div className="score-hero-number">{displayScore}</div>
                    <div className="score-hero-rated">{score.ratedAxisCount} axes rated</div>
                  </div>
                </>
              )
            ) : (
              <div className="game-hero-score-value">
                <div className="score-hero-label">Fitness Score</div>
                <div className="score-hero-number score-hero-unrated">&mdash;</div>
                <div className="score-hero-out-of">not yet rated</div>
              </div>
            )}
            {tournamentStats && (
              <div className="game-hero-score-value">
                <div className="tournament-hero-rank">
                  <div className="score-hero-label">Tournament Rank</div>
                  <div
                    className={`tournament-hero-value${tournamentStats.isProvisional ? " provisional" : ""}`}
                  >
                    {tournamentStats.displayLabel}
                  </div>
                </div>
              </div>
            )}
          </div>
        </GameDetailHero>

        {isPreviouslyOwned && (
          <div className="prev-owned-notice">
            <span className="prev-owned-notice-icon">&#x25CE;</span>
            <div>
              <strong>Niche and redundancy data excluded.</strong> This game is no longer on your
              shelf, so it doesn&apos;t affect niche rankings or redundancy scores for your current
              collection. Fitness score and ratings are unchanged — they continue to improve
              prediction accuracy.
            </div>
          </div>
        )}

        <PurchaseUtilizationPanel
          result={purchaseUtilization}
          isPreviouslyOwned={isPreviouslyOwned}
        />

        <IntentionControls game={game} detail={data.intentions} />

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
                {tournamentStats.recentComparisons.slice(0, 5).map((c, i) => (
                  <div key={i} className={`tournament-recent-row ${c.won ? "win" : "loss"}`}>
                    <span className="tournament-result-badge">{c.won ? "W" : "L"}</span>
                    <span className="tournament-opponent-id">
                      vs{" "}
                      <Link href={`/games/${c.opponentGameId}`} className="game-link">
                        {c.opponentGameName ?? c.opponentGameId.slice(0, 8)}
                      </Link>
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

        {/* Redundancy panel (REQ-REDUN-31, REQ-REDUN-32, REQ-REDUN-33) */}
        {!isPreviouslyOwned && score?.redundancyAdjustment && (
          <RedundancyPanel score={score} adjustment={score.redundancyAdjustment} />
        )}

        {/* Niche Position panel (REQ-NICHE-18, REQ-NICHE-19) */}
        {!isPreviouslyOwned &&
          (score?.vetoed ? (
            <div className="niche-panel">
              <div className="panel-section-title">Niche Position</div>
              <div className="niche-vetoed-note">
                This game is vetoed and excluded from niche rankings.
              </div>
            </div>
          ) : (
            nichePosition &&
            (nichePosition.niches.length > 0 || ignoredTags.length > 0) && (
              <NichePositionPanel nichePosition={nichePosition} ignoredTags={ignoredTags} />
            )
          ))}

        {/* Two-panel layout */}
        <GameDetailPanels
          left={
            <>
              <div className="panel-section-title">
                Score Breakdown
                {score && !score.vetoed && (
                  <span className="badge">
                    How {hasPredictions ? "~" : ""}
                    {displayScore} was calculated
                  </span>
                )}
              </div>
              <ScoreBreakdown
                score={score}
                displayScore={displayScore}
                isPreviouslyOwned={isPreviouslyOwned}
              />
              <div className="calc-explanation">
                <strong>How this is calculated:</strong> weighted average of all rated axes.
                Formula: <code>sum(rating &times; weight) / sum(weight)</code>. Axes without ratings
                are excluded from both the numerator and denominator.
                {hasPredictions && (
                  <>
                    {" "}
                    Predicted axes use similarity-weighted ratings from your most similar rated
                    games. Insufficient-confidence axes are excluded.
                  </>
                )}
              </div>
            </>
          }
          right={
            <>
              <div className="panel-section-title">Your Ratings</div>
              <RatingForm
                gameId={game.id}
                axes={axes}
                currentRatings={game.ratings}
                score={score}
                predictionScore={hasPredictions ? score : null}
              />
              <OwnershipActions gameId={game.id} gameName={game.name} ownership={game.ownership} />
              <AcquisitionForm gameId={game.id} acquisition={game.acquisition} />
              <BoxDimensionsForm gameId={game.id} currentDimensions={game.boxDimensions} />
              <ShelfAssignmentForm
                gameId={game.id}
                currentShelfId={game.manualShelfId}
                options={shelfOptions}
                hasDimensions={game.boxDimensions !== null}
                isPreviouslyOwned={isPreviouslyOwned}
              />
            </>
          }
        />
      </GameDetailMain>
    </>
  );
}

export function GameDetailMain({ children }: { children: ReactNode }) {
  return <div className="main-scroll">{children}</div>;
}

export function GameDetailHero({ children }: { children: ReactNode }) {
  return <div className="game-hero">{children}</div>;
}

export function GameDetailPanels({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="detail-panels">
      <div className="panel-left">{left}</div>
      <div className="panel-right">{right}</div>
    </div>
  );
}

function NichePositionPanel({
  nichePosition,
  ignoredTags,
}: {
  nichePosition: NichePosition;
  ignoredTags: NicheTagFilter[];
}) {
  return (
    <div className="niche-panel">
      <div className="panel-section-title">Niche Position</div>
      {nichePosition.niches.length > 0 && (
        <div className="niche-grid">
          {nichePosition.niches.map((niche) => (
            <NicheEntryCard key={`${niche.type}:${niche.name}`} niche={niche} />
          ))}
        </div>
      )}
      {ignoredTags.length > 0 && (
        <div className="niche-ignored-section">
          <div className="niche-ignored-title">Ignored Niches</div>
          <div className="niche-ignored-chips">
            {ignoredTags.map((tag) => (
              <span key={`${tag.type}:${tag.name}`} className="niche-ignored-chip">
                <span className="niche-ignored-chip-name">{tag.name}</span>
                <span className={`niche-type-badge niche-type-${tag.type}`}>{tag.type}</span>
                <NicheRestoreButton type={tag.type} name={tag.name} />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NicheEntryCard({ niche }: { niche: NicheEntry }) {
  return (
    <div className="niche-card">
      <div className="niche-card-header">
        <span className="niche-card-name">{niche.name}</span>
        <span className={`niche-type-badge niche-type-${niche.type}`}>{niche.type}</span>
        <NicheIgnoreButton type={niche.type} name={niche.name} />
      </div>
      <div className="niche-card-rank">
        {niche.isChampion ? (
          <span className="niche-champion-badge">Champion</span>
        ) : (
          <span className="niche-rank-label">
            #{niche.rank} of {niche.size}
          </span>
        )}
        <span className="niche-size-label">
          {niche.size} game{niche.size !== 1 ? "s" : ""}
        </span>
      </div>
      {!niche.isChampion && (
        <div className="niche-card-champion">
          Champion:{" "}
          <Link href={`/games/${niche.champion.gameId}`} className="niche-neighbor-link">
            {niche.champion.gameName}
          </Link>{" "}
          <span className="niche-neighbor-score">({niche.champion.fitnessScore.toFixed(1)})</span>
        </div>
      )}
      <div className="niche-neighbors">
        {niche.above.length > 0 && (
          <div className="niche-neighbor-row">
            <span className="niche-neighbor-dir">Above:</span>
            {niche.above.map((n) => (
              <NeighborLink key={n.gameId} neighbor={n} />
            ))}
          </div>
        )}
        {niche.below.length > 0 && (
          <div className="niche-neighbor-row">
            <span className="niche-neighbor-dir">Below:</span>
            {niche.below.map((n) => (
              <NeighborLink key={n.gameId} neighbor={n} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NeighborLink({ neighbor }: { neighbor: NicheNeighbor }) {
  return (
    <span className="niche-neighbor-item">
      <Link href={`/games/${neighbor.gameId}`} className="niche-neighbor-link">
        {neighbor.gameName}
      </Link>
      {neighbor.isPredicted && <span className="niche-predicted-indicator">~</span>}
      <span className="niche-neighbor-score">({neighbor.fitnessScore.toFixed(1)})</span>
    </span>
  );
}

function RedundancyPanel({
  score,
  adjustment,
}: {
  score: FitnessResult;
  adjustment: RedundancyAdjustment;
}) {
  // Infer mode from data: if score.score differs from originalScore, integrated mode is active
  const isIntegrated = score.score !== adjustment.originalScore;
  const zeroPenalty = adjustment.penalty === 0;

  return (
    <div className="redundancy-panel">
      <div className="panel-section-title">Redundancy{!isIntegrated && " (preview)"}</div>

      {zeroPenalty ? (
        <div className="redundancy-summary">Best among similar games</div>
      ) : isIntegrated ? (
        <div className="redundancy-summary">
          Fitness: {adjustment.adjustedScore.toFixed(1)}{" "}
          <span className="redundancy-detail">
            (was {adjustment.originalScore.toFixed(1)}, -{adjustment.penalty.toFixed(1)} redundancy)
          </span>
        </div>
      ) : (
        <div className="redundancy-summary redundancy-annotation">
          Would be {adjustment.adjustedScore.toFixed(1)} with redundancy applied{" "}
          <span className="redundancy-detail">
            (current {adjustment.originalScore.toFixed(1)}, -{adjustment.penalty.toFixed(1)}{" "}
            penalty)
          </span>
        </div>
      )}

      <div className="redundancy-rank">
        {ordinalSuffix(adjustment.nicheRank)} of {adjustment.nicheSize} similar game
        {adjustment.nicheSize !== 1 ? "s" : ""}
      </div>

      {adjustment.nicheNeighbors.length > 0 && (
        <div className="redundancy-neighbors">
          <div className="redundancy-neighbors-title">Similar games</div>
          {adjustment.nicheNeighbors.map((n) => (
            <div key={n.gameId} className="redundancy-neighbor-row">
              <Link href={`/games/${n.gameId}`} className="redundancy-neighbor-link">
                {n.gameName}
              </Link>
              {n.isPredicted && <span className="niche-predicted-indicator">~</span>}
              <span className="redundancy-neighbor-sim">
                {(n.similarity * 100).toFixed(0)}% similar
              </span>
              <span className="redundancy-neighbor-score">({n.fitnessScore.toFixed(1)})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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
