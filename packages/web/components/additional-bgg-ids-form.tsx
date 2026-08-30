"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAdditionalBggIds } from "@/lib/browser-mutations";

export function AdditionalBggIdsForm({
  gameId,
  additionalBggIds,
}: {
  gameId: string;
  additionalBggIds: number[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(additionalBggIds.join(", "));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const ids = parts.map(Number);
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      setMessage("Enter positive BGG IDs separated by commas.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const game = await setAdditionalBggIds(gameId, ids);
      setValue((game.additionalBggIds ?? []).join(", "));
      setMessage("Additional BGG IDs saved. Refresh BGG to import their plays.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save additional BGG IDs.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="action-section">
      <div className="panel-section-title">Related BGG Entries</div>
      <p className="text-muted">
        Plays logged against these stand-alone expansions or alternate versions count toward this
        game. Separate IDs with commas.
      </p>
      <div className="form-group">
        <label htmlFor="additional-bgg-ids">Additional BGG IDs</label>
        <input
          id="additional-bgg-ids"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="12345, 67890"
        />
      </div>
      <button
        className="btn btn-secondary"
        type="button"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving..." : "Save Related Entries"}
      </button>
      {message && (
        <div className="action-live-status" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
