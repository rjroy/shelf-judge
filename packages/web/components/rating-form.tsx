"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Axis, FitnessResult } from "@shelf-judge/shared";
import { getRatingLabel } from "@shelf-judge/shared";

export function RatingForm({
  gameId,
  axes,
  currentRatings,
  predictionScore,
}: {
  gameId: string;
  axes: Axis[];
  currentRatings: Record<string, number>;
  predictionScore?: FitnessResult | null;
}) {
  const router = useRouter();
  const [ratings, setRatings] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const axis of axes) {
      if (currentRatings[axis.id] !== undefined) {
        initial[axis.id] = String(currentRatings[axis.id]);
      }
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const personalAxes = axes.filter((a) => a.source === "personal");
  const bggAxes = axes.filter((a) => a.source === "bgg");

  const predictionHints = new Map<
    string,
    { rating: number | null; confidence: string | null; refCount: number }
  >();
  if (predictionScore?.predictionMeta) {
    for (const entry of predictionScore.breakdown) {
      if (entry.source === "predicted") {
        predictionHints.set(entry.axisId, {
          rating: entry.rating,
          confidence: entry.predictionConfidence,
          refCount: entry.referenceGames?.length ?? 0,
        });
      }
    }
  }

  function handleChange(axisId: string, value: string) {
    setRatings((prev) => ({ ...prev, [axisId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const numericRatings: Record<string, number | null> = {};
    const invalidAxes: string[] = [];
    for (const [axisId, value] of Object.entries(ratings)) {
      if (value !== "") {
        const num = parseInt(value, 10);
        if (num >= 1 && num <= 10) {
          numericRatings[axisId] = num;
        } else {
          const axis = axes.find((a) => a.id === axisId);
          invalidAxes.push(axis?.name ?? axisId);
        }
      }
    }

    for (const axis of axes) {
      if (currentRatings[axis.id] !== undefined && !(axis.id in numericRatings)) {
        numericRatings[axis.id] = null;
      }
    }

    if (invalidAxes.length > 0) {
      setError(`Ratings must be between 1 and 10: ${invalidAxes.join(", ")}`);
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/daemon/games/${gameId}/ratings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratings: numericRatings }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save ratings");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    const initial: Record<string, string> = {};
    for (const axis of axes) {
      if (currentRatings[axis.id] !== undefined) {
        initial[axis.id] = String(currentRatings[axis.id]);
      }
    }
    setRatings(initial);
    setError(null);
  }

  const hasPredictionHints = predictionHints.size > 0;

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    >
      {error && <div className="error-banner">{error}</div>}

      {hasPredictionHints && (
        <div className="predict-callout">
          Predicted scores shown below. Your ratings override these predictions.
        </div>
      )}

      <div className="rating-form">
        {personalAxes.map((axis) => {
          const isRated = currentRatings[axis.id] !== undefined;
          const hint = !isRated ? predictionHints.get(axis.id) : undefined;
          const axisLabel = getRatingLabel(parseInt(ratings[axis.id] ?? "", 10));
          const bggLabel = getRatingLabel(currentRatings[axis.id] ?? null);
          const hintLabel =
            hint?.rating !== null && hint?.rating !== undefined
              ? getRatingLabel(hint.rating)
              : null;

          return (
            <div key={axis.id}>
              {hint && ratings[axis.id] === undefined ? (
                <div className="rating-predict-hint">
                  <div className="rating-predict-hint-label">
                    {hint.confidence === "insufficient"
                      ? "No similar games rated on this axis"
                      : `Predicted from ${hint.refCount} similar games`}
                  </div>
                  <div className="rating-field-header">
                    <div className="rating-field-name">{axis.name}</div>
                    <div className="rating-field-weight">Weight: {axis.weight}</div>
                  </div>
                  {hint.confidence !== "insufficient" && hint.rating !== null && (
                    <div>
                      <span className="rating-predict-hint-value">
                        ~{hint.rating}{hintLabel !== null ? ` ${hintLabel}` : ""}
                      </span>
                      <span
                        className="rating-predict-hint-link"
                        onClick={() => handleChange(axis.id, String(hint.rating))}
                      >
                        Rate &rarr;
                      </span>
                    </div>
                  )}
                  {hint.confidence === "insufficient" && (
                    <div className="rating-predict-hint-insufficient">
                      Not enough data for prediction
                    </div>
                  )}
                </div>
              ) : (
                <div className="rating-field">
                  <div className="rating-field-header">
                    <div className="rating-field-name">{axis.name}</div>
                    <div className="rating-field-weight">Weight: {axis.weight}</div>
                  </div>
                  {axis.description && <div className="rating-field-desc">{axis.description}</div>}
                  <div className="rating-input-row">
                    <input
                      type="range"
                      className="rating-slider"
                      min={1}
                      max={10}
                      value={ratings[axis.id] || "5"}
                      onChange={(e) => handleChange(axis.id, e.target.value)}
                    />
                    <input
                      type="number"
                      className="rating-value-input"
                      min={1}
                      max={10}
                      value={ratings[axis.id] ?? ""}
                      onChange={(e) => handleChange(axis.id, e.target.value)}
                    />
                  </div>
                  {axisLabel && (
                    <div className="rating-label-hint" style={{ fontSize: "0.75em", color: "#888" }}>
                      {axisLabel}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {bggAxes.length > 0 && (
          <>
            <hr className="section-divider" />
            <div className="panel-section-title bgg-section-title">BGG-Derived Axes</div>

            {bggAxes.map((axis) => {
              const hasOverride = ratings[axis.id] !== undefined && ratings[axis.id] !== "";
              return (
                <div key={axis.id} className="rating-field">
                  <div className="rating-field-header">
                    <div className="rating-field-name">
                      {axis.name}
                      <span className="source-badge source-bgg bgg-badge-inline">BGG</span>
                    </div>
                    <div className="rating-field-weight">Weight: {axis.weight}</div>
                  </div>
                  {axis.description && <div className="rating-field-desc">{axis.description}</div>}
                  {hasOverride ? (
                    <>
                      <div className="bgg-auto-value overridden">
                        <span>Your override: {ratings[axis.id]}</span>
                        <span className="value">{ratings[axis.id]}</span>
                        <span
                          className="override-link"
                          onClick={() => {
                            setRatings((prev) => {
                              const next = { ...prev };
                              delete next[axis.id];
                              return next;
                            });
                          }}
                        >
                          Revert to BGG &rsaquo;
                        </span>
                      </div>
                      <div className="rating-input-row">
                        <input
                          type="range"
                          className="rating-slider override-slider"
                          min={1}
                          max={10}
                          value={ratings[axis.id] || "5"}
                          onChange={(e) => handleChange(axis.id, e.target.value)}
                        />
                        <input
                          type="number"
                          className="rating-value-input override-value-input"
                          min={1}
                          max={10}
                          value={ratings[axis.id] ?? ""}
                          onChange={(e) => handleChange(axis.id, e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="bgg-auto-value">
                      <span>Auto-populated from BGG</span>
                      <span className="value">
                        {currentRatings[axis.id] ?? "\u2014"}
                        {currentRatings[axis.id] !== undefined &&
                          bggLabel && (
                            <span style={{ fontSize: "0.85em", color: "#888", marginLeft: "0.4em" }}>
                              {bggLabel}
                            </span>
                          )}
                      </span>
                      <span
                        className="override-link"
                        onClick={() => handleChange(axis.id, String(currentRatings[axis.id] ?? 5))}
                      >
                        Override &rsaquo;
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="save-btn-row">
        <button type="button" className="btn btn-secondary" onClick={handleCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving..." : "Save Ratings"}
        </button>
      </div>
    </form>
  );
}
