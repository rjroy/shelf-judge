"use client";

import { useState, useEffect, useCallback } from "react";
import type { Shelf, ShelfUnit, ShelfConfiguration } from "@shelf-judge/shared";

async function fetchShelfConfig(): Promise<ShelfConfiguration> {
  const res = await fetch("/api/daemon/shelf/config");
  if (!res.ok) throw new Error(`Failed to load shelf configuration: ${res.status}`);
  return (await res.json()) as ShelfConfiguration;
}

async function fetchAddShelfUnit(input: {
  name: string;
  shelves: Array<{ name: string; width: number; height: number | null; depth: number }>;
}): Promise<ShelfUnit> {
  const res = await fetch("/api/daemon/shelf/units", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
      error?: string;
    };
    throw new Error(data.error ?? `Failed to add unit: ${res.status}`);
  }
  return (await res.json()) as ShelfUnit;
}

async function fetchUpdateShelfUnit(
  id: string,
  input: {
    name?: string;
    shelves?: Array<{
      id?: string;
      name: string;
      width: number;
      height: number | null;
      depth: number;
    }>;
  },
): Promise<ShelfUnit> {
  const res = await fetch(`/api/daemon/shelf/units/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
      error?: string;
    };
    throw new Error(data.error ?? `Failed to update unit: ${res.status}`);
  }
  return (await res.json()) as ShelfUnit;
}

async function fetchRemoveShelfUnit(id: string): Promise<void> {
  const res = await fetch(`/api/daemon/shelf/units/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
      error?: string;
    };
    throw new Error(data.error ?? `Failed to remove unit: ${res.status}`);
  }
}

interface AddShelfForm {
  name: string;
  width: string;
  height: string;
  depth: string;
}

const EMPTY_SHELF_FORM: AddShelfForm = { name: "", width: "", height: "", depth: "" };

function computeSummary(units: ShelfUnit[]) {
  let totalShelves = 0;
  let totalCapacity = 0;
  let unconstrainedCount = 0;

  for (const unit of units) {
    for (const shelf of unit.shelves) {
      totalShelves++;
      if (shelf.height === null) {
        unconstrainedCount++;
      } else {
        totalCapacity += shelf.width * shelf.height * shelf.depth;
      }
    }
  }

  return { totalShelves, totalCapacity, unconstrainedCount };
}

function formatCapacity(volumeIn3: number): string {
  return volumeIn3.toLocaleString() + " in\u00B3";
}

