"use client";

import { useState, useEffect } from "react";

interface Axis {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  source: "personal" | "bgg";
  bggField: string | null;
  createdAt: string;
  updatedAt: string;
}

interface GameWithScore {
  game: {
    id: string;
    ratings: Record<string, number>;
  };
  score: unknown;
}

export default function AxesPage() {
  const [axes, setAxes] = useState<Axis[]>([]);
  const [games, setGames] = useState<GameWithScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newWeight, setNewWeight] = useState("50");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [axesRes, gamesRes] = await Promise.all([
        fetch("/api/daemon/axes"),
        fetch("/api/daemon/games"),
      ]);
      if (!axesRes.ok) throw new Error("Failed to load axes");
      if (!gamesRes.ok) throw new Error("Failed to load games");
      setAxes(await axesRes.json());
      setGames(await gamesRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  function ratingsCountForAxis(axisId: string): number {
    return games.filter((g) => g.game.ratings[axisId] !== undefined).length;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);

    try {
      const res = await fetch("/api/daemon/axes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          weight: parseInt(newWeight, 10),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      setNewName("");
      setNewDescription("");
      setNewWeight("50");
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create axis");
    }
  }

  async function handleUpdate(id: string) {
    setError(null);
    try {
      const body: { name?: string; weight?: number; description?: string } = {};
      const axis = axes.find((a) => a.id === id);
      if (editName.trim() && editName.trim() !== axis?.name) body.name = editName.trim();
      if (editWeight) body.weight = parseInt(editWeight, 10);
      if (editDescription !== axis?.description) body.description = editDescription;

      const res = await fetch(`/api/daemon/axes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      setEditingId(null);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update axis");
    }
  }

  async function handleDelete(axis: Axis) {
    const count = ratingsCountForAxis(axis.id);
    const msg =
      count > 0
        ? `Delete "${axis.name}"? This will remove ratings from ${count} game${count === 1 ? "" : "s"}.`
        : `Delete "${axis.name}"?`;
    if (!confirm(msg)) return;

    setError(null);
    try {
      const res = await fetch(`/api/daemon/axes/${axis.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete axis");
    }
  }

  if (loading) return <p>Loading axes...</p>;

  return (
    <div>
      <h1>Axes</h1>

      {error && <p style={{ color: "#c00", marginBottom: 12 }}>{error}</p>}

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}>
            <th style={{ padding: "6px 10px" }}>Name</th>
            <th style={{ padding: "6px 10px" }}>Weight</th>
            <th style={{ padding: "6px 10px" }}>Source</th>
            <th style={{ padding: "6px 10px" }}>Games Rated</th>
            <th style={{ padding: "6px 10px" }}></th>
          </tr>
        </thead>
        <tbody>
          {axes.map((axis) => (
            <tr key={axis.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "6px 10px" }}>
                {editingId === axis.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Axis name"
                      required
                      style={{ padding: "2px 4px", border: "1px solid #ccc", borderRadius: 4 }}
                    />
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Description (optional)"
                      style={{
                        padding: "2px 4px",
                        border: "1px solid #ccc",
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                    />
                  </div>
                ) : (
                  <>
                    {axis.name}
                    {axis.description && (
                      <div style={{ fontSize: 12, color: "#666" }}>{axis.description}</div>
                    )}
                  </>
                )}
              </td>
              <td style={{ padding: "6px 10px" }}>
                {editingId === axis.id ? (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={editWeight}
                    onChange={(e) => setEditWeight(e.target.value)}
                    style={{ width: 60, padding: "2px 4px" }}
                  />
                ) : (
                  axis.weight
                )}
              </td>
              <td style={{ padding: "6px 10px" }}>
                <span
                  style={{
                    color: axis.source === "bgg" ? "#059669" : "#2563eb",
                  }}
                >
                  {axis.source === "bgg" ? "BGG" : "Personal"}
                </span>
              </td>
              <td style={{ padding: "6px 10px" }}>{ratingsCountForAxis(axis.id)}</td>
              <td style={{ padding: "6px 10px" }}>
                {editingId === axis.id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => handleUpdate(axis.id)}
                      style={{
                        padding: "2px 8px",
                        backgroundColor: "#2563eb",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      style={{
                        padding: "2px 8px",
                        backgroundColor: "#666",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => {
                        setEditingId(axis.id);
                        setEditName(axis.name);
                        setEditWeight(String(axis.weight));
                        setEditDescription(axis.description ?? "");
                      }}
                      style={{
                        padding: "2px 8px",
                        background: "none",
                        border: "1px solid #ccc",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(axis)}
                      style={{
                        padding: "2px 8px",
                        background: "none",
                        border: "1px solid #dc2626",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12,
                        color: "#dc2626",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Create New Axis</h2>
      <form
        onSubmit={handleCreate}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}
      >
        <div>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            style={{ padding: "6px 10px", border: "1px solid #ccc", borderRadius: 4 }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Description</label>
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Optional"
            style={{ padding: "6px 10px", border: "1px solid #ccc", borderRadius: 4 }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Weight (0-100)</label>
          <input
            type="number"
            min={0}
            max={100}
            value={newWeight}
            onChange={(e) => setNewWeight(e.target.value)}
            required
            style={{ padding: "6px 10px", border: "1px solid #ccc", borderRadius: 4, width: 80 }}
          />
        </div>
        <button
          type="submit"
          style={{
            padding: "8px 16px",
            backgroundColor: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Create Axis
        </button>
      </form>
    </div>
  );
}
