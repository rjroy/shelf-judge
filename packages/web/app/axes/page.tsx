"use client";

import { useState, useEffect, useRef } from "react";
import type {
  Axis,
  DisabledLegacyAxis,
  DerivedFieldDiscovery,
  DerivedFieldDiscoveryResponse,
  NativeScale,
  PreferenceShape,
} from "@shelf-judge/shared";
import {
  applyPreferenceCurve,
  getAxisNativeScale,
  isPreferenceCurveApplicable,
  summarizeDerivedAxisConfiguration,
} from "@shelf-judge/shared";
import { getAxisWeightPercentage, getEnabledAxisWeightTotal } from "@/lib/axis-weight-utils";
import {
  DEFAULT_CURVE,
  curveStateFromAxis,
  curveStateToBody,
  type CurveState,
} from "@/lib/axis-curve-state";
import {
  configurationDraftFromField,
  configurationFromDraft,
  nativeScaleFromDiscovery,
  readAxisFormError,
  type AxisFormError,
  type ConfigurationDraft,
} from "@/lib/derived-axis-web";

interface GameWithScore {
  game: {
    id: string;
    ratings: Record<string, number>;
  };
  score: unknown;
}

type FormScope = "create" | `update:${string}` | `repair:${string}`;

export default function AxesPage() {
  const [axes, setAxes] = useState<Axis[]>([]);
  const [games, setGames] = useState<GameWithScore[]>([]);
  const [discovery, setDiscovery] = useState<DerivedFieldDiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCurve, setEditCurve] = useState<CurveState>(DEFAULT_CURVE);
  const [editConfiguration, setEditConfiguration] = useState<ConfigurationDraft>({});
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newWeight, setNewWeight] = useState("50");
  const [newCurve, setNewCurve] = useState<CurveState>(DEFAULT_CURVE);
  const [newDerivedField, setNewDerivedField] = useState<DerivedFieldDiscovery | null>(null);
  const [newConfiguration, setNewConfiguration] = useState<ConfigurationDraft>({});
  const [formErrors, setFormErrors] = useState<Partial<Record<FormScope, AxisFormError>>>({});
  const formRequestVersions = useRef(new Map<FormScope, number>());
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [repairField, setRepairField] = useState<DerivedFieldDiscovery | null>(null);
  const [repairConfiguration, setRepairConfiguration] = useState<ConfigurationDraft>({});
  const [repairCurve, setRepairCurve] = useState<CurveState>(DEFAULT_CURVE);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [axesRes, gamesRes, discoveryRes] = await Promise.all([
        fetch("/api/daemon/axes"),
        fetch("/api/daemon/games"),
        fetch("/api/daemon/axes/derived-fields"),
      ]);
      if (!axesRes.ok) throw new Error("Failed to load axes");
      if (!gamesRes.ok) throw new Error("Failed to load games");
      if (!discoveryRes.ok) throw new Error("Failed to load derived axis templates");
      setAxes((await axesRes.json()) as Axis[]);
      setGames((await gamesRes.json()) as GameWithScore[]);
      setDiscovery((await discoveryRes.json()) as DerivedFieldDiscoveryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  function ratingsCountForAxis(axisId: string): number {
    return games.filter((g) => g.game.ratings[axisId] !== undefined).length;
  }

  function clearFormError(scope: FormScope): number {
    const version = (formRequestVersions.current.get(scope) ?? 0) + 1;
    formRequestVersions.current.set(scope, version);
    setFormErrors((current) => {
      if (current[scope] === undefined) return current;
      const next = { ...current };
      delete next[scope];
      return next;
    });
    return version;
  }

  function setFormError(scope: FormScope, version: number, formError: AxisFormError) {
    if (formRequestVersions.current.get(scope) !== version) return;
    setFormErrors((current) => ({ ...current, [scope]: formError }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    if (!confirmVetoEnablement(newCurve, newDerivedField?.unit)) return;

    const scope = "create";
    const version = clearFormError(scope);

    try {
      const res = await fetch("/api/daemon/axes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: newDerivedField ? "derived" : "personal",
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          weight: parseInt(newWeight, 10),
          ...curveStateToBody(newCurve, "create"),
          ...(newDerivedField
            ? {
                derivedField: newDerivedField.id,
                configuration: configurationFromDraft(newDerivedField, newConfiguration),
              }
            : {}),
        }),
      });
      if (formRequestVersions.current.get(scope) !== version) return;
      if (!res.ok) {
        const formError = await readAxisFormError(res);
        setFormError(scope, version, formError);
        return;
      }
      setNewName("");
      setNewDescription("");
      setNewWeight("50");
      setNewCurve(DEFAULT_CURVE);
      setNewDerivedField(null);
      setNewConfiguration({});
      clearFormError(scope);
      void loadData();
    } catch (err) {
      setFormError(scope, version, {
        summary: err instanceof Error ? err.message : "Failed to create axis",
        fields: {},
      });
    }
  }

  async function handleUpdate(id: string) {
    const scope = `update:${id}` as const;
    const existingAxis = axes.find((a) => a.id === id);
    const hadVeto = existingAxis?.veto != null;
    const existingField =
      existingAxis?.source === "derived"
        ? discovery?.fields.find((field) => field.id === existingAxis.derivedField)
        : undefined;
    if (!hadVeto && !confirmVetoEnablement(editCurve, existingField?.unit)) return;

    const version = clearFormError(scope);
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
        Object.assign(body, curveStateToBody(editCurve, "update"));
        if (axis?.source === "derived") {
          const field = discovery?.fields.find((candidate) => candidate.id === axis.derivedField);
          if (!field) throw new Error("Derived field metadata is unavailable");
          body.configuration = configurationFromDraft(field, editConfiguration);
        }
      }

      const res = await fetch(`/api/daemon/axes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (formRequestVersions.current.get(scope) !== version) return;
      if (!res.ok) {
        const formError = await readAxisFormError(res);
        setFormError(scope, version, formError);
        return;
      }
      setEditingId(null);
      clearFormError(scope);
      void loadData();
    } catch (err) {
      setFormError(scope, version, {
        summary: err instanceof Error ? err.message : "Failed to update axis",
        fields: {},
      });
    }
  }

  async function handleRepair(axis: Axis) {
    if (axis.source !== "legacy" || repairField === null) return;
    const scope = `repair:${axis.id}` as const;
    const version = clearFormError(scope);
    try {
      const res = await fetch(`/api/daemon/axes/${axis.id}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          derivedField: repairField.id,
          configuration: configurationFromDraft(repairField, repairConfiguration),
          ...curveStateToBody(repairCurve, "update"),
        }),
      });
      if (formRequestVersions.current.get(scope) !== version) return;
      if (!res.ok) {
        const formError = await readAxisFormError(res);
        setFormError(scope, version, formError);
        return;
      }
      setRepairingId(null);
      clearFormError(scope);
      void loadData();
    } catch (err) {
      setFormError(scope, version, {
        summary: err instanceof Error ? err.message : "Failed to repair axis",
        fields: {},
      });
    }
  }

  function selectTemplate(field: DerivedFieldDiscovery | null) {
    setNewDerivedField(field);
    clearFormError("create");
    if (field === null) {
      setNewName("");
      setNewDescription("");
      setNewWeight("50");
      setNewCurve(DEFAULT_CURVE);
      setNewConfiguration({});
      return;
    }
    const template = field.template;
    setNewName(template.name);
    setNewDescription(template.description);
    setNewWeight(String(template.weight));
    setNewCurve({
      ...DEFAULT_CURVE,
      shape: template.preferenceShape,
      idealValue: template.idealValue === undefined ? "" : String(template.idealValue),
      toleranceWidth: template.toleranceWidth === undefined ? "" : String(template.toleranceWidth),
    });
    setNewConfiguration(configurationDraftFromField(field));
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
  const derivedAxes = axes.filter((a) => a.source === "derived");
  const tournamentAxes = axes.filter((a) => a.source === "tournament");
  const disabledAxes = axes.filter((a) => !a.enabled);
  const totalWeight = getEnabledAxisWeightTotal(axes);

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Rating Axes</div>
        <button
          className="btn btn-primary"
          onClick={() => {
            clearFormError("create");
            setShowCreate(!showCreate);
          }}
        >
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
              {formErrors.create && <div className="error-banner">{formErrors.create.summary}</div>}
              <form
                onSubmit={(e) => {
                  void handleCreate(e);
                }}
              >
                <div className="template-picker" role="group" aria-label="Axis templates">
                  <button
                    type="button"
                    className={`template-option${newDerivedField === null ? " active" : ""}`}
                    aria-pressed={newDerivedField === null}
                    onClick={() => selectTemplate(null)}
                  >
                    <strong>Personal axis</strong>
                    <span>Enter your own 1-10 ratings.</span>
                  </button>
                  {discovery?.fields.map((field) => (
                    <button
                      type="button"
                      key={field.id}
                      className={`template-option${newDerivedField?.id === field.id ? " active" : ""}`}
                      aria-pressed={newDerivedField?.id === field.id}
                      onClick={() => selectTemplate(field)}
                    >
                      <strong>{field.label}</strong>
                      <span>{field.description}</span>
                    </button>
                  ))}
                </div>
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

                {newDerivedField && (
                  <ConfigurationFields
                    idPrefix="create-axis"
                    field={newDerivedField}
                    draft={newConfiguration}
                    errors={formErrors.create?.fields ?? {}}
                    onChange={setNewConfiguration}
                  />
                )}

                <CurveConfig
                  idPrefix="create-axis"
                  curve={newCurve}
                  onChange={setNewCurve}
                  scale={
                    newDerivedField
                      ? nativeScaleFromDiscovery(newDerivedField, newConfiguration)
                      : { min: 1, max: 10 }
                  }
                  unit={newDerivedField?.unit}
                  errors={formErrors.create?.fields}
                />

                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      clearFormError("create");
                      setShowCreate(false);
                    }}
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
                if (editingId !== null) clearFormError(`update:${editingId}`);
                clearFormError(`update:${axis.id}`);
                setEditingId(axis.id);
                setEditName(axis.name);
                setEditWeight(String(axis.weight));
                setEditDescription(axis.description ?? "");
                setEditCurve(curveStateFromAxis(axis));
              }}
              onCancelEdit={() => {
                clearFormError(`update:${axis.id}`);
                setEditingId(null);
              }}
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
              formError={formErrors[`update:${axis.id}`]}
            />
          ))}

          {/* Derived axes */}
          {derivedAxes.length > 0 && (
            <>
              <div className="section-label section-label-mt">
                Derived axes &middot; {derivedAxes.length}
              </div>
              <p className="bgg-axes-desc">
                These axes are automatically populated from game metadata. You can override any
                individual game{"'"}s effective rating.
              </p>

              {derivedAxes.map((axis) => (
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
                    if (editingId !== null) clearFormError(`update:${editingId}`);
                    clearFormError(`update:${axis.id}`);
                    setEditingId(axis.id);
                    setEditName(axis.name);
                    setEditWeight(String(axis.weight));
                    setEditDescription(axis.description ?? "");
                    setEditCurve(curveStateFromAxis(axis));
                    const field = discovery?.fields.find(
                      (candidate) => candidate.id === axis.derivedField,
                    );
                    setEditConfiguration(
                      field ? configurationDraftFromField(field, axis.configuration) : {},
                    );
                  }}
                  onCancelEdit={() => {
                    clearFormError(`update:${axis.id}`);
                    setEditingId(null);
                  }}
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
                  discoveryField={discovery?.fields.find((field) => field.id === axis.derivedField)}
                  editConfiguration={editConfiguration}
                  formError={formErrors[`update:${axis.id}`]}
                  onConfigurationChange={setEditConfiguration}
                />
              ))}
            </>
          )}

          {disabledAxes.length > 0 && (
            <>
              <div className="section-label section-label-mt">
                Disabled legacy axes &middot; {disabledAxes.length}
              </div>
              <p className="bgg-axes-desc">
                These preserved axes are excluded from scoring. Choose a registered field to repair
                one, or delete it permanently.
              </p>
              {disabledAxes.map((axis) =>
                axis.source === "legacy" ? (
                  <LegacyAxisCard
                    key={axis.id}
                    axis={axis}
                    fields={discovery?.fields ?? []}
                    ratingsCount={ratingsCountForAxis(axis.id)}
                    repairing={repairingId === axis.id}
                    repairField={repairField}
                    configuration={repairConfiguration}
                    curve={repairCurve}
                    formError={formErrors[`repair:${axis.id}`]}
                    onStartRepair={() => {
                      if (repairingId !== null) clearFormError(`repair:${repairingId}`);
                      clearFormError(`repair:${axis.id}`);
                      const field = discovery?.fields[0] ?? null;
                      setRepairingId(axis.id);
                      setRepairField(field);
                      setRepairConfiguration(field ? configurationDraftFromField(field) : {});
                      setRepairCurve(curveStateFromAxis(axis));
                    }}
                    onSelectField={(field) => {
                      clearFormError(`repair:${axis.id}`);
                      setRepairField(field);
                      setRepairConfiguration(configurationDraftFromField(field));
                    }}
                    onConfigurationChange={setRepairConfiguration}
                    onCurveChange={setRepairCurve}
                    onCancel={() => {
                      clearFormError(`repair:${axis.id}`);
                      setRepairingId(null);
                    }}
                    onRepair={() => void handleRepair(axis)}
                    onDelete={() => void handleDelete(axis)}
                  />
                ) : null,
              )}
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
                    if (editingId !== null) clearFormError(`update:${editingId}`);
                    clearFormError(`update:${axis.id}`);
                    setEditingId(axis.id);
                    setEditName(axis.name);
                    setEditWeight(String(axis.weight));
                    setEditDescription(axis.description ?? "");
                    setEditCurve(curveStateFromAxis(axis));
                  }}
                  onCancelEdit={() => {
                    clearFormError(`update:${axis.id}`);
                    setEditingId(null);
                  }}
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
                  formError={formErrors[`update:${axis.id}`]}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ConfigurationFields({
  idPrefix,
  field,
  draft,
  errors,
  onChange,
}: {
  idPrefix: string;
  field: DerivedFieldDiscovery;
  draft: ConfigurationDraft;
  errors: Record<string, string>;
  onChange: (draft: ConfigurationDraft) => void;
}) {
  if (field.configuration.length === 0) return null;
  return (
    <div className="derived-configuration">
      <div className="curve-config-title">Derived Configuration</div>
      <div className="form-row">
        {field.configuration.map((property) => {
          const inputId = `${idPrefix}-configuration-${property.name}`;
          const error = errors[`configuration.${property.name}`] ?? errors[property.name];
          const errorId = `${inputId}-error`;
          return (
            <div className="form-group" key={property.name}>
              <label className="form-label" htmlFor={inputId}>
                {property.name
                  .replace(/([A-Z])/g, " $1")
                  .replace(/^./, (letter) => letter.toUpperCase())}
                {` (${field.unit})`}
              </label>
              <input
                id={inputId}
                className="form-input"
                type="number"
                required={property.required}
                min={property.minimum}
                max={property.maximum}
                step={1}
                value={draft[property.name] ?? ""}
                onChange={(event) => onChange({ ...draft, [property.name]: event.target.value })}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
              <span className="form-hint">
                Whole number from {property.minimum} to {property.maximum}.
              </span>
              {error && (
                <span id={errorId} className="field-error">
                  {error}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LegacyAxisCard({
  axis,
  fields,
  ratingsCount,
  repairing,
  repairField,
  configuration,
  curve,
  formError,
  onStartRepair,
  onSelectField,
  onConfigurationChange,
  onCurveChange,
  onCancel,
  onRepair,
  onDelete,
}: {
  axis: DisabledLegacyAxis;
  fields: DerivedFieldDiscovery[];
  ratingsCount: number;
  repairing: boolean;
  repairField: DerivedFieldDiscovery | null;
  configuration: ConfigurationDraft;
  curve: CurveState;
  formError?: AxisFormError;
  onStartRepair: () => void;
  onSelectField: (field: DerivedFieldDiscovery) => void;
  onConfigurationChange: (draft: ConfigurationDraft) => void;
  onCurveChange: (curve: CurveState) => void;
  onCancel: () => void;
  onRepair: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="axis-card legacy-axis-card" data-axis-id={axis.id}>
      <div className="legacy-axis-header">
        <div>
          <div className="axis-name">{axis.name}</div>
          <div className="axis-desc">Reason: {axis.reason}</div>
        </div>
        <span className="bgg-source-tag">Disabled</span>
      </div>
      <dl className="legacy-axis-details">
        <div>
          <dt>Preserved identifier</dt>
          <dd>{axis.legacyField ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Retained overrides</dt>
          <dd>{ratingsCount}</dd>
        </div>
        <div>
          <dt>Preserved payload</dt>
          <dd>
            <code>{JSON.stringify(axis.legacyPayload)}</code>
          </dd>
        </div>
      </dl>
      {ratingsCount > 0 && (
        <div className="legacy-warning">
          Repair keeps these overrides. They will override the selected derived field.
        </div>
      )}
      {repairing ? (
        <div className="legacy-repair-form">
          {formError && <div className="error-banner">{formError.summary}</div>}
          <div className="form-group">
            <label className="form-label">Repair as</label>
            <select
              className="form-input"
              value={repairField?.id ?? ""}
              onChange={(event) => {
                const selected = fields.find((field) => field.id === event.target.value);
                if (selected) onSelectField(selected);
              }}
            >
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>
          {repairField && (
            <>
              <ConfigurationFields
                idPrefix={`repair-${axis.id}`}
                field={repairField}
                draft={configuration}
                errors={formError?.fields ?? {}}
                onChange={onConfigurationChange}
              />
              <CurveConfig
                idPrefix={`repair-${axis.id}`}
                curve={curve}
                onChange={onCurveChange}
                scale={nativeScaleFromDiscovery(repairField, configuration)}
                unit={repairField.unit}
                errors={formError?.fields}
              />
            </>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (confirmVetoEnablement(curve, repairField?.unit)) onRepair();
              }}
            >
              Repair Axis
            </button>
          </div>
        </div>
      ) : (
        <div className="axis-actions legacy-axis-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={onStartRepair}
            disabled={fields.length === 0}
          >
            Repair
          </button>
          <button className="btn btn-danger-outline btn-sm" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
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
  discoveryField?: DerivedFieldDiscovery;
  editConfiguration?: ConfigurationDraft;
  formError?: AxisFormError;
  onConfigurationChange?: (draft: ConfigurationDraft) => void;
}

export function AxisCard({
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
  discoveryField,
  editConfiguration = {},
  formError,
  onConfigurationChange,
}: AxisCardProps) {
  const isEditing = editingId === axis.id;
  const isDerived = axis.source === "derived";
  const isDisabled = !axis.enabled;
  const isTournament = axis.source === "tournament";
  const shapeLabel = formatShape(axis.preferenceShape);
  const hasVeto = axis.veto != null;
  const weightPercentage = getAxisWeightPercentage(axis, totalWeight);
  const nativeUnit = discoveryField?.unit ?? "rating";

  return (
    <div className="axis-card" data-axis-id={axis.id}>
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
                    <span className="curve-detail">
                      ideal: {axis.idealValue} {nativeUnit}
                    </span>
                  )}
                  {hasVeto && (
                    <span className="curve-veto-tag">
                      Veto {axis.veto!.direction} {axis.veto!.threshold} {nativeUnit}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <span className={isDerived ? "bgg-source-tag" : "personal-source-tag"}>
          {isDisabled
            ? "Disabled"
            : isDerived
              ? "Derived"
              : isTournament
                ? "Tournament"
                : "Personal"}
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
                {isDisabled ? "Excluded from total" : `${weightPercentage}% of total`}
              </div>
            </>
          )}
        </div>
        <div className="weight-bar-track">
          <div
            className="weight-bar-fill"
            style={{
              width: `${weightPercentage}%`,
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
              {!isDisabled && (
                <button className="btn btn-secondary btn-sm" onClick={onStartEdit}>
                  Edit
                </button>
              )}
              {!isTournament && (
                <button className="btn btn-danger-outline btn-sm" onClick={onDelete}>
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {isEditing && formError && <div className="error-banner">{formError.summary}</div>}

      {/* Curve config shown in edit mode (not for tournament — identity passthrough) */}
      {isEditing && axis.enabled && !isTournament && (
        <>
          {isDerived && discoveryField && onConfigurationChange && (
            <ConfigurationFields
              idPrefix={`edit-${axis.id}`}
              field={discoveryField}
              draft={editConfiguration}
              errors={formError?.fields ?? {}}
              onChange={onConfigurationChange}
            />
          )}
          <CurveConfig
            idPrefix={`edit-${axis.id}`}
            curve={editCurve}
            onChange={onCurveChange}
            scale={
              isDerived && discoveryField
                ? nativeScaleFromDiscovery(discoveryField, editConfiguration)
                : getAxisNativeScale(axis)
            }
            unit={discoveryField?.unit}
            errors={formError?.fields}
          />
        </>
      )}

      <div className={`axis-stats-strip${isDerived ? " bgg-strip" : ""}`}>
        <div className="axis-stat">
          {isTournament ? (
            <>Derived from head-to-head comparisons</>
          ) : (
            <>
              {isDerived ? "Overridden on" : "Rated on"} <strong>{ratingsCount} games</strong>
            </>
          )}
        </div>
        {isDerived && (
          <>
            <div className="axis-stat">
              Configuration: <strong>{summarizeDerivedAxisConfiguration(axis)}</strong>
            </div>
            {discoveryField && (
              <div className="axis-stat axis-stat-wide">
                {discoveryField.provenance} &middot; {discoveryField.unit} &middot; native scale{" "}
                {getAxisNativeScale(axis).min}-{getAxisNativeScale(axis).max}
              </div>
            )}
          </>
        )}
        {isDisabled && (
          <div className="axis-stat">
            Reason: <strong>{axis.reason}</strong>
          </div>
        )}
        {!isDerived && !isTournament && !isDisabled && (
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
  idPrefix: string;
  curve: CurveState;
  onChange: (curve: CurveState) => void;
  scale: NativeScale;
  unit?: string;
  errors?: Record<string, string>;
}

export function CurveConfig({
  idPrefix,
  curve,
  onChange,
  scale,
  unit,
  errors = {},
}: CurveConfigProps) {
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
              <label className="form-label" htmlFor={`${idPrefix}-ideal-value`}>
                Ideal value ({scale.min}&ndash;{scale.max} {unit ?? "rating"})
              </label>
              <input
                id={`${idPrefix}-ideal-value`}
                className="form-input"
                type="number"
                min={scale.min}
                max={scale.max}
                step="any"
                value={curve.idealValue}
                onChange={(e) => update({ idealValue: e.target.value })}
                aria-invalid={errors.idealValue ? true : undefined}
                aria-describedby={errors.idealValue ? `${idPrefix}-ideal-value-error` : undefined}
              />
              {errors.idealValue && (
                <span id={`${idPrefix}-ideal-value-error`} className="field-error">
                  {errors.idealValue}
                </span>
              )}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor={`${idPrefix}-tolerance-width`}>
                Tolerance width ({unit ?? "native units"}, optional)
              </label>
              <input
                id={`${idPrefix}-tolerance-width`}
                className="form-input"
                type="number"
                min={0}
                step="any"
                value={curve.toleranceWidth}
                onChange={(e) => update({ toleranceWidth: e.target.value })}
                placeholder="Use categorical tolerance"
                aria-invalid={errors.toleranceWidth ? true : undefined}
                aria-describedby={
                  errors.toleranceWidth ? `${idPrefix}-tolerance-width-error` : undefined
                }
              />
              {errors.toleranceWidth && (
                <span id={`${idPrefix}-tolerance-width-error`} className="field-error">
                  {errors.toleranceWidth}
                </span>
              )}
              {curve.toleranceWidth === "" && (
                <>
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
                </>
              )}
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
      <CurvePreview curve={curve} scale={scale} unit={unit} />

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
            <label className="form-label" htmlFor={`${idPrefix}-veto-threshold`}>
              Veto threshold ({unit ?? "native units"})
              <input
                id={`${idPrefix}-veto-threshold`}
                className="form-input veto-threshold-input"
                type="number"
                min={scale.min}
                max={scale.max}
                step="any"
                value={curve.vetoThreshold}
                onChange={(e) => update({ vetoThreshold: e.target.value })}
                placeholder="Threshold"
                aria-invalid={errors["veto.threshold"] || errors.veto ? true : undefined}
                aria-describedby={
                  errors["veto.threshold"] || errors.veto
                    ? `${idPrefix}-veto-threshold-error`
                    : undefined
                }
              />
            </label>
            <span className="form-hint">
              Games scoring {curve.vetoDirection} this value
              {unit ? ` (${unit})` : " in native units"} will get fitness 0.
            </span>
            {(errors["veto.threshold"] ?? errors.veto) && (
              <span id={`${idPrefix}-veto-threshold-error`} className="field-error">
                {errors["veto.threshold"] ?? errors.veto}
              </span>
            )}
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
  unit?: string;
}

function CurvePreview({ curve, scale, unit }: CurvePreviewProps) {
  const canvasRef = useRef<SVGSVGElement>(null);
  const width = 280;
  const height = 140;
  const pad = { top: 12, right: 16, bottom: 24, left: 32 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const steps = 60;
  const points: string[] = [];
  const idealVal = curve.idealValue !== "" ? parseFloat(curve.idealValue) : null;
  const toleranceWidth = curve.toleranceWidth !== "" ? parseFloat(curve.toleranceWidth) : null;
  const curveConfig = {
    idealValue: idealVal,
    ...(toleranceWidth === null ? { tolerance: curve.tolerance } : { toleranceWidth }),
    leanDirection: curve.leanDirection,
  };
  const canRender = isPreferenceCurveApplicable(scale, curve.shape, curveConfig);

  if (canRender) {
    for (let i = 0; i <= steps; i++) {
      const raw = scale.min + ((scale.max - scale.min) * i) / steps;
      const eff = applyPreferenceCurve(raw, scale, curve.shape, curveConfig);
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
        <span>Native value{unit ? ` (${unit})` : ""}</span>
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

export function confirmVetoEnablement(curve: CurveState, unit?: string): boolean {
  if (!curve.vetoEnabled || curve.vetoThreshold === "") return true;
  return confirm(
    `This will set any game scoring ${curve.vetoDirection} ${curve.vetoThreshold} ${unit ?? "rating"} on this axis to fitness 0. Continue?`,
  );
}
