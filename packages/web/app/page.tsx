import Link from "next/link";
import { listGames } from "@/lib/api";
import { ScoreBadge } from "@/components/score-badge";
import { RefreshAllButton } from "@/components/refresh-all-button";

export const dynamic = "force-dynamic";

export default async function CollectionPage() {
  let games;
  try {
    games = await listGames();
  } catch {
    return (
      <div>
        <h1>Collection</h1>
        <p style={{ color: "#c00" }}>Could not connect to the shelf-judge daemon. Is it running?</p>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0 }}>Collection</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/search"
            style={{
              padding: "8px 16px",
              backgroundColor: "#2563eb",
              color: "white",
              textDecoration: "none",
              borderRadius: 4,
              fontSize: 14,
            }}
          >
            Add Game
          </Link>
          <Link
            href="/import"
            style={{
              padding: "8px 16px",
              backgroundColor: "#059669",
              color: "white",
              textDecoration: "none",
              borderRadius: 4,
              fontSize: 14,
            }}
          >
            Import from BGG
          </Link>
          <RefreshAllButton />
        </div>
      </div>

      {games.length === 0 ? (
        <p style={{ color: "#666" }}>
          No games in your collection yet. Add a game or import from BGG to get started.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}>
              <th style={{ padding: "8px 12px", width: 48 }}></th>
              <th style={{ padding: "8px 12px" }}>Game</th>
              <th style={{ padding: "8px 12px" }}>Year</th>
              <th style={{ padding: "8px 12px" }}>Fitness</th>
              <th style={{ padding: "8px 12px" }}>Rated Axes</th>
            </tr>
          </thead>
          <tbody>
            {games.map(({ game, score }) => (
              <tr key={game.id} style={{ borderBottom: "1px solid #e0e0e0" }}>
                <td style={{ padding: "8px 12px", width: 48 }}>
                  {game.imageUrl ? (
                    <img
                      src={game.imageUrl}
                      alt=""
                      style={{
                        width: 36,
                        height: 36,
                        objectFit: "cover",
                        borderRadius: 4,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        backgroundColor: "#e0e0e0",
                        borderRadius: 4,
                      }}
                    />
                  )}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <Link
                    href={`/games/${game.id}`}
                    style={{ textDecoration: "none", color: "#2563eb" }}
                  >
                    {game.name}
                  </Link>
                </td>
                <td style={{ padding: "8px 12px", color: "#666" }}>{game.yearPublished ?? ""}</td>
                <td style={{ padding: "8px 12px" }}>
                  <ScoreBadge score={score} />
                </td>
                <td style={{ padding: "8px 12px", color: "#666" }}>
                  {score ? `${score.ratedAxisCount} / ${score.totalAxisCount}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
