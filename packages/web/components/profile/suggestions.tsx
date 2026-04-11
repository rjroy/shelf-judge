"use client";

import { useState } from "react";
import type { AxisSuggestion } from "@shelf-judge/shared";

const sourceLabels: Record<AxisSuggestion["source"], string> = {
  "unexpressed-concentration": "Unexpressed collection concentration",
  "high-variance": "High-variance BGG attribute",
  "divergence-repair": "Divergence repair opportunity",
};

const sourceDotClasses: Record<AxisSuggestion["source"], string> = {
  "unexpressed-concentration": "concentration",
  "high-variance": "variance",
  "divergence-repair": "repair",
};

export function Suggestions({
  suggestions: initialSuggestions,
}: {
  suggestions: AxisSuggestion[];
}) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const visible = initialSuggestions.filter((_, i) => !dismissed.has(i));

  if (visible.length === 0) return null;

  return (
    <div className="section-card">
      <div className="section-header">
        <span className="section-title-main">Axis Suggestions</span>
        <span className="section-count">{visible.length}</span>
      </div>
      <div className="section-body">
        {initialSuggestions.map((suggestion, i) => {
          if (dismissed.has(i)) return null;
          return (
            <div key={i} className="suggest-card">
              <div className={`suggest-type-dot ${sourceDotClasses[suggestion.source]}`} />
              <div className="suggest-text">
                <div>{suggestion.reason}</div>
                <div className="suggest-meta">Source: {sourceLabels[suggestion.source]}</div>
              </div>
              <button
                className="btn-dismiss"
                onClick={() => setDismissed((prev) => new Set(prev).add(i))}
              >
                Dismiss
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
