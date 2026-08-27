import type { CollectionOutlier } from "@shelf-judge/shared";
import { insightReferencesGame, TrustedInsightSection } from "./trusted-insights";

export function Outliers({
  outliers,
  gameId,
}: {
  outliers: CollectionOutlier[] | null;
  gameId?: string;
}) {
  const relevant =
    outliers?.filter(
      (insight) =>
        !gameId || insight.id === "outlier:collection" || insightReferencesGame(insight, gameId),
    ) ?? outliers;
  return (
    <TrustedInsightSection
      title={gameId ? "Collection Fit Evidence" : "Collection Outliers"}
      insights={relevant}
      compact={gameId !== undefined}
      emptyMessage={
        gameId
          ? "No notable compositional outlier evidence was found for this game."
          : "The collection was evaluated and no notable compositional outliers were found."
      }
    />
  );
}
