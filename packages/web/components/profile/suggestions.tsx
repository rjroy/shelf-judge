import type { AxisSuggestion } from "@shelf-judge/shared";
import { insightReferencesGame, TrustedInsightSection } from "./trusted-insights";

export function Suggestions({
  suggestions: initialSuggestions,
  gameId,
}: {
  suggestions: AxisSuggestion[] | null;
  gameId?: string;
}) {
  const relevant =
    initialSuggestions?.filter(
      (insight) =>
        !gameId ||
        insightReferencesGame(insight, gameId) ||
        (insight.status !== "reported" && insight.evidence.length === 0),
    ) ?? initialSuggestions;
  return (
    <TrustedInsightSection
      title={gameId ? "Questions from Profile Evidence" : "Questions from Your Collection"}
      insights={relevant}
      compact={gameId !== undefined}
      questionFramed
      emptyMessage={
        gameId
          ? "No evidence-backed axis questions reference this game."
          : "The suggestion method completed without finding a notable question."
      }
    />
  );
}
