"use client";

import { useState } from "react";
import type { ReflectionQuestionState } from "@shelf-judge/shared";

function citationHref(operationId: string, parameters: Record<string, string>): string | undefined {
  const gameId = parameters.gameId;
  if (operationId === "shelf.profile.get") return "/";
  if (
    gameId !== undefined &&
    [
      "shelf.game.get",
      "shelf.game.bgg.refresh",
      "shelf.game.plays.set",
      "shelf.game.rating.set",
    ].includes(operationId)
  ) {
    return `/games/${encodeURIComponent(gameId)}`;
  }
  return undefined;
}

function CitationList({ state }: { state: ReflectionQuestionState }) {
  if (state.cache.state === "none") return null;
  const stale = state.cache.state === "stale";
  return (
    <ul className="reflection-citations" aria-label="Reflection citations">
      {state.cache.result.citations.map((citation) => (
        <li key={citation.citationId}>
          {(() => {
            const href = citationHref(
              citation.destination.operationId,
              citation.destination.parameters,
            );
            const label = `${citation.testimony ? "Owner testimony" : "Deterministic evidence"}: ${citation.canonicalSummary}`;
            if (stale) {
              return (
                <>
                  <a href={`#reflection-citation-${citation.citationId}`}>{label}</a>
                  <details id={`reflection-citation-${citation.citationId}`}>
                    <summary>Captured evidence snapshot</summary>
                    <p>{citation.canonicalSummary}</p>
                    <p>Source version: {citation.sourceVersion}</p>
                    {citation.observedAt === undefined ? null : (
                      <p>Observed: {citation.observedAt}</p>
                    )}
                  </details>
                </>
              );
            }
            return href === undefined ? <span>{label}</span> : <a href={href}>{label}</a>;
          })()}
        </li>
      ))}
    </ul>
  );
}

export function ReflectionCard({
  state,
  wording,
  onRefresh,
  onToggle,
  onCancel,
  refreshDisabled,
}: {
  state: ReflectionQuestionState;
  wording: string;
  onRefresh: (questionId: ReflectionQuestionState["questionId"]) => void;
  onToggle: (questionId: ReflectionQuestionState["questionId"], enabled: boolean) => void;
  onCancel: () => void;
  refreshDisabled: boolean;
}) {
  const [showStale, setShowStale] = useState(false);
  const cache = state.cache;
  const result = cache.state === "none" ? undefined : cache.result;
  const isStale = cache.state === "stale";
  return (
    <article className="reflection-card" aria-labelledby={`reflection-${state.questionId}`}>
      <h4 id={`reflection-${state.questionId}`}>{wording}</h4>
      {state.attempt.state === "refreshing" && (
        <p className="reflection-status" role="status">
          Refreshing reflection. Evidence is being retrieved.
        </p>
      )}
      {state.attempt.state === "cancelled" && (
        <p className="reflection-status" role="status">
          The last refresh was cancelled. Previous output was preserved.
        </p>
      )}
      {state.attempt.state === "unavailable" && (
        <p className="reflection-status" role="status">
          Refresh unavailable: {state.attempt.reason}
          {state.attempt.safeDetail ? ` (${state.attempt.safeDetail})` : ""}. Previous output was
          preserved.
        </p>
      )}
      {state.attempt.state === "purged" && (
        <p className="reflection-status" role="status">
          Previous output was removed: {state.attempt.reason}.
        </p>
      )}
      {isStale && (
        <div className="reflection-stale">
          <p>Previous reflection is stale because {cache.changedCategories.join(", ")} changed.</p>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => setShowStale((shown) => !shown)}
            aria-expanded={showStale}
          >
            {showStale ? "Hide previous stale reflection" : "Show previous stale reflection"}
          </button>
        </div>
      )}
      {result !== undefined && (!isStale || showStale) && (
        <div className="reflection-result">
          {result.outcome === "answered" ? (
            <p>{result.centralSynthesis.text}</p>
          ) : (
            <p>Unable to provide a reflection: {result.explanation}</p>
          )}
          {result.supportingBlocks.map((block) => (
            <p key={block.text}>{block.text}</p>
          ))}
          <p className="reflection-scope">
            Scope: {result.scope.examinedPresentNoteCount} of {result.scope.totalPresentNoteCount}{" "}
            present notes examined across {result.scope.examinedGameCount} games.
          </p>
          <CitationList state={state} />
        </div>
      )}
      {cache.state === "none" && state.attempt.state === "idle" && (
        <p className="reflection-status">Not generated.</p>
      )}
      <div className="profile-actions">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => onRefresh(state.questionId)}
          disabled={state.attempt.state === "refreshing" || refreshDisabled}
        >
          Refresh this question
        </button>
        {state.attempt.state === "refreshing" && (
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            Cancel refresh
          </button>
        )}
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => onToggle(state.questionId, !state.enabled)}
          disabled={refreshDisabled}
        >
          {state.enabled ? "Disable question" : "Enable question"}
        </button>
      </div>
    </article>
  );
}
