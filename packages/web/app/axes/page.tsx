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
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    void loadData();
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
      setAxes((await axesRes.json()) as Axis[]);
      setGames((await gamesRes.json()) as GameWithScore[]);
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
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      setNewName("");
      setNewDescription("");
      setNewWeight("50");
      void loadData();
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
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      setEditingId(null);
      void loadData();
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
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Failed: ${res.status}`);
      }
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete axis");
    }
  }

  if (loading) return <p className="axes-content loading-text">Loading axes...</p>;

  const personalAxes = axes.filter((a) => a.source === "personal");
  const bggAxes = axes.filter((a) => a.source === "bgg");
  const totalWeight = axes.reduce((sum, a) => sum + a.weight, 0);

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Rating Axes</div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          + New Axis
        </button>
      </div>

      <div className="main-scroll">
        <div className="axes-content">
          {error && <div className="error-banner">{error}</div>}

          {/* Weight summary */}
          <div className="weight-summary">
            <div className="weight-summary-label">Total weight</div>
            <div className="weight-total-bar">
              {/* Dynamic width: indicates whether any weight is defined */}
              <div
                className="weight-total-fill"
                style={{ width: totalWeight > 0 ? "100%" : "0%" }}
              />
            </div>
            <div className="weight-summary-total">{totalWeight}</div>
          </div>

          {/* Create form (toggleable) */}
          {showCreate && (
            <div className="create-form">
              <form
                onSubmit={(e) => {
                  void handleCreate(e);
                }}
              >
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input
                      className="form-input"
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                      placeholder="Axis name"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Weight (0-100)</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      max={100}
                      value={newWeight}
                      onChange={(e) => setNewWeight(e.target.value)}
                      required
                    />
                    <span className="form-hint">Relative importance of this axis</span>
                  </div>
                </div>
                <div className="form-group form-group-mb">
                  <label className="form-label">Description</label>
                  <input
                    className="form-input"
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Optional description"
                  />
                </div>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Create Axis
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Personal axes */}
          <div className="section-label">Personal axes &middot; {personalAxes.length}</div>

          {personalAxes.map((axis) => (
            <div key={axis.id} className="axis-card">
              <div className="axis-card-main">
                <div>
                  {editingId === axis.id ? (
                    <div className="edit-fields">
                      <input
                        className="form-input"
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Axis name"
                      />
                      <input
                        className="form-input edit-desc-input"
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Description (optional)"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="axis-name">{axis.name}</div>
                      {axis.description && <div className="axis-desc">{axis.description}</div>}
                    </>
                  )}
                </div>
                <span className="personal-source-tag">Personal</span>
                <div className="weight-display">
                  {editingId === axis.id ? (
                    <input
                      className="form-input weight-edit-input"
                      type="number"
                      min={0}
                      max={100}
                      value={editWeight}
                      onChange={(e) => setEditWeight(e.target.value)}
                    />
                  ) : (
                    <>
                      <div className="weight-number">{axis.weight}</div>
                      <div className="weight-pct">
                        {totalWeight > 0 ? Math.round((axis.weight / totalWeight) * 100) : 0}% of
                        total
                      </div>
                    </>
                  )}
                </div>
                <div className="weight-bar-track">
                  {/* Dynamic width: proportional weight relative to total */}
                  <div
                    className="weight-bar-fill"
                    style={{
                      width: `${totalWeight > 0 ? (axis.weight / totalWeight) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="axis-actions">
                  {editingId === axis.id ? (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          void handleUpdate(axis.id);
                        }}
                      >
                        Save
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setEditingId(axis.id);
                          setEditName(axis.name);
                          setEditWeight(String(axis.weight));
                          setEditDescription(axis.description ?? "");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger-outline btn-sm"
                        onClick={() => {
                          void handleDelete(axis);
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="axis-stats-strip">
                <div className="axis-stat">
                  Rated on <strong>{ratingsCountForAxis(axis.id)} games</strong>
                </div>
                <div className="axis-stat">
                  Created{" "}
                  <strong>
                    {new Date(axis.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                    })}
                  </strong>
                </div>
              </div>
            </div>
          ))}

          {/* BGG axes */}
          {bggAxes.length > 0 && (
            <>
              <div className="section-label section-label-mt">
                BGG-derived axes &middot; {bggAxes.length}
              </div>
              <p className="bgg-axes-desc">
                These axes are automatically populated from BoardGameGeek data. You can override any
                individual game{"'"}s value.
              </p>

              {bggAxes.map((axis) => (
                <div key={axis.id} className="axis-card">
                  <div className="axis-card-main">
                    <div>
                      {editingId === axis.id ? (
                        <div className="edit-fields">
                          <input
                            className="form-input"
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Axis name"
                          />
                          <input
                            className="form-input edit-desc-input"
                            type="text"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            placeholder="Description (optional)"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="axis-name">{axis.name}</div>
                          {axis.description && <div className="axis-desc">{axis.description}</div>}
                        </>
                      )}
                    </div>
                    <span className="bgg-source-tag">&#8599; BGG</span>
                    <div className="weight-display">
                      {editingId === axis.id ? (
                        <input
                          className="form-input weight-edit-input"
                          type="number"
                          min={0}
                          max={100}
                          value={editWeight}
                          onChange={(e) => setEditWeight(e.target.value)}
                        />
                      ) : (
                        <>
                          <div className="weight-number">{axis.weight}</div>
                          <div className="weight-pct">
                            {totalWeight > 0 ? Math.round((axis.weight / totalWeight) * 100) : 0}%
                            of total
                          </div>
                        </>
                      )}
                    </div>
                    <div className="weight-bar-track">
                      {/* Dynamic width: proportional weight relative to total */}
                      <div
                        className="weight-bar-fill"
                        style={{
                          width: `${totalWeight > 0 ? (axis.weight / totalWeight) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="axis-actions">
                      {editingId === axis.id ? (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              void handleUpdate(axis.id);
                            }}
                          >
                            Save
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setEditingId(axis.id);
                              setEditName(axis.name);
                              setEditWeight(String(axis.weight));
                              setEditDescription(axis.description ?? "");
                            }}
                          >
                            Edit Weight
                          </button>
                          <button
                            className="btn btn-danger-outline btn-sm"
                            onClick={() => {
                              void handleDelete(axis);
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="axis-stats-strip bgg-strip">
                    <div className="axis-stat">
                      Auto-populated on <strong>{ratingsCountForAxis(axis.id)} games</strong>
                    </div>
                    {axis.bggField && (
                      <div className="axis-stat">
                        BGG source: <strong>{axis.bggField}</strong>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
