"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { BoxDimensions } from "@shelf-judge/shared";

export function BoxDimensionsForm({
  gameId,
  currentDimensions,
}: {
  gameId: string;
  currentDimensions: BoxDimensions | null;
}) {
  const router = useRouter();
  const [width, setWidth] = useState(currentDimensions?.width?.toString() ?? "");
  const [height, setHeight] = useState(currentDimensions?.height?.toString() ?? "");
  const [depth, setDepth] = useState(currentDimensions?.depth?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasValues = width !== "" || height !== "" || depth !== "";
  const allFilled = width !== "" && height !== "" && depth !== "";
  const isPartial = hasValues && !allFilled;

  const handleSave = useCallback(async () => {
    if (!allFilled) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/daemon/games/${gameId}/dimensions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          width: parseFloat(width),
          height: parseFloat(height),
          depth: parseFloat(depth),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [allFilled, gameId, width, height, depth, router]);

  const handleClear = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/daemon/games/${gameId}/dimensions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      setWidth("");
      setHeight("");
      setDepth("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed");
    } finally {
      setSaving(false);
    }
  }, [gameId, router]);

  return (
    <div className="box-dims-form">
      <div className="panel-section-title">Box Dimensions</div>
      <div className="box-dims-inputs">
        <label className="box-dims-field">
          <span className="box-dims-label">Width</span>
          <div className="box-dims-input-wrap">
            <input
              type="number"
              className="box-dims-input"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              placeholder="e.g. 15"
              step="0.1"
              min="0.1"
              max="40"
            />
            <span className="box-dims-unit">in</span>
          </div>
        </label>
        <label className="box-dims-field">
          <span className="box-dims-label">Height</span>
          <div className="box-dims-input-wrap">
            <input
              type="number"
              className="box-dims-input"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="e.g. 11"
              step="0.1"
              min="0.1"
              max="40"
            />
            <span className="box-dims-unit">in</span>
          </div>
        </label>
        <label className="box-dims-field">
          <span className="box-dims-label">Depth</span>
          <div className="box-dims-input-wrap">
            <input
              type="number"
              className="box-dims-input"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              placeholder="e.g. 6"
              step="0.1"
              min="0.1"
              max="40"
            />
            <span className="box-dims-unit">in</span>
          </div>
        </label>
      </div>
      <div className="box-dims-hint">Width x Height x Depth. All three are required together.</div>
      {isPartial && (
        <div className="box-dims-validation">
          All three dimensions are required. Enter all or none.
        </div>
      )}
      {error && <div className="box-dims-error">{error}</div>}
      <div className="box-dims-actions">
        <button
          className="btn-primary"
          onClick={() => void handleSave()}
          disabled={!allFilled || saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {currentDimensions && (
          <button className="btn-danger-ghost" onClick={() => void handleClear()} disabled={saving}>
            Clear dimensions
          </button>
        )}
      </div>
    </div>
  );
}