export default function ShelvesPage() {
  const [config, setConfig] = useState<ShelfConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const [addingUnit, setAddingUnit] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");
  const [shelfForms, setShelfForms] = useState<Record<string, AddShelfForm>>({});
  const [editingShelf, setEditingShelf] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AddShelfForm>(EMPTY_SHELF_FORM);
  const [renamingUnit, setRenamingUnit] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const reload = useCallback(async () => {
    try {
      const data = await fetchShelfConfig();
      setConfig(data);
      setExpandedUnits(new Set(data.units.map((u) => u.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shelf configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleUnit = (unitId: string) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const handleAddUnit = async () => {
    if (!newUnitName.trim()) return;
    setError(null);
    try {
      const unit = await fetchAddShelfUnit({ name: newUnitName.trim(), shelves: [] });
      setConfig((prev) => (prev ? { ...prev, units: [...prev.units, unit] } : prev));
      setExpandedUnits((prev) => new Set([...prev, unit.id]));
      setNewUnitName("");
      setAddingUnit(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add unit");
    }
  };

  const handleRemoveUnit = async (unitId: string) => {
    const unit = config?.units.find((u) => u.id === unitId);
    const shelfCount = unit?.shelves.length ?? 0;
    const message =
      shelfCount > 0
        ? `Remove "${unit?.name}" and its ${shelfCount} ${shelfCount === 1 ? "shelf" : "shelves"}?`
        : `Remove "${unit?.name}"?`;
    if (!window.confirm(message)) return;
    setError(null);
    try {
      await fetchRemoveShelfUnit(unitId);
      setConfig((prev) =>
        prev ? { ...prev, units: prev.units.filter((u) => u.id !== unitId) } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove unit");
    }
  };

  const handleRenameUnit = async (unitId: string) => {
    if (!renameValue.trim()) return;
    setError(null);
    try {
      const updated = await fetchUpdateShelfUnit(unitId, { name: renameValue.trim() });
      setConfig((prev) =>
        prev ? { ...prev, units: prev.units.map((u) => (u.id === unitId ? updated : u)) } : prev,
      );
      setRenamingUnit(null);
      setRenameValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename unit");
    }
  };

  const getShelfForm = (unitId: string): AddShelfForm => {
    return shelfForms[unitId] ?? EMPTY_SHELF_FORM;
  };

  const updateShelfForm = (unitId: string, patch: Partial<AddShelfForm>) => {
    setShelfForms((prev) => ({
      ...prev,
      [unitId]: { ...(prev[unitId] ?? EMPTY_SHELF_FORM), ...patch },
    }));
  };

  const handleAddShelf = async (unit: ShelfUnit) => {
    const form = getShelfForm(unit.id);
    if (!form.name.trim()) return;

    const width = parseFloat(form.width);
    const depth = parseFloat(form.depth);
    const height = form.height.trim() === "" ? null : parseFloat(form.height);

    if (!Number.isFinite(width) || width <= 0) {
      setError("Width must be a positive number");
      return;
    }
    if (!Number.isFinite(depth) || depth <= 0) {
      setError("Depth must be a positive number");
      return;
    }
    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      setError("Height must be a positive number or left blank for unconstrained");
      return;
    }

    setError(null);
    try {
      const newShelves = [
        ...unit.shelves.map((s) => ({
          id: s.id,
          name: s.name,
          width: s.width,
          height: s.height,
          depth: s.depth,
        })),
        { name: form.name.trim(), width, height, depth },
      ];
      const updated = await fetchUpdateShelfUnit(unit.id, { shelves: newShelves });
      setConfig((prev) =>
        prev ? { ...prev, units: prev.units.map((u) => (u.id === unit.id ? updated : u)) } : prev,
      );
      setShelfForms((prev) => ({ ...prev, [unit.id]: EMPTY_SHELF_FORM }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add shelf");
    }
  };

  const handleRemoveShelf = async (unit: ShelfUnit, shelfId: string) => {
    const shelf = unit.shelves.find((s) => s.id === shelfId);
    if (!window.confirm(`Remove shelf "${shelf?.name}"?`)) return;
    setError(null);
    try {
      const newShelves = unit.shelves
        .filter((s) => s.id !== shelfId)
        .map((s) => ({ id: s.id, name: s.name, width: s.width, height: s.height, depth: s.depth }));
      const updated = await fetchUpdateShelfUnit(unit.id, { shelves: newShelves });
      setConfig((prev) =>
        prev ? { ...prev, units: prev.units.map((u) => (u.id === unit.id ? updated : u)) } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove shelf");
    }
  };

  const handleEditShelf = (shelf: Shelf) => {
    setEditingShelf(shelf.id);
    setEditForm({
      name: shelf.name,
      width: String(shelf.width),
      height: shelf.height === null ? "" : String(shelf.height),
      depth: String(shelf.depth),
    });
  };

  const handleSaveEditShelf = async (unit: ShelfUnit) => {
    if (!editingShelf) return;

    const width = parseFloat(editForm.width);
    const depth = parseFloat(editForm.depth);
    const height = editForm.height.trim() === "" ? null : parseFloat(editForm.height);

    if (!editForm.name.trim()) return;
    if (!Number.isFinite(width) || width <= 0) {
      setError("Width must be a positive number");
      return;
    }
    if (!Number.isFinite(depth) || depth <= 0) {
      setError("Depth must be a positive number");
      return;
    }
    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      setError("Height must be a positive number or left blank for unconstrained");
      return;
    }

    setError(null);
    try {
      const newShelves = unit.shelves.map((s) =>
        s.id === editingShelf
          ? { id: s.id, name: editForm.name.trim(), width, height, depth }
          : { id: s.id, name: s.name, width: s.width, height: s.height, depth: s.depth },
      );
      const updated = await fetchUpdateShelfUnit(unit.id, { shelves: newShelves });
      setConfig((prev) =>
        prev ? { ...prev, units: prev.units.map((u) => (u.id === unit.id ? updated : u)) } : prev,
      );
      setEditingShelf(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update shelf");
    }
  };

  const handleDuplicateShelf = async (unit: ShelfUnit, shelf: Shelf) => {
    setError(null);
    try {
      const newShelves = [
        ...unit.shelves.map((s) => ({
          id: s.id,
          name: s.name,
          width: s.width,
          height: s.height,
          depth: s.depth,
        })),
        { name: `${shelf.name} (copy)`, width: shelf.width, height: shelf.height, depth: shelf.depth },
      ];
      const updated = await fetchUpdateShelfUnit(unit.id, { shelves: newShelves });
      setConfig((prev) =>
        prev ? { ...prev, units: prev.units.map((u) => (u.id === unit.id ? updated : u)) } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate shelf");
    }
  };

  const handleMoveShelf = async (unit: ShelfUnit, shelfIndex: number, direction: -1 | 1) => {
    const newIndex = shelfIndex + direction;
    if (newIndex < 0 || newIndex >= unit.shelves.length) return;

    setError(null);
    try {
      const reordered = [...unit.shelves];
      [reordered[shelfIndex], reordered[newIndex]] = [reordered[newIndex], reordered[shelfIndex]];
      const newShelves = reordered.map((s) => ({
        id: s.id,
        name: s.name,
        width: s.width,
        height: s.height,
        depth: s.depth,
      }));
      const updated = await fetchUpdateShelfUnit(unit.id, { shelves: newShelves });
      setConfig((prev) =>
        prev ? { ...prev, units: prev.units.map((u) => (u.id === unit.id ? updated : u)) } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder shelves");
    }
  };

  if (loading) return <p className="axes-content loading-text">Loading shelf configuration...</p>;

  if (!config) {
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Shelf Configuration</div>
        </div>
        <div className="main-scroll">
          <div className="axes-content">
            {error && <div className="error-banner">{error}</div>}
            <p className="loading-text">Could not load shelf configuration.</p>
          </div>
        </div>
      </>
    );
  }

  const summary = computeSummary(config.units);

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Shelf Configuration</div>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => setAddingUnit(true)}>
            + Add unit
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {config.units.length > 0 && (
        <div className="shelf-summary-bar">
          <div className="shelf-summary-stat">
            <div className="shelf-summary-value">{summary.totalShelves}</div>
            <div className="shelf-summary-label">total shelves</div>
          </div>
          <div className="shelf-summary-divider" />
          <div className="shelf-summary-stat">
            <div className="shelf-summary-value">{formatCapacity(summary.totalCapacity)}</div>
            <div className="shelf-summary-label">constrained capacity</div>
          </div>
          <div className="shelf-summary-divider" />
          <div className="shelf-summary-stat">
            <div className="shelf-summary-value">{summary.unconstrainedCount}</div>
            <div className="shelf-summary-label">unconstrained shelves</div>
          </div>
        </div>
      )}

      <div className="main-scroll">
        <div className="shelf-content">
          {error && <div className="error-banner">{error}</div>}

          {config.units.map((unit) => {
            const expanded = expandedUnits.has(unit.id);
            return (
              <div key={unit.id} className="shelf-unit-card">
                <div className="shelf-unit-header" onClick={() => toggleUnit(unit.id)}>
                  <span className={`shelf-unit-expand${expanded ? " open" : ""}`}>&#9658;</span>
                  {renamingUnit === unit.id ? (
                    <input
                      className="shelf-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRenameUnit(unit.id);
                        if (e.key === "Escape") setRenamingUnit(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="shelf-unit-name">{unit.name}</span>
                  )}
                  <span className="shelf-unit-count">
                    {unit.shelves.length} {unit.shelves.length === 1 ? "shelf" : "shelves"}
                  </span>
                  <div className="shelf-unit-actions" onClick={(e) => e.stopPropagation()}>
                    {renamingUnit === unit.id ? (
                      <>
                        <button
                          className="btn-ghost"
                          onClick={() => void handleRenameUnit(unit.id)}
                        >
                          Save
                        </button>
                        <button className="btn-ghost" onClick={() => setRenamingUnit(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-ghost"
                        onClick={() => {
                          setRenamingUnit(unit.id);
                          setRenameValue(unit.name);
                        }}
                      >
                        Rename
                      </button>
                    )}
                    <button
                      className="shelf-btn-icon-danger"
                      title="Remove unit"
                      onClick={() => void handleRemoveUnit(unit.id)}
                    >
                      &#10005;
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="shelf-unit-body">
                    {unit.shelves.map((shelf, idx) => (
                      <div key={shelf.id} className="shelf-row">
                        <div className="shelf-reorder-btns">
                          <button
                            className="shelf-reorder-btn"
                            disabled={idx === 0}
                            onClick={() => void handleMoveShelf(unit, idx, -1)}
                            title="Move up"
                          >
                            &#9650;
                          </button>
                          <button
                            className="shelf-reorder-btn"
                            disabled={idx === unit.shelves.length - 1}
                            onClick={() => void handleMoveShelf(unit, idx, 1)}
                            title="Move down"
                          >
                            &#9660;
                          </button>
                        </div>
                        {editingShelf === shelf.id ? (
                          <>
                            <input
                              className="shelf-add-input"
                              value={editForm.name}
                              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                              placeholder="Name"
                            />
                            <input
                              className="shelf-add-input shelf-add-narrow"
                              value={editForm.width}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, width: e.target.value }))
                              }
                              placeholder="W"
                            />
                            <span className="shelf-add-unit-label">&times;</span>
                            <input
                              className="shelf-add-input shelf-add-narrow"
                              value={editForm.height}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, height: e.target.value }))
                              }
                              placeholder="H"
                            />
                            <span className="shelf-add-unit-label">&times;</span>
                            <input
                              className="shelf-add-input shelf-add-narrow"
                              value={editForm.depth}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, depth: e.target.value }))
                              }
                              placeholder="D"
                            />
                            <span className="shelf-add-unit-label">in</span>
                            <div className="shelf-row-actions">
                              <button
                                className="btn-ghost"
                                onClick={() => void handleSaveEditShelf(unit)}
                              >
                                Save
                              </button>
                              <button className="btn-ghost" onClick={() => setEditingShelf(null)}>
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="shelf-name">{shelf.name}</span>
                            <span className="shelf-dims">
                              <span className="shelf-dim-value">{shelf.width}</span>
                              {" \u00D7 "}
                              {shelf.height === null ? (
                                <span className="shelf-dim-unconstrained">&mdash;</span>
                              ) : (
                                <span className="shelf-dim-value">{shelf.height}</span>
                              )}
                              {" \u00D7 "}
                              <span className="shelf-dim-value">{shelf.depth}</span>
                              {" in"}
                            </span>
                            {shelf.height === null && (
                              <span className="shelf-badge-unconstrained">
                                Unconstrained height
                              </span>
                            )}
                            <div className="shelf-row-actions">
                              <button className="btn-ghost" onClick={() => handleEditShelf(shelf)}>
                                Edit
                              </button>
                              <button
                                className="btn-ghost"
                                title="Duplicate shelf"
                                onClick={() => void handleDuplicateShelf(unit, shelf)}
                              >
                                Duplicate
                              </button>
                              <button
                                className="shelf-btn-icon-danger"
                                title="Remove shelf"
                                onClick={() => void handleRemoveShelf(unit, shelf.id)}
                              >
                                &#10005;
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {/* Add shelf form */}
                    <div className="shelf-add-row">
                      <div className="shelf-add-form">
                        <input
                          className="shelf-add-input"
                          placeholder="Shelf name"
                          value={getShelfForm(unit.id).name}
                          onChange={(e) => updateShelfForm(unit.id, { name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleAddShelf(unit);
                          }}
                        />
                        <input
                          className="shelf-add-input shelf-add-narrow"
                          placeholder="W"
                          value={getShelfForm(unit.id).width}
                          onChange={(e) => updateShelfForm(unit.id, { width: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleAddShelf(unit);
                          }}
                        />
                        <span className="shelf-add-unit-label">&times;</span>
                        <input
                          className="shelf-add-input shelf-add-narrow"
                          placeholder="H"
                          value={getShelfForm(unit.id).height}
                          onChange={(e) => updateShelfForm(unit.id, { height: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleAddShelf(unit);
                          }}
                        />
                        <span className="shelf-add-unit-label">&times;</span>
                        <input
                          className="shelf-add-input shelf-add-narrow"
                          placeholder="D"
                          value={getShelfForm(unit.id).depth}
                          onChange={(e) => updateShelfForm(unit.id, { depth: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleAddShelf(unit);
                          }}
                        />
                        <span className="shelf-add-unit-label">in</span>
                        <span className="shelf-add-hint">(leave H blank for unconstrained)</span>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => void handleAddShelf(unit)}
                        >
                          Add shelf
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add unit */}
          {addingUnit ? (
            <div className="shelf-add-unit-form">
              <input
                className="shelf-add-input"
                placeholder="Unit name (e.g. Living Room Kallax)"
                value={newUnitName}
                onChange={(e) => setNewUnitName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddUnit();
                  if (e.key === "Escape") {
                    setAddingUnit(false);
                    setNewUnitName("");
                  }
                }}
                autoFocus
              />
              <button className="btn btn-primary btn-sm" onClick={() => void handleAddUnit()}>
                Add unit
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setAddingUnit(false);
                  setNewUnitName("");
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button className="shelf-btn-add" onClick={() => setAddingUnit(true)}>
              + Add shelf unit
            </button>
          )}
        </div>
      </div>
    </>
  );
}
