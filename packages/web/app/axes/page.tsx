"use client";

import { useState, useEffect, useRef } from "react";
import type {
  Axis,
  AxisSource,
  PreferenceShape,
  ToleranceLevel,
  LeanDirection,
} from "@shelf-judge/shared";
import { getNativeScale, applyPreferenceCurve } from "@shelf-judge/shared";

interface GameWithScore {
  game: {
    id: string;
    ratings: Record<string, number>;
  };
  score: unknown;
}

// Curve config state for create/edit forms
interface CurveState {
  shape: PreferenceShape;
  idealValue: string;
  tolerance: ToleranceLevel;
  leanDirection: LeanDirection | null;
  vetoEnabled: boolean;
  vetoDirection: "below" | "above";
  vetoThreshold: string;
}

const DEFAULT_CURVE: CurveState = {
  shape: "higher-is-better",
  idealValue: "",
  tolerance: "moderate",
  leanDirection: null,
  vetoEnabled: false,
  vetoDirection: "below",
  vetoThreshold: "",
};

function curveStateFromAxis(axis: Axis): CurveState {
  return {
    shape: axis.preferenceShape ?? "higher-is-better",
    idealValue: axis.idealValue != null ? String(axis.idealValue) : "",
    tolerance: axis.tolerance ?? "moderate",
    leanDirection: axis.leanDirection ?? null,
    vetoEnabled: axis.veto != null,
    vetoDirection: axis.veto?.direction ?? "below",
    vetoThreshold: axis.veto != null ? String(axis.veto.threshold) : "",
  };
}

