"use client";

import { useState } from "react";
import type { AxisSuggestion } from "@shelf-judge/shared";
import { insightReferencesGame, TrustedInsightSection } from "./trusted-insights";

export function Suggestions({
  suggestions: initialSuggestions,
  gameId,
}: {
  suggestions: AxisSuggestion[] | null;
  gameId?: string;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const relevant =
    initialSuggestions?.filter(
      (insight) =>
        !gameId ||
        insightReferencesGame(insight, gameId) ||
        (insight.status !== "reported" && insight.evidence.length === 0),
    ) ?? initialSuggestions;
  const visible = relevant?.filter((insight) => !dismissed.has(insight.id)) ?? relevant;
  if (relevant !== null && relevant.length > 0 && visible?.length === 0) return null;

  return (
    <TrustedInsightSection
      title={gameId ? "Questions from Profile Evidence" : "Questions from Your Collection"}
      insights={visible}
      compact={gameId !== undefined}
      questionFramed
      emptyMessage={
        gameId
          ? "No evidence-backed axis questions reference this game."
          : "The suggestion method completed without finding a notable question."
      }
      renderAction={(insight) =>
        insight.status === "reported" && gameId === undefined ? (
          <button
            className="btn-dismiss"
            onClick={() => setDismissed((previous) => new Set(previous).add(insight.id))}
          >
            Dismiss
          </button>
        ) : null
      }
    />
  );
}
