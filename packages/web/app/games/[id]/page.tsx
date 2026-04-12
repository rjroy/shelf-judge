import type { Metadata } from "next";
import Link from "next/link";
import { getGame, listAxes, getTournamentGameStats, getProfile, predictGame } from "@/lib/api";
import type {
  TournamentGameStatsDisplay,
  DivergentGame,
  CollectionOutlier,
  FitnessResult,
  RevealedPreferenceTension,
  NichePosition,
  NicheEntry,
  NicheNeighbor,
} from "@shelf-judge/shared";
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
  let profileDivergence: DivergentGame | null = null;
  let profileOutlier: CollectionOutlier | null = null;
  let prediction: { score: FitnessResult; tension?: RevealedPreferenceTension } | null = null;
  try {
    [data, axes] = await Promise.all([getGame(id), listAxes()]);
    try {
      tournamentStats = await getTournamentGameStats(id);
    } catch {
      // Tournament stats may not exist yet
    }
    try {
      const profile = await getProfile();
      profileDivergence = profile.divergence?.find((d) => d.gameId === id) ?? null;
      profileOutlier = profile.outliers.find((o) => o.gameId === id) ?? null;
    } catch {
      // Profile may not exist yet
    }
    // Fetch prediction data for unrated or partially-rated games
    try {
      const predicted = await predictGame(id);
      if (predicted.score?.predictionMeta) {
        prediction = {
          score: predicted.score,
          tension: predicted.tension ?? undefined,
        };
      }
    } catch {
      // Prediction may not be available (fully rated, no BGG data, etc.)
    }
  } catch (err) {
    return (
      <div className="error-banner">
        {err instanceof Error ? err.message : "Could not load game data."}
      </div>
    );
  }

  const { game, score, nichePosition } = data;
  // Use predicted score when the game has no actual score but has predictions
  const displayScore = score ?? prediction?.score ?? null;
  const hasPredictions =
    displayScore?.predictionMeta !== null && displayScore?.predictionMeta !== undefined;

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
            {displayScore ? (
              displayScore.vetoed ? (
                <>
                  <div className="score-hero-label">Fitness Score</div>
                  <div className="score-hero-number score-hero-vetoed">VETOED</div>
                  {displayScore.hypotheticalScore !== null && (
                    <div className="score-hero-out-of">
                      hypothetical: {displayScore.hypotheticalScore.toFixed(1)}
                    </div>
                  )}
                  <div className="score-hero-rated">{displayScore.ratedAxisCount} axes rated</div>
                </>
              ) : hasPredictions ? (
                <>
                  <span className="predict-badge">PREDICTED</span>
                  <div className="score-hero-label">Fitness Score</div>
                  <div className="score-hero-number score-predicted">
                    <span className="score-predicted-tilde">~</span>
                    {displayScore.score.toFixed(1)}
                  </div>
                  <div className="score-hero-predict-summary">
                    {displayScore.predictionMeta!.actualAxisCount} actual &middot;{" "}
                    {displayScore.predictionMeta!.predictedAxisCount} predicted
                  </div>
                  <div className="score-hero-predict-summary" style={{ marginTop: 2 }}>
                    <span className={`conf-badge conf-${displayScore.predictionMeta!.confidence}`}>
                      {displayScore.predictionMeta!.confidence}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="score-hero-label">Fitness Score</div>
                  <div className="score-hero-number">{displayScore.score.toFixed(1)}</div>
                  <div className="score-hero-out-of">out of 10.0</div>
                  <div className="score-hero-rated">{displayScore.ratedAxisCount} axes rated</div>
                </>
              )
            ) : (
              <>
                <div className="score-hero-label">Fitness Score</div>
                <div className="score-hero-number score-hero-unrated">&mdash;</div>
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

        {profileDivergence && (
          <div className="profile-divergence-detail">
            <div className="profile-detail-title">Profile Divergence</div>
            <div className="divergence-row">
              <div className="div-game-name">
                {profileDivergence.direction === "tournament-outlier"
                  ? "Tournament rates higher than fitness"
                  : "Fitness rates higher than tournament"}
              </div>
              <div className="div-scores">
                <div className="div-score">
                  <span className="div-score-val fitness">
                    {profileDivergence.fitnessScore.toFixed(1)}
                  </span>
                  <span className="div-score-lbl">Fitness</span>
                </div>
                <span className="div-arrow">&rarr;</span>
                <div className="div-score">
                  <span className="div-score-val tournament">
                    {profileDivergence.normalizedTournamentScore.toFixed(1)}
                  </span>
                  <span className="div-score-lbl">Tournament</span>
                </div>
                <span className={`div-gap ${profileDivergence.direction}`}>
                  {profileDivergence.direction === "tournament-outlier" ? "+" : "\u2212"}
                  {profileDivergence.gap.toFixed(1)}
                </span>
              </div>
            </div>
          </div>
        )}

        {profileOutlier && (
          <div className="profile-outlier-detail">
            <div className="profile-detail-title">Collection Outlier</div>
            <div className="outlier-row">
              <div className="outlier-info">
                <div className="outlier-reason">
                  Composite distance <span>{profileOutlier.distances.composite.toFixed(2)}</span>{" "}
                  from collection centroid
                </div>
                <div className="outlier-distance">
                  {profileOutlier.distances.binary !== null && (
                    <span
                      className={`dist-component${profileOutlier.distances.binary >= 0.7 ? " high" : ""}`}
                    >
                      Mechanics: {profileOutlier.distances.binary.toFixed(2)}
                    </span>
                  )}
                  {profileOutlier.distances.continuous !== null && (
                    <span
                      className={`dist-component${profileOutlier.distances.continuous >= 0.7 ? " high" : ""}`}
                    >
                      BGG attrs: {profileOutlier.distances.continuous.toFixed(2)}
                    </span>
                  )}
                  {profileOutlier.distances.personalAxes !== null && (
                    <span
                      className={`dist-component${profileOutlier.distances.personalAxes >= 0.7 ? " high" : ""}`}
                    >
                      Axis ratings: {profileOutlier.distances.personalAxes.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              <div className="outlier-type-tags">
                {profileOutlier.classifications.map((cls) => (
                  <span
                    key={cls}
                    className={`outlier-type-tag ${cls === "lone-wolf" ? "lone-wolf" : cls === "category-orphan" ? "category-orphan" : "high-fitness"}`}
                  >
                    {cls === "lone-wolf"
                      ? "Lone Wolf"
                      : cls === "category-orphan"
                        ? "Category Orphan"
                        : "High-Fitness"}
                  </span>
                ))}
              </div>
            </div>
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

        {/* Niche Position panel (REQ-NICHE-18, REQ-NICHE-19) */}
        {displayScore?.vetoed ? (
          <div className="niche-panel">
            <div className="panel-section-title">Niche Position</div>
            <div className="niche-vetoed-note">
              This game is vetoed and excluded from niche rankings.
            </div>
          </div>
        ) : (
          nichePosition &&
          nichePosition.niches.length > 0 && <NichePositionPanel nichePosition={nichePosition} />
        )}

        {/* Two-panel layout */}
        <div className="detail-panels">
          <div className="panel-left">
            <div className="panel-section-title">
              Score Breakdown
              {displayScore && !displayScore.vetoed && (
                <span className="badge">
                  How {hasPredictions ? "~" : ""}
                  {displayScore.score.toFixed(1)} was calculated
                </span>
              )}
            </div>
            <ScoreBreakdown score={displayScore} />
            <div className="calc-explanation">
              <strong>How this is calculated:</strong> weighted average of all rated axes. Formula:{" "}
              <code>sum(rating &times; weight) / sum(weight)</code>. Axes without ratings are
              excluded from both the numerator and denominator.
              {hasPredictions && (
                <>
                  {" "}
                  Predicted axes use similarity-weighted ratings from your most similar rated games.
                  Insufficient-confidence axes are excluded.
                </>
              )}
            </div>

            {/* Revealed preference tension */}
            {prediction?.score?.predictionMeta &&
              (() => {
                // Check if any breakdown entry has tension data available
                // Tension comes through the prediction response
                const tensionNote = prediction.score.predictionMeta
                  ? prediction.tension
                  : undefined;
                if (!tensionNote) return null;

                const delta = Math.abs(
                  tensionNote.predictedFitness - tensionNote.tournamentClusterAverage,
                );

                return (
                  <div className="tension-panel">
                    <div className="tension-header">
                      <span className="tension-icon">&#x26A1;</span>
                      <span className="tension-title">Revealed Preference Tension</span>
                      <span className="tension-delta">&Delta; {delta.toFixed(1)} points</span>
                    </div>
                    <div className="tension-body">
                      <div className="tension-signal">
                        <div className="tension-signal-label">Axis Prediction</div>
                        <div className="tension-signal-value predict">
                          {tensionNote.predictedFitness.toFixed(1)}
                        </div>
                      </div>
                      <span className="tension-vs">vs</span>
                      <div className="tension-signal">
                        <div className="tension-signal-label">Tournament Pattern</div>
                        <div className="tension-signal-value tourney">
                          {tensionNote.tournamentClusterAverage.toFixed(1)}
                        </div>
                      </div>
                    </div>
                    <div className="tension-note">{tensionNote.note}</div>
                  </div>
                );
              })()}
          </div>
          <div className="panel-right">
            <div className="panel-section-title">Your Ratings</div>
            <RatingForm
              gameId={game.id}
              axes={axes}
              currentRatings={game.ratings}
              predictionScore={hasPredictions ? displayScore : null}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function NichePositionPanel({ nichePosition }: { nichePosition: NichePosition }) {
  return (
    <div className="niche-panel">
      <div className="panel-section-title">Niche Position</div>
      <div className="niche-grid">
        {nichePosition.niches.map((niche) => (
          <NicheEntryCard key={`${niche.type}:${niche.name}`} niche={niche} />
        ))}
      </div>
    </div>
  );
}

function NicheEntryCard({ niche }: { niche: NicheEntry }) {
  return (
    <div className="niche-card">
      <div className="niche-card-header">
        <span className="niche-card-name">{niche.name}</span>
        <span className={`niche-type-badge niche-type-${niche.type}`}>{niche.type}</span>
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
            {niche.above.map((n) => (
              <span className="niche-neighbor-dir">Above:
                <NeighborLink key={n.gameId} neighbor={n} />
              </span>
            ))}
          </div>
        )}
        {niche.below.length > 0 && (
          <div className="niche-neighbor-row">
            {niche.below.map((n) => (
              <span className="niche-neighbor-dir">Below:
                <NeighborLink key={n.gameId} neighbor={n} />
              </span>
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