function curveStateToBody(curve: CurveState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    preferenceShape: curve.shape,
  };
  if (curve.shape === "sweet-spot") {
    body.idealValue = curve.idealValue !== "" ? parseFloat(curve.idealValue) : null;
    body.tolerance = curve.tolerance;
    body.leanDirection = curve.leanDirection;
  } else {
    body.idealValue = null;
    body.tolerance = undefined;
    body.leanDirection = null;
  }
  if (curve.vetoEnabled && curve.vetoThreshold !== "") {
    body.veto = { direction: curve.vetoDirection, threshold: parseFloat(curve.vetoThreshold) };
  } else {
    body.veto = null;
  }
  return body;
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
  const [editCurve, setEditCurve] = useState<CurveState>(DEFAULT_CURVE);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newWeight, setNewWeight] = useState("50");
  const [newCurve, setNewCurve] = useState<CurveState>(DEFAULT_CURVE);
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

    if (newCurve.vetoEnabled && newCurve.vetoThreshold !== "") {
      const dir = newCurve.vetoDirection;
      const threshold = newCurve.vetoThreshold;
      if (
        !confirm(
          `This will set any game scoring ${dir} ${threshold} on this axis to fitness 0. Continue?`,
        )
      )
        return;
    }

    setError(null);

    try {
      const res = await fetch("/api/daemon/axes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          weight: parseInt(newWeight, 10),
          ...curveStateToBody(newCurve),
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
      setNewCurve(DEFAULT_CURVE);
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create axis");
    }
  }

  async function handleUpdate(id: string) {
    const existingAxis = axes.find((a) => a.id === id);
    const hadVeto = existingAxis?.veto != null;
    if (!hadVeto && editCurve.vetoEnabled && editCurve.vetoThreshold !== "") {
      const dir = editCurve.vetoDirection;
      const threshold = editCurve.vetoThreshold;
      if (
        !confirm(
          `This will set any game scoring ${dir} ${threshold} on this axis to fitness 0. Continue?`,
        )
      )
        return;
    }

    setError(null);
    try {
      const body: Record<string, unknown> = {};
      const axis = axes.find((a) => a.id === id);
      // Tournament axis is auto-managed; only weight is user-editable. Sending
      // name/description/curve fields would let the user drift the singleton's
      // fixed defaults (REQ-TAXIS-5) and apply curves to an already-normalized
      // 1-10 ELO score (REQ-CURVE-3a says identity passthrough is the default).
      if (axis?.source === "tournament") {
        if (editWeight) body.weight = parseInt(editWeight, 10);
      } else {
        if (editName.trim() && editName.trim() !== axis?.name) body.name = editName.trim();
        if (editWeight) body.weight = parseInt(editWeight, 10);
        if (editDescription !== axis?.description) body.description = editDescription;
        Object.assign(body, curveStateToBody(editCurve));
      }

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
  const tournamentAxes = axes.filter((a) => a.source === "tournament");
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

                <CurveConfig
                  curve={newCurve}
                  onChange={setNewCurve}
                  source="personal"
                  bggField={null}
                />

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
            <AxisCard
              key={axis.id}
              axis={axis}
              editingId={editingId}
              editName={editName}
              editWeight={editWeight}
              editDescription={editDescription}
              editCurve={editCurve}
              totalWeight={totalWeight}
              ratingsCount={ratingsCountForAxis(axis.id)}
              onStartEdit={() => {
                setEditingId(axis.id);
                setEditName(axis.name);
                setEditWeight(String(axis.weight));
                setEditDescription(axis.description ?? "");
                setEditCurve(curveStateFromAxis(axis));
              }}
              onCancelEdit={() => setEditingId(null)}
              onSave={() => {
                void handleUpdate(axis.id);
              }}
              onDelete={() => {
                void handleDelete(axis);
              }}
              onCurveChange={setEditCurve}
              onNameChange={setEditName}
              onWeightChange={setEditWeight}
              onDescChange={setEditDescription}
            />
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
                <AxisCard
                  key={axis.id}
                  axis={axis}
                  editingId={editingId}
                  editName={editName}
                  editWeight={editWeight}
                  editDescription={editDescription}
                  editCurve={editCurve}
                  totalWeight={totalWeight}
                  ratingsCount={ratingsCountForAxis(axis.id)}
                  onStartEdit={() => {
                    setEditingId(axis.id);
                    setEditName(axis.name);
                    setEditWeight(String(axis.weight));
                    setEditDescription(axis.description ?? "");
                    setEditCurve(curveStateFromAxis(axis));
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={() => {
                    void handleUpdate(axis.id);
                  }}
                  onDelete={() => {
                    void handleDelete(axis);
                  }}
                  onCurveChange={setEditCurve}
                  onNameChange={setEditName}
                  onWeightChange={setEditWeight}
                  onDescChange={setEditDescription}
                />
              ))}
            </>
          )}

          {/* Tournament axis */}
          {tournamentAxes.length > 0 && (
            <>
              <div className="section-label section-label-mt">
                Tournament axis &middot; {tournamentAxes.length}
              </div>
              <p className="bgg-axes-desc">
                Auto-derived from head-to-head tournament comparisons. Each game{"'"}s score is its
                normalized ELO. Only the weight is editable.
              </p>

              {tournamentAxes.map((axis) => (
                <AxisCard
                  key={axis.id}
                  axis={axis}
                  editingId={editingId}
                  editName={editName}
                  editWeight={editWeight}
                  editDescription={editDescription}
                  editCurve={editCurve}
                  totalWeight={totalWeight}
                  ratingsCount={ratingsCountForAxis(axis.id)}
                  onStartEdit={() => {
                    setEditingId(axis.id);
                    setEditName(axis.name);
                    setEditWeight(String(axis.weight));
                    setEditDescription(axis.description ?? "");
                    setEditCurve(curveStateFromAxis(axis));
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={() => {
                    void handleUpdate(axis.id);
                  }}
                  onDelete={() => {
                    void handleDelete(axis);
                  }}
                  onCurveChange={setEditCurve}
                  onNameChange={setEditName}
                  onWeightChange={setEditWeight}
                  onDescChange={setEditDescription}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AxisCard
// ---------------------------------------------------------------------------

interface AxisCardProps {
  axis: Axis;
  editingId: string | null;
  editName: string;
  editWeight: string;
  editDescription: string;
  editCurve: CurveState;
  totalWeight: number;
  ratingsCount: number;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
  onCurveChange: (curve: CurveState) => void;
  onNameChange: (v: string) => void;
  onWeightChange: (v: string) => void;
  onDescChange: (v: string) => void;
}

function AxisCard({
  axis,
  editingId,
  editName,
  editWeight,
  editDescription,
  editCurve,
  totalWeight,
  ratingsCount,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onCurveChange,
  onNameChange,
  onWeightChange,
  onDescChange,
}: AxisCardProps) {
  const isEditing = editingId === axis.id;
  const isBgg = axis.source === "bgg";
  const isTournament = axis.source === "tournament";
  const shapeLabel = formatShape(axis.preferenceShape);
  const hasVeto = axis.veto != null;

  return (
    <div className="axis-card">
      <div className="axis-card-main">
        <div>
          {isEditing && !isTournament ? (
            <div className="edit-fields">
              <input
                className="form-input"
                type="text"
                value={editName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Axis name"
              />
              <input
                className="form-input edit-desc-input"
                type="text"
                value={editDescription}
                onChange={(e) => onDescChange(e.target.value)}
                placeholder="Description (optional)"
              />
            </div>
          ) : (
            <>
              <div className="axis-name">{axis.name}</div>
              {axis.description && <div className="axis-desc">{axis.description}</div>}
              {!isTournament && (
                <div className="axis-curve-summary">
                  <span className="curve-shape-tag">{shapeLabel}</span>
                  {axis.preferenceShape === "sweet-spot" && axis.idealValue != null && (
                    <span className="curve-detail">ideal: {axis.idealValue}</span>
                  )}
                  {hasVeto && (
                    <span className="curve-veto-tag">
                      Veto {axis.veto!.direction} {axis.veto!.threshold}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <span className={isBgg ? "bgg-source-tag" : "personal-source-tag"}>
          {isBgg ? <>&#8599; BGG</> : isTournament ? "Tournament" : "Personal"}
        </span>
        <div className="weight-display">
          {isEditing ? (
            <input
              className="form-input weight-edit-input"
              type="number"
              min={0}
              max={100}
              value={editWeight}
              onChange={(e) => onWeightChange(e.target.value)}
            />
          ) : (
            <>
              <div className="weight-number">{axis.weight}</div>
              <div className="weight-pct">
                {totalWeight > 0 ? Math.round((axis.weight / totalWeight) * 100) : 0}% of total
              </div>
            </>
          )}
        </div>
        <div className="weight-bar-track">
          <div
            className="weight-bar-fill"
            style={{
              width: `${totalWeight > 0 ? (axis.weight / totalWeight) * 100 : 0}%`,
            }}
          />
        </div>
        <div className="axis-actions">
          {isEditing ? (
            <>
              <button className="btn btn-primary btn-sm" onClick={onSave}>
                Save
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onCancelEdit}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" onClick={onStartEdit}>
                Edit
              </button>
              {!isTournament && (
                <button className="btn btn-danger-outline btn-sm" onClick={onDelete}>
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Curve config shown in edit mode (not for tournament — identity passthrough) */}
      {isEditing && !isTournament && (
        <CurveConfig
          curve={editCurve}
          onChange={onCurveChange}
          source={axis.source}
          bggField={axis.bggField}
        />
      )}

      <div className={`axis-stats-strip${isBgg ? " bgg-strip" : ""}`}>
        <div className="axis-stat">
          {isTournament ? (
            <>Derived from head-to-head comparisons</>
          ) : (
            <>
              {isBgg ? "Auto-populated on" : "Rated on"} <strong>{ratingsCount} games</strong>
            </>
          )}
        </div>
        {isBgg && axis.bggField && (
          <div className="axis-stat">
            BGG source: <strong>{axis.bggField}</strong>
          </div>
        )}
        {!isBgg && !isTournament && (
          <div className="axis-stat">
            Created{" "}
            <strong>
              {new Date(axis.createdAt).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </strong>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CurveConfig
// ---------------------------------------------------------------------------

interface CurveConfigProps {
  curve: CurveState;
  onChange: (curve: CurveState) => void;
  source: AxisSource;
  bggField: string | null;
}

function CurveConfig({ curve, onChange, source, bggField }: CurveConfigProps) {
  const scale = getNativeScale(source, bggField);

  function update(partial: Partial<CurveState>) {
    onChange({ ...curve, ...partial });
  }

  return (
    <div className="curve-config">
      <div className="curve-config-title">Preference Curve</div>

      {/* Shape selector */}
      <div className="shape-selector">
        {(
          [
            {
              value: "higher-is-better" as const,
              label: "Higher is better",
              desc: "Higher values on this axis mean a better fit.",
            },
            {
              value: "lower-is-better" as const,
              label: "Lower is better",
              desc: "Lower values mean a better fit.",
            },
            {
              value: "sweet-spot" as const,
              label: "Sweet spot",
              desc: "There's an ideal value, and further from it is worse.",
            },
          ] as const
        ).map((opt) => (
          <label
            key={opt.value}
            className={`shape-option${curve.shape === opt.value ? " active" : ""}`}
          >
            <input
              type="radio"
              name="shape"
              value={opt.value}
              checked={curve.shape === opt.value}
              onChange={() => update({ shape: opt.value })}
            />
            <span className="shape-option-label">{opt.label}</span>
            <span className="shape-option-desc">{opt.desc}</span>
          </label>
        ))}
      </div>

      {/* Sweet spot controls */}
      {curve.shape === "sweet-spot" && (
        <div className="sweet-spot-controls">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                Ideal value ({scale.min}&ndash;{scale.max})
              </label>
              <input
                className="form-input"
                type="number"
                min={scale.min}
                max={scale.max}
                step={source === "bgg" && bggField === "weight" ? 0.25 : 1}
                value={curve.idealValue}
                onChange={(e) => update({ idealValue: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Tolerance</label>
              <div className="seg-control">
                {(["flexible", "moderate", "strict"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`seg-btn${curve.tolerance === t ? " active" : ""}`}
                    onClick={() => update({ tolerance: t })}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <span className="form-hint">
                {curve.tolerance === "flexible"
                  ? "I'm not picky about this."
                  : curve.tolerance === "strict"
                    ? "I know exactly what I want."
                    : "Moderate preference."}
              </span>
            </div>
          </div>
          <div className="form-group form-group-mb">
            <label className="form-label">Lean direction</label>
            <div className="seg-control">
              <button
                type="button"
                className={`seg-btn${curve.leanDirection === null ? " active" : ""}`}
                onClick={() => update({ leanDirection: null })}
              >
                Symmetric
              </button>
              <button
                type="button"
                className={`seg-btn${curve.leanDirection === "lower" ? " active" : ""}`}
                onClick={() => update({ leanDirection: "lower" })}
              >
                Prefer lower
              </button>
              <button
                type="button"
                className={`seg-btn${curve.leanDirection === "higher" ? " active" : ""}`}
                onClick={() => update({ leanDirection: "higher" })}
              >
                Prefer higher
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Curve preview */}
      <CurvePreview curve={curve} scale={scale} />

      {/* Veto threshold */}
      <div className="veto-config">
        <label className="veto-toggle">
          <input
            type="checkbox"
            checked={curve.vetoEnabled}
            onChange={(e) => update({ vetoEnabled: e.target.checked })}
          />
          <span>Enable veto threshold</span>
        </label>
        {curve.vetoEnabled && (
          <div className="veto-controls">
            <div className="seg-control">
              <button
                type="button"
                className={`seg-btn${curve.vetoDirection === "below" ? " active" : ""}`}
                onClick={() => update({ vetoDirection: "below" })}
              >
                Veto below
              </button>
              <button
                type="button"
                className={`seg-btn${curve.vetoDirection === "above" ? " active" : ""}`}
                onClick={() => update({ vetoDirection: "above" })}
              >
                Veto above
              </button>
            </div>
            <input
              className="form-input veto-threshold-input"
              type="number"
              min={scale.min}
              max={scale.max}
              step={source === "bgg" && bggField === "weight" ? 0.25 : 1}
              value={curve.vetoThreshold}
              onChange={(e) => update({ vetoThreshold: e.target.value })}
              placeholder="Threshold"
            />
            <span className="form-hint">
              Games scoring {curve.vetoDirection} this value will get fitness 0.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CurvePreview (SVG)
// ---------------------------------------------------------------------------

interface CurvePreviewProps {
  curve: CurveState;
  scale: { min: number; max: number };
}

function CurvePreview({ curve, scale }: CurvePreviewProps) {
  const canvasRef = useRef<SVGSVGElement>(null);
  const width = 280;
  const height = 140;
  const pad = { top: 12, right: 16, bottom: 24, left: 32 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const steps = 60;
  const points: string[] = [];
  const idealVal = curve.idealValue !== "" ? parseFloat(curve.idealValue) : null;
  const canRender = curve.shape !== "sweet-spot" || idealVal != null;

  if (canRender) {
    for (let i = 0; i <= steps; i++) {
      const raw = scale.min + ((scale.max - scale.min) * i) / steps;
      const eff = applyPreferenceCurve(raw, scale, curve.shape, {
        idealValue: idealVal,
        tolerance: curve.tolerance,
        leanDirection: curve.leanDirection,
      });
      const x = pad.left + (plotW * i) / steps;
      const y = pad.top + plotH - ((eff - 1) / 9) * plotH;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }

  // Veto line position
  const vetoX =
    curve.vetoEnabled && curve.vetoThreshold !== ""
      ? pad.left + ((parseFloat(curve.vetoThreshold) - scale.min) / (scale.max - scale.min)) * plotW
      : null;

  return (
    <div className="curve-preview">
      <svg ref={canvasRef} viewBox={`0 0 ${width} ${height}`} className="curve-svg">
        {/* Grid lines */}
        <line
          x1={pad.left}
          y1={pad.top}
          x2={pad.left}
          y2={pad.top + plotH}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <line
          x1={pad.left}
          y1={pad.top + plotH}
          x2={pad.left + plotW}
          y2={pad.top + plotH}
          stroke="var(--border)"
          strokeWidth="1"
        />

        {/* Y-axis labels */}
        <text x={pad.left - 4} y={pad.top + 4} className="curve-axis-label" textAnchor="end">
          10
        </text>
        <text
          x={pad.left - 4}
          y={pad.top + plotH + 4}
          className="curve-axis-label"
          textAnchor="end"
        >
          1
        </text>

        {/* X-axis labels */}
        <text
          x={pad.left}
          y={pad.top + plotH + 14}
          className="curve-axis-label"
          textAnchor="middle"
        >
          {scale.min}
        </text>
        <text
          x={pad.left + plotW}
          y={pad.top + plotH + 14}
          className="curve-axis-label"
          textAnchor="middle"
        >
          {scale.max}
        </text>

        {/* Veto region */}
        {vetoX !== null && (
          <>
            {curve.vetoDirection === "below" ? (
              <rect
                x={pad.left}
                y={pad.top}
                width={Math.max(0, vetoX - pad.left)}
                height={plotH}
                fill="var(--danger)"
                opacity="0.08"
              />
            ) : (
              <rect
                x={vetoX}
                y={pad.top}
                width={Math.max(0, pad.left + plotW - vetoX)}
                height={plotH}
                fill="var(--danger)"
                opacity="0.08"
              />
            )}
            <line
              x1={vetoX}
              y1={pad.top}
              x2={vetoX}
              y2={pad.top + plotH}
              stroke="var(--danger)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
          </>
        )}

        {/* Curve line */}
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--action)"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Ideal marker for sweet spot */}
        {curve.shape === "sweet-spot" && idealVal !== null && (
          <circle
            cx={pad.left + ((idealVal - scale.min) / (scale.max - scale.min)) * plotW}
            cy={pad.top}
            r="3"
            fill="var(--score-high)"
          />
        )}
      </svg>
      <div className="curve-preview-labels">
        <span>Native value</span>
        <span>Effective (1-10)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShape(shape?: PreferenceShape): string {
  switch (shape) {
    case "lower-is-better":
      return "Lower is better";
    case "sweet-spot":
      return "Sweet spot";
    default:
      return "Higher is better";
  }
}
