"use client";

import { useEffect, useRef } from "react";

export type CollectionSnapshotStatusState = "loading" | "error" | "degraded";

type Props = {
  state: CollectionSnapshotStatusState;
  onRetry?: () => void;
  unavailableFeatures?: string[];
};

/** Status feedback for the client-loaded Collection snapshot boundary. */
export function CollectionSnapshotStatus({ state, onRetry, unavailableFeatures = [] }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the error heading so assistive technology gets the context.
  // Its following retry button is the next tab stop; focus is never trapped.
  // Loading and degraded notices must not steal focus from existing controls.
  useEffect(() => {
    if (state === "error") headingRef.current?.focus();
  }, [state]);

  if (state === "loading") {
    return (
      <div
        className="collection-snapshot-status collection-snapshot-status--loading"
        role="status"
        aria-live="polite"
      >
        <span className="collection-snapshot-status__spinner" aria-hidden="true" />
        <span>Loading your games…</span>
      </div>
    );
  }

  if (state === "degraded") {
    return (
      <div
        className="collection-snapshot-status collection-snapshot-status--degraded"
        role="status"
        aria-live="polite"
      >
        <div>
          <strong>Some Collection details are unavailable.</strong>
          {unavailableFeatures.length > 0 && <p>Unavailable: {unavailableFeatures.join(", ")}.</p>}
          <p>You can still use the available game information.</p>
        </div>
        {onRetry && (
          <button type="button" className="collection-snapshot-status__button" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <section
      className="collection-snapshot-status collection-snapshot-status--error"
      role="alert"
      aria-live="assertive"
    >
      <h2 ref={headingRef} tabIndex={-1}>
        Your games couldn’t be loaded
      </h2>
      <p>We couldn’t load your games. Check your connection, then retry.</p>
      {onRetry && (
        <button type="button" className="collection-snapshot-status__button" onClick={onRetry}>
          Retry loading games
        </button>
      )}
    </section>
  );
}
