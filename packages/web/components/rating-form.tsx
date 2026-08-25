"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Axis, FitnessResult } from "@shelf-judge/shared";
import { getRatingLabel } from "@shelf-judge/shared";

export interface RatingFormProps {
  gameId: string;
  axes: Axis[];
  currentRatings: Record<string, number>;
  predictionScore?: FitnessResult | null;
  score?: FitnessResult | null;
}

interface RatingFormContentProps extends RatingFormProps {
  refresh: () => void;
  request?: typeof fetch;
}

export function RatingForm(props: RatingFormProps) {
  const router = useRouter();
  return <RatingFormContent {...props} refresh={() => router.refresh()} />;
}

export function RatingFormContent({
  gameId,
  axes,
  currentRatings,
  predictionScore,
  score,
  refresh,
  request = fetch,
}: RatingFormContentProps) {
  const editableAxes = axes.filter(isEditableRatingAxis);
  const [ratings, setRatings] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const axis of editableAxes) {
      if (currentRatings[axis.id] !== undefined) {
        initial[axis.id] = String(currentRatings[axis.id]);
      }
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const personalAxes = editableAxes.filter((axis) => axis.source === "personal");
  const derivedAxes = editableAxes.filter((axis) => axis.source === "derived");
  const resolvedByAxis = new Map(
    ((score ?? predictionScore)?.breakdown ?? []).map((entry) => [entry.axisId, entry]),
  );

  const predictionHints = new Map<
    string,
    { rating: number | null; confidence: string | null; refCount: number }
  >();
  if (predictionScore?.predictionMeta) {
    for (const entry of predictionScore.breakdown) {
      if (entry.source === "predicted") {
        predictionHints.set(entry.axisId, {
          rating: entry.effectiveRating,
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

    const { ratings: numericRatings, invalidAxes } = buildRatingMutation(
      editableAxes,
      currentRatings,
      ratings,
    );

    if (invalidAxes.length > 0) {
      setError(`Ratings must be between 1 and 10: ${invalidAxes.join(", ")}`);
      setSaving(false);
      return;
    }

    try {
      const res = await request(`/api/daemon/games/${gameId}/ratings`, {
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

      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save ratings");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    const initial: Record<string, string> = {};
    for (const axis of editableAxes) {
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
                        ~{hint.rating}
                        {hintLabel !== null ? ` ${hintLabel}` : ""}
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
                    <div
                      className="rating-label-hint"
                      style={{ fontSize: "0.75em", color: "#888" }}
                    >
                      {axisLabel}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {derivedAxes.length > 0 && (
          <>
            <hr className="section-divider" />
            <div className="panel-section-title bgg-section-title">Derived Axes</div>

            {derivedAxes.map((axis) => {
              const hasOverride = ratings[axis.id] !== undefined && ratings[axis.id] !== "";
              const resolution = resolvedByAxis.get(axis.id);
              const effectiveRating = resolution?.effectiveRating ?? null;
              return (
                <div key={axis.id} className="rating-field">
                  <div className="rating-field-header">
                    <div className="rating-field-name">
                      {axis.name}
                      <span className="source-badge source-bgg bgg-badge-inline">Derived</span>
                    </div>
                    <div className="rating-field-weight">Weight: {axis.weight}</div>
                  </div>
                  {axis.description && <div className="rating-field-desc">{axis.description}</div>}
                  <div className="derived-rating-facts">
                    {resolution?.sourceValue === null || resolution === undefined ? (
                      <span>Source metadata unavailable</span>
                    ) : (
                      <span>
                        Published value: {resolution.sourceValue} {resolution.unit ?? ""}
                      </span>
                    )}
                    {resolution &&
                      resolution.scoringRawValue !== null &&
                      resolution.sourceValue !== null &&
                      resolution.scoringRawValue !== resolution.sourceValue && (
                        <span>
                          Scoring input: {resolution.scoringRawValue} {resolution.unit ?? ""}
                        </span>
                      )}
                    {resolution?.provenance && <span>{resolution.provenance}</span>}
                    {resolution?.configurationSummary && (
                      <span>{resolution.configurationSummary}</span>
                    )}
                  </div>
                  {hasOverride ? (
                    <>
                      <div className="bgg-auto-value overridden">
                        <span>Stored override (1-10): {ratings[axis.id]}</span>
                        <span className="value">{ratings[axis.id]}</span>
                        <button
                          type="button"
                          className="override-link"
                          onClick={() => {
                            setRatings((prev) => {
                              const next = { ...prev };
                              delete next[axis.id];
                              return next;
                            });
                          }}
                        >
                          Clear override &rsaquo;
                        </button>
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
                      <span>
                        {effectiveRating === null
                          ? "No effective rating from metadata"
                          : "Effective rating (1-10)"}
                      </span>
                      <span className="value">
                        {effectiveRating ?? "\u2014"}
                        {effectiveRating !== null && getRatingLabel(effectiveRating) && (
                          <span style={{ fontSize: "0.85em", color: "#888", marginLeft: "0.4em" }}>
                            {getRatingLabel(effectiveRating)}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="override-link"
                        onClick={() =>
                          handleChange(axis.id, String(derivedOverrideDraft(effectiveRating)))
                        }
                      >
                        Override &rsaquo;
                      </button>
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

export function buildRatingMutation(
  axes: Axis[],
  currentRatings: Record<string, number>,
  drafts: Record<string, string>,
): { ratings: Record<string, number | null>; invalidAxes: string[] } {
  const ratings: Record<string, number | null> = {};
  const invalidAxes: string[] = [];
  const editableAxes = axes.filter(isEditableRatingAxis);
  const editableAxisById = new Map(editableAxes.map((axis) => [axis.id, axis]));
  for (const [axisId, value] of Object.entries(drafts)) {
    const axis = editableAxisById.get(axisId);
    if (!axis) continue;
    if (value === "") continue;
    const rating = Number(value);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 10) ratings[axisId] = rating;
    else invalidAxes.push(axis.name);
  }
  for (const axis of editableAxes) {
    if (currentRatings[axis.id] !== undefined && !(axis.id in ratings)) ratings[axis.id] = null;
  }
  return { ratings, invalidAxes };
}

function isEditableRatingAxis(axis: Axis): boolean {
  return axis.enabled && (axis.source === "personal" || axis.source === "derived");
}

function derivedOverrideDraft(effectiveRating: number | null): number {
  if (effectiveRating === null || !Number.isFinite(effectiveRating)) return 5;
  return Math.min(10, Math.max(1, Math.round(effectiveRating)));
}
