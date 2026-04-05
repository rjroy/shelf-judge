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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // Validate and collect ratings
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

  return (
    <form onSubmit={handleSubmit}>
      {error && <p style={{ color: "#c00", marginBottom: 12 }}>{error}</p>}

      <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {axes.map((axis) => (
            <tr key={axis.id}>
              <td style={{ padding: "4px 12px 4px 0" }}>
                <label htmlFor={`rating-${axis.id}`}>
                  {axis.name}
                  {axis.source === "bgg" && (
                    <span style={{ color: "#059669", fontSize: 12, marginLeft: 4 }}>(BGG)</span>
                  )}
                </label>
              </td>
              <td style={{ padding: "4px 0" }}>
                <input
                  id={`rating-${axis.id}`}
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={ratings[axis.id] ?? ""}
                  onChange={(e) =>
                    setRatings((prev) => ({
                      ...prev,
                      [axis.id]: e.target.value,
                    }))
                  }
                  placeholder={axis.source === "bgg" ? "auto from BGG" : "1-10"}
                  style={{
                    width: 60,
                    padding: "4px 8px",
                    border: "1px solid #ccc",
                    borderRadius: 4,
                  }}
                />
                <span style={{ marginLeft: 4, color: "#999", fontSize: 12 }}>
                  (w: {axis.weight})
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        type="submit"
        disabled={saving}
        style={{
          marginTop: 12,
          padding: "8px 16px",
          backgroundColor: saving ? "#999" : "#2563eb",
          color: "white",
          border: "none",
          borderRadius: 4,
          cursor: saving ? "default" : "pointer",
          fontSize: 14,
        }}
      >
        {saving ? "Saving..." : "Save Ratings"}
      </button>
    </form>
  );
}
