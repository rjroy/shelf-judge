"use client";

import { useState } from "react";
import { setProfileAttentionCardLimit } from "@/lib/browser-mutations";

export function AttentionLimitControl({ initialLimit }: { initialLimit: number }) {
  const [limit, setLimit] = useState(String(initialLimit));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (limit.trim() === "") {
      setMessage("Enter a whole number from 0 to 24.");
      return;
    }
    const value = Number(limit);
    if (!Number.isInteger(value) || value < 0 || value > 24) {
      setMessage("Enter a whole number from 0 to 24.");
      return;
    }
    setBusy(true);
    setMessage("Saving…");
    try {
      const saved = await setProfileAttentionCardLimit(value);
      setLimit(String(saved));
      setMessage("Attention card limit saved.");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this setting.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="attention-limit-control" onSubmit={(event) => void save(event)}>
      <label htmlFor="attention-card-limit">Profile attention cards</label>
      <p id="attention-limit-help">Choose how many ranked cards appear on your Profile (0–24).</p>
      <div className="attention-limit-row">
        <input
          id="attention-card-limit"
          aria-describedby="attention-limit-help"
          type="number"
          min="0"
          max="24"
          step="1"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Save
        </button>
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
