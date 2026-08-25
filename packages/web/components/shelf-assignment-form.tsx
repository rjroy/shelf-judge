"use client";

import { useCallback, useReducer } from "react";
import { useRouter } from "next/navigation";

export interface ShelfAssignmentOption {
  shelfId: string;
  label: string;
  dimensionless: boolean;
}

export interface ShelfAssignmentState {
  selectedShelfId: string;
  saving: boolean;
  error: string | null;
}

export type ShelfAssignmentAction =
  | { type: "select"; shelfId: string }
  | { type: "save-started" }
  | { type: "save-finished" }
  | { type: "save-failed"; error: string };

export function shelfAssignmentReducer(
  state: ShelfAssignmentState,
  action: ShelfAssignmentAction,
): ShelfAssignmentState {
  switch (action.type) {
    case "select":
      return { ...state, selectedShelfId: action.shelfId };
    case "save-started":
      return { ...state, saving: true, error: null };
    case "save-finished":
      return { ...state, saving: false };
    case "save-failed":
      return { ...state, saving: false, error: action.error };
  }
}

export async function saveShelfAssignment(
  gameId: string,
  selectedShelfId: string,
  refresh: () => void,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request(`/api/daemon/games/${gameId}/shelf-assignment`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shelfId: selectedShelfId === "" ? null : selectedShelfId }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Failed: ${response.status}`);
  }
  refresh();
}

export async function submitShelfAssignment({
  gameId,
  selectedShelfId,
  refresh,
  request,
  dispatch,
}: {
  gameId: string;
  selectedShelfId: string;
  refresh: () => void;
  request: typeof fetch;
  dispatch: (action: ShelfAssignmentAction) => void;
}): Promise<void> {
  dispatch({ type: "save-started" });
  try {
    await saveShelfAssignment(gameId, selectedShelfId, refresh, request);
    dispatch({ type: "save-finished" });
  } catch (err) {
    dispatch({
      type: "save-failed",
      error: err instanceof Error ? err.message : "Shelf assignment save failed",
    });
  }
}

export function ShelfAssignmentFields({
  selectedShelfId,
  options,
  hasDimensions,
  isPreviouslyOwned,
  saving = false,
  error = null,
  onSelectionChange = () => undefined,
  onSave = () => undefined,
  descriptionId = "shelf-assignment-description",
  errorId = "shelf-assignment-error",
}: {
  selectedShelfId: string;
  options: ShelfAssignmentOption[];
  hasDimensions: boolean;
  isPreviouslyOwned: boolean;
  saving?: boolean;
  error?: string | null;
  onSelectionChange?: (shelfId: string) => void;
  onSave?: () => void;
  descriptionId?: string;
  errorId?: string;
}) {
  const selectedOption = options.find((option) => option.shelfId === selectedShelfId);
  const selectionAllowed = (option: ShelfAssignmentOption | undefined) =>
    !isPreviouslyOwned && (hasDimensions || (option?.dimensionless ?? false));
  const saveDisabled = selectedShelfId !== "" && !selectionAllowed(selectedOption);
  const hasDimensionlessOption = options.some((option) => option.dimensionless);
  const describedBy = error ? `${descriptionId} ${errorId}` : descriptionId;

  return (
    <div className="shelf-assignment-form">
      <div className="panel-section-title">Shelf Assignment</div>
      <label className="shelf-assignment-field">
        <span className="shelf-assignment-label">Placement</span>
        <select
          className="shelf-assignment-select"
          value={selectedShelfId}
          onChange={(event) => onSelectionChange(event.target.value)}
          disabled={saving}
          aria-describedby={describedBy}
        >
          <option value="">Automatic (fill shelves)</option>
          {options.map((option) => (
            <option
              key={option.shelfId}
              value={option.shelfId}
              disabled={!selectionAllowed(option)}
            >
              {option.label}
              {option.dimensionless ? " (dimensionless)" : ""}
            </option>
          ))}
        </select>
      </label>
      {isPreviouslyOwned ? (
        <div className="shelf-assignment-hint" id={descriptionId}>
          Previously owned games cannot be assigned to a physical shelf.
        </div>
      ) : options.length === 0 ? (
        <div className="shelf-assignment-hint" id={descriptionId}>
          Configure shelves before assigning this game.
        </div>
      ) : !hasDimensions ? (
        <div className="shelf-assignment-hint" id={descriptionId}>
          Box dimensions are required for most shelves.
          {hasDimensionlessOption ? " Dimensionless shelves don't need them." : ""}
        </div>
      ) : (
        <div className="shelf-assignment-hint" id={descriptionId}>
          Manual assignments reserve space before automatic placement.
        </div>
      )}
      {error && (
        <div className="shelf-assignment-error" id={errorId} role="alert" aria-live="polite">
          {error}
        </div>
      )}
      <button className="btn-primary" onClick={onSave} disabled={saving || saveDisabled}>
        {saving ? "Saving..." : "Save shelf assignment"}
      </button>
    </div>
  );
}

export function ShelfAssignmentForm({
  gameId,
  currentShelfId,
  options,
  hasDimensions,
  isPreviouslyOwned,
}: {
  gameId: string;
  currentShelfId: string | null;
  options: ShelfAssignmentOption[];
  hasDimensions: boolean;
  isPreviouslyOwned: boolean;
}) {
  const router = useRouter();
  return (
    <ShelfAssignmentFormContent
      gameId={gameId}
      currentShelfId={currentShelfId}
      options={options}
      hasDimensions={hasDimensions}
      isPreviouslyOwned={isPreviouslyOwned}
      refresh={() => router.refresh()}
    />
  );
}

export function ShelfAssignmentFormContent({
  gameId,
  currentShelfId,
  options,
  hasDimensions,
  isPreviouslyOwned,
  refresh,
  request = fetch,
}: {
  gameId: string;
  currentShelfId: string | null;
  options: ShelfAssignmentOption[];
  hasDimensions: boolean;
  isPreviouslyOwned: boolean;
  refresh: () => void;
  request?: typeof fetch;
}) {
  const [state, dispatch] = useReducer(shelfAssignmentReducer, {
    selectedShelfId: currentShelfId ?? "",
    saving: false,
    error: null,
  });
  const { selectedShelfId, saving, error } = state;
  const selectedOption = options.find((option) => option.shelfId === selectedShelfId);
  const selectionAllowed =
    selectedShelfId === "" ||
    (!isPreviouslyOwned && (hasDimensions || (selectedOption?.dimensionless ?? false)));
  const saveDisabled = !selectionAllowed;

  const handleSave = useCallback(async () => {
    if (saveDisabled) return;
    await submitShelfAssignment({ gameId, selectedShelfId, refresh, request, dispatch });
  }, [gameId, refresh, request, saveDisabled, selectedShelfId]);

  return (
    <ShelfAssignmentFields
      selectedShelfId={selectedShelfId}
      options={options}
      hasDimensions={hasDimensions}
      isPreviouslyOwned={isPreviouslyOwned}
      saving={saving}
      error={error}
      onSelectionChange={(shelfId) => dispatch({ type: "select", shelfId })}
      onSave={() => void handleSave()}
      descriptionId={`shelf-assignment-description-${gameId}`}
      errorId={`shelf-assignment-error-${gameId}`}
    />
  );
}
