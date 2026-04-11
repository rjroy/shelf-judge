import type { DivergentGame } from "@shelf-judge/shared";

export function Divergence({ games }: { games: DivergentGame[] }) {
  if (games.length === 0) return null;

  return (
    <div className="section-card">
      <div className="section-header">
        <span className="section-title-main">Preference Divergence</span>
        <span className="section-count">
          {games.length} {games.length === 1 ? "game" : "games"} &middot; gap &gt; 1.5 pts
        </span>
      </div>
      <div className="section-body">
        {games.map((game) => (
          <div key={game.gameId} className="divergence-row">
            <div className="div-game-name">{game.gameName}</div>
            <div className="div-scores">
              <div className="div-score">
                <span className="div-score-val fitness">{game.fitnessScore.toFixed(1)}</span>
                <span className="div-score-lbl">Fitness</span>
              </div>
              <span className="div-arrow">&rarr;</span>
              <div className="div-score">
                <span className="div-score-val tournament">
                  {game.normalizedTournamentScore.toFixed(1)}
                </span>
                <span className="div-score-lbl">Tournament</span>
              </div>
              <span className={`div-gap ${game.direction}`}>
                {game.direction === "tournament-outlier" ? "+" : "\u2212"}
                {game.gap.toFixed(1)}{" "}
                {game.direction === "tournament-outlier" ? "\u25B2 T" : "\u25B2 F"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
