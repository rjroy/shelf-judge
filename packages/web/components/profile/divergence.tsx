import type { TournamentDivergenceInsight } from "@shelf-judge/shared";
import { insightReferencesGame, TrustedInsightSection } from "./trusted-insights";

export function Divergence({
  games,
  gameId,
}: {
  games: TournamentDivergenceInsight[] | null;
  gameId?: string;
}) {
  const relevant =
    games?.filter((insight) => !gameId || insightReferencesGame(insight, gameId)) ?? games;
  return (
    <TrustedInsightSection
      title={gameId ? "Preference Evidence" : "Preference Divergence"}
      insights={relevant}
      compact={gameId !== undefined}
      emptyMessage={
        gameId
          ? "No notable preference divergence was found for this game."
          : "The evaluated games did not contain notable preference divergence."
      }
      unavailableMessage="Tournament preference evidence is not available yet."
    />
  );
}
