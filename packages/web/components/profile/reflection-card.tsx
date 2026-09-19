"use client";

import { useState } from "react";
import type { ReflectionQuestionState } from "@shelf-judge/shared";
import { presentReflectionEvidence } from "./reflection-evidence-presentation";

function CitationList({
  state,
  gameTitles,
}: {
  state: ReflectionQuestionState;
  gameTitles: ReadonlyMap<string, string>;
}) {
  if (state.cache.state === "none") return null;
  const stale = state.cache.state === "stale";
  return (
    <ul className="reflection-citations" aria-label="Evidence used">
      {presentReflectionEvidence(state.cache.result.citations, stale, gameTitles).map(
        ({ citation, gameTitle, href, label, traces }) => (
          <li key={citation.citationId}>
            {label}:{" "}
            {stale ? (
              <>
                <a href={`#reflection-citation-${citation.citationId}`}>
                  <em>{gameTitle ?? citation.canonicalSummary}</em>
                </a>
                <details id={`reflection-citation-${citation.citationId}`}>
                  <summary>Captured snapshot</summary>
                  <p>{citation.canonicalSummary}</p>
                  {traces.map((trace) => (
                    <div key={trace.citationId}>
                      <p>Citation ID: {trace.citationId}</p>
                      <p>Source version: {trace.sourceVersion}</p>
                      {trace.observedAt === undefined ? null : <p>Observed: {trace.observedAt}</p>}
                    </div>
                  ))}
                </details>
              </>
            ) : href === undefined ? (
              <em>{gameTitle ?? citation.canonicalSummary}</em>
            ) : (
              <a href={href}>
                <em>{gameTitle ?? citation.canonicalSummary}</em>
              </a>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

export function ReflectionCard({
  state,
  gameTitles,
  wording,
  onRefresh,
  onToggle,
  onCancel,
  refreshDisabled,
}: {
  state: ReflectionQuestionState;
  gameTitles: ReadonlyMap<string, string>;
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
            <>
              <p>Unable to provide a reflection: {result.explanation}</p>
              {result.abstentionGuidance === undefined ? null : (
                <div className="reflection-note-guidance">
                  <p>{result.abstentionGuidance.message}</p>
                  <p>{result.abstentionGuidance.refreshInstruction}</p>
                </div>
              )}
            </>
          )}
          {result.supportingBlocks.map((block) => (
            <p key={block.text}>{block.text}</p>
          ))}
          <p className="reflection-scope">
            Scope: {result.scope.examinedPresentNoteCount} of {result.scope.totalPresentNoteCount}{" "}
            present notes examined across {result.scope.examinedGameCount} games.
          </p>
          <CitationList state={state} gameTitles={gameTitles} />
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
