import { getGame, listAxes } from "@/lib/api";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { RatingForm } from "@/components/rating-form";
import { GameActions } from "@/components/game-actions";

export const dynamic = "force-dynamic";

export default async function GameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let data;
  let axes;
  try {
    [data, axes] = await Promise.all([getGame(id), listAxes()]);
  } catch (err) {
    return (
      <div>
        <h1>Game Not Found</h1>
        <p style={{ color: "#c00" }}>
          {err instanceof Error ? err.message : "Could not load game data."}
        </p>
      </div>
    );
  }

  const { game, score } = data;

  return (
    <div>
      <h1>{game.name}</h1>

      <div style={{ display: "flex", gap: 24, marginBottom: 24 }}>
        {game.imageUrl && (
          <img
            src={game.imageUrl}
            alt={game.name}
            style={{ width: 150, height: "auto", borderRadius: 4 }}
          />
        )}
        <div>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {game.yearPublished && (
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>Year</td>
                  <td style={{ padding: "4px 0" }}>{game.yearPublished}</td>
                </tr>
              )}
              {game.minPlayers && (
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>Players</td>
                  <td style={{ padding: "4px 0" }}>
                    {game.minPlayers === game.maxPlayers
                      ? game.minPlayers
                      : `${game.minPlayers}-${game.maxPlayers}`}
                  </td>
                </tr>
              )}
              {game.playingTime && (
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>Play Time</td>
                  <td style={{ padding: "4px 0" }}>{game.playingTime} min</td>
                </tr>
              )}
              {game.bggId && (
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>BGG</td>
                  <td style={{ padding: "4px 0" }}>
                    <a
                      href={`https://boardgamegeek.com/boardgame/${game.bggId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#2563eb" }}
                    >
                      View on BGG
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <h2>Fitness Score</h2>
      <ScoreBreakdown score={score} />

      <h2>Rate This Game</h2>
      <RatingForm gameId={game.id} axes={axes} currentRatings={game.ratings} />

      <h2 style={{ marginTop: 32 }}>Actions</h2>
      <GameActions gameId={game.id} gameName={game.name} hasBggId={game.bggId !== null} />
    </div>
  );
}
