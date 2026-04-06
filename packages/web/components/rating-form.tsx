"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Axis } from "@shelf-judge/shared";

export function RatingForm({
  gameId,
  axes,
  currentRatings,
}: {
  gameId: string;
  axes: Axis[];
  currentRatings: Record<string, number>;
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

  function handleChange(axisId: string, value: string) {
    setRatings((prev) => ({ ...prev, [axisId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const numericRatings: Record<string, number> = {};
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
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
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

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error-banner">{error}</div>}

      <div className="rating-form">
        {personalAxes.map((axis) => (
          <div key={axis.id} className="rating-field">
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
          </div>
        ))}

        {bggAxes.length > 0 && (
          <>
            <hr className="section-divider" />
            <div className="panel-section-title" style={{ marginBottom: 12 }}>
              BGG-Derived Axes
            </div>

            {bggAxes.map((axis) => {
              const hasOverride = ratings[axis.id] !== undefined && ratings[axis.id] !== "";
              return (
                <div key={axis.id} className="rating-field">
                  <div className="rating-field-header">
                    <div className="rating-field-name">
                      {axis.name}
                      <span
                        className="source-badge source-bgg"
                        style={{ marginLeft: 6, verticalAlign: "middle" }}
                      >
                        BGG
                      </span>
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
                          Revert to BGG ›
                        </span>
                      </div>
                      <div className="rating-input-row">
                        <input
                          type="range"
                          className="rating-slider"
                          min={1}
                          max={10}
                          value={ratings[axis.id] || "5"}
                          onChange={(e) => handleChange(axis.id, e.target.value)}
                          style={{ accentColor: "var(--override-accent)" }}
                        />
                        <input
                          type="number"
                          className="rating-value-input"
                          min={1}
                          max={10}
                          value={ratings[axis.id] ?? ""}
                          onChange={(e) => handleChange(axis.id, e.target.value)}
                          style={{
                            color: "var(--override-accent)",
                            borderColor: "var(--override-accent)",
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="bgg-auto-value">
                      <span>Auto-populated from BGG</span>
                      <span className="value">{currentRatings[axis.id] ?? "—"}</span>
                      <span
                        className="override-link"
                        onClick={() => handleChange(axis.id, String(currentRatings[axis.id] ?? 5))}
                      >
                        Override ›
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
