"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NarrationCacheState } from "@shelf-judge/shared";

interface NarrationActionsProps {
  state: NarrationCacheState;
}

export function NarrationActions({ state }: NarrationActionsProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/daemon/profile/narrate", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Generation failed (${res.status})`);
        return;
      }
      // Refresh the page to show the new narration from the server component
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const label = state === "empty" ? "Generate Narrative" : "Regenerate";

  return (
    <div className="narration-actions">
      <button className="btn-narrate" disabled={loading} onClick={() => void handleGenerate()}>
        {loading ? "Generating..." : label}
      </button>
      {error && <div className="narration-error">{error}</div>}
    </div>
  );
}
