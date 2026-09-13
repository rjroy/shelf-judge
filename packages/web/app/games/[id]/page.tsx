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
import { ManualGameValuesForm } from "@/components/manual-game-values-form";
import { GameDetailCollectionNavigation } from "@/components/game-detail-collection-navigation";
import { AdditionalBggIdsForm } from "@/components/additional-bgg-ids-form";
import {
  OwnerGameNoteEditor,
  OwnerGameNoteStateProvider,
} from "@/components/owner-game-note-editor";

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

export default async function GameDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
  const editorSections = {
    ratings: (
      <>
        <div className="panel-section-title">Your Ratings</div>
        <RatingForm
          gameId={game.id}
          axes={axes}
          currentRatings={game.ratings}
          score={score}
          predictionScore={hasPredictions ? score : null}
        />
      </>
    ),
    ownership: (
      <OwnershipActions gameId={game.id} gameName={game.name} ownership={game.ownership} />
    ),
    acquisition: <AcquisitionForm gameId={game.id} acquisition={game.acquisition} />,
    playMetadata: (
      <ManualGameValuesForm
        gameId={game.id}
        values={game.manualValues}
        sourcePlayingTime={
          game.durationEvidence.status === "valid" ? game.durationEvidence.value : null
        }
        sourcePlayerCount={game.bestPlayers}
      />
    ),
    relatedBggIds:
      game.bggId !== null ? (
        <AdditionalBggIdsForm gameId={game.id} additionalBggIds={game.additionalBggIds ?? []} />
      ) : null,
    boxDimensions: <BoxDimensionsForm gameId={game.id} currentDimensions={game.boxDimensions} />,
    shelfAssignment: (
      <ShelfAssignmentForm
        gameId={game.id}
        currentShelfId={game.manualShelfId}
        options={shelfOptions}
        hasDimensions={game.boxDimensions !== null}
        isPreviouslyOwned={isPreviouslyOwned}
      />
    ),
  };
  const layoutSections: GameDetailEditorSlots = {
    ...editorSections,
    assessment: (
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
          <strong>How this is calculated:</strong> weighted average of all rated axes. Formula:{" "}
          <code>sum(rating &times; weight) / sum(weight)</code>. Axes without ratings are excluded
          from both the numerator and denominator.
          {hasPredictions && (
            <>
              {" "}
              Predicted axes use similarity-weighted ratings from your most similar rated games.
              Insufficient-confidence axes are excluded.
            </>
          )}
        </div>
      </>
    ),
    utilization: (
      <PurchaseUtilizationPanel
        result={purchaseUtilization}
        isPreviouslyOwned={isPreviouslyOwned}
      />
    ),
    intention: <IntentionControls game={game} detail={data.intentions} />,
    notes: <OwnerGameNoteEditor gameId={game.id} />,
  };
  const detailParams = await searchParams;
  const collectionContext =
    typeof detailParams.collectionContext === "string" ? detailParams.collectionContext : undefined;
  const collectionOrigin =
    typeof detailParams.collectionOrigin === "string" ? detailParams.collectionOrigin : undefined;

  return (
    <>
      <GameDetailCollectionNavigation
        gameId={game.id}
        gameName={game.name}
        collectionContext={collectionContext}
        collectionOrigin={collectionOrigin}
      >
        <GameActions gameId={game.id} gameName={game.name} hasBggId={game.bggId !== null} />
      </GameDetailCollectionNavigation>

      <OwnerGameNoteStateProvider key={game.id} initialNote={game.ownerNote}>
        <GameDetailMain editors={layoutSections}>
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
                {game.bggData?.weight && (
                  <span>⚖️ BGG Weight: {game.bggData.weight.toFixed(2)}</span>
                )}
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
                shelf, so it doesn&apos;t affect niche rankings or redundancy scores for your
                current collection. Fitness score and ratings are unchanged — they continue to
                improve prediction accuracy.
              </div>
            </div>
          )}

          {tournamentStats && tournamentStats.comparisonCount > 0 && (
            <>
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
                    <div className="tournament-stat-value">
                      {Math.round(tournamentStats.eloRating)}
                    </div>
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
                    {tournamentStats.recentComparisons.slice(0, 5).map((comparison, index) => (
                      <div
                        key={index}
                        className={`tournament-recent-row ${comparison.won ? "win" : "loss"}`}
                      >
                        <span className="tournament-result-badge">
                          {comparison.won ? "W" : "L"}
                        </span>
                        <span className="tournament-opponent-id">
                          vs{" "}
                          <Link href={`/games/${comparison.opponentGameId}`} className="game-link">
                            {comparison.opponentGameName ?? comparison.opponentGameId.slice(0, 8)}
                          </Link>
                        </span>
                        <span className="tournament-recent-date">
                          {new Date(comparison.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {!isPreviouslyOwned && score?.redundancyAdjustment && (
            <RedundancyPanel score={score} adjustment={score.redundancyAdjustment} />
          )}

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
        </GameDetailMain>
      </OwnerGameNoteStateProvider>
    </>
  );
}

type GameDetailEditorSlots = {
  ratings: ReactNode;
  ownership: ReactNode;
  acquisition: ReactNode;
  playMetadata: ReactNode;
  relatedBggIds: ReactNode;
  boxDimensions: ReactNode;
  shelfAssignment: ReactNode;
  assessment: ReactNode;
  utilization: ReactNode;
  intention: ReactNode;
  notes: ReactNode;
};

export function GameDetailMain({
  children,
  editors,
}: {
  children: ReactNode;
  editors: GameDetailEditorSlots;
}) {
  return (
    <main className="main-scroll game-detail-main game-detail-chapters">
      <div className="game-detail-content">{children}</div>
      <section className="game-detail-chapter game-detail-assessment">{editors.assessment}</section>
      <section className="game-detail-chapter game-detail-ratings">{editors.ratings}</section>
      <section className="game-detail-chapter game-detail-utilization">
        {editors.utilization}
      </section>
      <section className="game-detail-chapter game-detail-acquisition">
        {editors.acquisition}
      </section>
      <section className="game-detail-chapter game-detail-intention">{editors.intention}</section>
      <section className="game-detail-chapter game-detail-play-metadata">
        {editors.playMetadata}
      </section>
      <section className="game-detail-chapter game-detail-notes">{editors.notes}</section>
      {editors.relatedBggIds && (
        <section className="game-detail-chapter game-detail-related-bgg-ids">
          {editors.relatedBggIds}
        </section>
      )}
      <section className="game-detail-chapter game-detail-ownership">{editors.ownership}</section>
      <section className="game-detail-chapter game-detail-box-dimensions">
        {editors.boxDimensions}
      </section>
      <section className="game-detail-chapter game-detail-shelf-assignment">
        {editors.shelfAssignment}
      </section>
    </main>
  );
}

export function GameDetailHero({ children }: { children: ReactNode }) {
  return <section className="game-hero">{children}</section>;
}

function NichePositionPanel({
  nichePosition,
  ignoredTags,
}: {
  nichePosition: NichePosition;
  ignoredTags: NicheTagFilter[];
}) {
  const nichesByType = nichePosition.niches.reduce<Record<string, NicheEntry[]>>(
    (groups, niche) => {
      (groups[niche.type] ??= []).push(niche);
      return groups;
    },
    {},
  );

  return (
    <>
      <div className="niche-panel niche-panel--grouped">
        <div className="panel-section-title">Niche Position</div>
        {nichePosition.niches.length > 0 && (
          <div className="niche-type-sections">
            {Object.entries(nichesByType).map(([type, niches]) => (
              <section key={type} className="niche-type-section">
                <h3 className="niche-type-heading">{type}</h3>
                <div className="niche-grid">
                  {niches.map((niche) => (
                    <NicheEntryCard key={`${niche.type}:${niche.name}`} niche={niche} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        <NicheIgnoredSection ignoredTags={ignoredTags} />
      </div>
    </>
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
          {adjustment.nicheNeighbors.map((neighbor) => (
            <div key={neighbor.gameId} className="redundancy-neighbor-row">
              <Link href={`/games/${neighbor.gameId}`} className="redundancy-neighbor-link">
                {neighbor.gameName}
              </Link>
              {neighbor.isPredicted && <span className="niche-predicted-indicator">~</span>}
              <span className="redundancy-neighbor-sim">
                {(neighbor.similarity * 100).toFixed(0)}% similar
              </span>
              <span className="redundancy-neighbor-score">
                ({neighbor.fitnessScore.toFixed(1)})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NicheIgnoredSection({ ignoredTags }: { ignoredTags: NicheTagFilter[] }) {
  if (ignoredTags.length === 0) {
    return null;
  }

  return (
    <section className="niche-ignored-section">
      <h3 className="niche-ignored-heading">Hidden niches</h3>
      <div className="niche-ignored-list" tabIndex={0} aria-label="Hidden niches">
        {ignoredTags.map((tag) => (
          <div key={`${tag.type}:${tag.name}`} className="niche-ignored-tag">
            <span>
              {tag.name}{" "}
              <span className={`niche-type-badge niche-type-${tag.type}`}>{tag.type}</span>
            </span>
            <NicheRestoreButton type={tag.type} name={tag.name} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ordinalSuffix(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = n % 100;
  return n + (suffixes[(remainder - 20) % 10] || suffixes[remainder] || suffixes[0]);
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
