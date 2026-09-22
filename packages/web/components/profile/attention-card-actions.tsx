"use client";

import { useState } from "react";
import type { CollectionProfileAttentionAction } from "@shelf-judge/shared";
import { respondToAttention } from "@/lib/browser-mutations";

export function AttentionCardActions({ actions }: { actions: CollectionProfileAttentionAction[] }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const commands = actions.filter((action) => action.command !== null);
  if (commands.length === 0) return null;

  async function respond(action: CollectionProfileAttentionAction) {
    if (!action.command || busy) return;
    setBusy(true);
    setMessage("Saving your choice…");
    try {
      const result = await respondToAttention(action.command);
      if (result.outcome === "accepted" || result.outcome === "replayed") {
        setMessage("Your choice was saved. Updating your Profile…");
        window.setTimeout(() => window.location.reload(), 1200);
      } else {
        const stale =
          result.error.code === "stale-version" || result.error.code === "candidate-mismatch";
        setMessage(
          stale
            ? "Your choice was not saved because this card changed. Refresh the Profile to review the latest information."
            : "Your choice could not be saved. No change was made.",
        );
      }
    } catch {
      setMessage("Could not save your choice. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attention-card-actions">
      {commands.map((action) => (
        <button
          className="btn btn-secondary"
          key={action.action}
          type="button"
          disabled={busy}
          onClick={() => void respond(action)}
        >
          {action.command?.operation === "not-now" ? "Not now" : "I’ll keep this in mind"}
        </button>
      ))}
      <span role="status" aria-live="polite">
        {message}
      </span>
      {message.includes("Refresh the Profile") && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => window.location.reload()}
        >
          Refresh Profile
        </button>
      )}
    </div>
  );
}
