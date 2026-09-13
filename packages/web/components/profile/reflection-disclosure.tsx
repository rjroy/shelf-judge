"use client";

import type { GroundedProviderConfigurationStatus } from "@shelf-judge/shared";
import { useEffect, useRef } from "react";

export function ReflectionDisclosure({
  configuration,
  questionCount,
  onConfirm,
  onCancel,
}: {
  configuration: GroundedProviderConfigurationStatus;
  questionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const configured = configuration.status === "configured";
  const provider = configured ? configuration.identity.providerId : "Unavailable";
  const model = configured ? configuration.identity.modelId : "Unavailable";
  useEffect(() => {
    cancelButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || dialog.current === null) return;
      const controls = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        ),
      );
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      ref={dialog}
      className="reflection-disclosure"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reflection-disclosure-title"
    >
      <h3 id="reflection-disclosure-title">Before refreshing reflections</h3>
      <p>
        Provider: <strong>{provider}</strong>. Model: <strong>{model}</strong>.
      </p>
      <p>
        Relevant owner notes (as testimony) and bounded deterministic collection evidence may leave
        this application for provider processing. Provider retention follows its configured policy.
      </p>
      <p>
        Shelf Judge retains validated reflection output and safe citation snapshots locally. It has
        no fixed inference round-trip, token, or monetary cap. This batch has {questionCount} model
        operation{questionCount === 1 ? "" : "s"}.
      </p>
      <p>
        You can cancel after transmission. Transmitted content may already have been processed and
        may incur cost.
      </p>
      {!configured && (
        <p className="reflection-status" role="status">
          Model configuration is unavailable. Refresh cannot start.
        </p>
      )}
      <div className="profile-actions">
        <button ref={cancelButton} className="btn btn-secondary" type="button" onClick={onCancel}>
          Leave without sending
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={onConfirm}
          disabled={!configured}
        >
          Acknowledge and refresh
        </button>
      </div>
    </div>
  );
}
