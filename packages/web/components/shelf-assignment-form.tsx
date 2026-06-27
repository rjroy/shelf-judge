"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export interface ShelfAssignmentOption {
  shelfId: string;
  label: string;
}

export function ShelfAssignmentForm({
  gameId,
  currentShelfId,
  options,
  hasDimensions,
  isPreviouslyOwned,
}: {
  gameId: string;
  currentShelfId: string | null;
  options: ShelfAssignmentOption[];
  hasDimensions: boolean;
  isPreviouslyOwned: boolean;
}) {
  const router = useRouter();
  const [selectedShelfId, setSelectedShelfId] = useState(currentShelfId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manualDisabled = !hasDimensions || isPreviouslyOwned;

  const handleSave = useCallback(async () => {
    if (manualDisabled && selectedShelfId !== "") return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/daemon/games/${gameId}/shelf-assignment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shelfId: selectedShelfId === "" ? null : selectedShelfId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Failed: ${response.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Shelf assignment save failed");
    } finally {
      setSaving(false);
    }
  }, [gameId, manualDisabled, router, selectedShelfId]);

  return (
    <div className="shelf-assignment-form">
      <div className="panel-section-title">Shelf Assignment</div>
      <label className="shelf-assignment-field">
        <span className="shelf-assignment-label">Placement</span>
        <select
          className="shelf-assignment-select"
          value={selectedShelfId}
          onChange={(event) => setSelectedShelfId(event.target.value)}
          disabled={saving}
        >
          <option value="">Automatic (fill shelves)</option>
          {options.map((option) => (
            <option key={option.shelfId} value={option.shelfId} disabled={manualDisabled}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {!hasDimensions ? (
        <div className="shelf-assignment-hint">
          Box dimensions are required before a shelf can be assigned.
        </div>
      ) : isPreviouslyOwned ? (
        <div className="shelf-assignment-hint">
          Previously owned games cannot be assigned to a physical shelf.
        </div>
      ) : options.length === 0 ? (
        <div className="shelf-assignment-hint">Configure shelves before assigning this game.</div>
      ) : (
        <div className="shelf-assignment-hint">
          Manual assignments reserve space before automatic placement.
        </div>
      )}
      {error && <div className="shelf-assignment-error">{error}</div>}
      <button
        className="btn-primary"
        onClick={() => void handleSave()}
        disabled={saving || (manualDisabled && selectedShelfId !== "")}
      >
        {saving ? "Saving..." : "Save shelf assignment"}
      </button>
    </div>
  );
}
