"use client";

import { useState, useEffect, useRef } from "react";
import { DEFAULT_JEV_RUN_BUDGET } from "@shelf-judge/shared";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { WishlistEntry, JevRunPreview, JevWishlistRunPreview } from "@shelf-judge/shared";
import { WishlistCurrentProjectionCard } from "@/components/wishlist-current-projection";
import {
  activityLabel,
  progressBelongsToActivity,
  readDisplayRunProgress,
  readRunStatusSnapshot,
  runProgressSummary,
  type LiveActivity,
  type RunProgressSnapshot,
} from "@/lib/live-run-status";
import {
  sortCurrentWishlistRows,
  toCurrentWishlistRow,
  unavailableCurrentWishlistRow,
  type CurrentWishlistRow,
} from "@/lib/wishlist-current-projection-view-model";

type SortField = "addedAt" | "predictedScore" | "redundancy" | "name";
const WISHLIST_SORT_STORAGE_KEY = "shelf-judge:wishlist-sort";
const DEFAULT_SORT_FIELD: SortField = "addedAt";

type WishlistRunBudget = {
  maxProviderAttempts: number;
  reportedTokenStopThreshold: number;
  maxRunDurationMs: number;
};

function positiveSafeInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateWishlistRunBudget(
  attemptsText: string,
  tokenThresholdText: string,
  durationMinutesText: string,
): { budget: WishlistRunBudget | null; error: string | null } {
  const attempts = positiveSafeInteger(attemptsText);
  const tokenThreshold = positiveSafeInteger(tokenThresholdText);
  const durationMinutes = positiveSafeInteger(durationMinutesText);
  if (attempts === null)
    return { budget: null, error: "Enter a positive whole number of HTTP attempts." };
  if (attempts > 75_000) return { budget: null, error: "HTTP attempts cannot exceed 75,000." };
  if (tokenThreshold === null)
    return { budget: null, error: "Enter a positive, safe whole-number reported-token threshold." };
  if (durationMinutes === null)
    return { budget: null, error: "Enter a whole-number run duration from 1 to 720 minutes." };
  if (durationMinutes > 720)
    return { budget: null, error: "Run duration cannot exceed 12 hours (720 minutes)." };
  return {
    budget: {
      maxProviderAttempts: attempts,
      reportedTokenStopThreshold: tokenThreshold,
      maxRunDurationMs: durationMinutes * 60_000,
    },
    error: null,
  };
}

export const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "addedAt", label: "Date Added" },
  { value: "predictedScore", label: "Predicted Score" },
  { value: "redundancy", label: "With Redundancy" },
  { value: "name", label: "Name" },
];

export function loadWishlistSortField(storage: Pick<Storage, "getItem"> | null): SortField {
  if (!storage) return DEFAULT_SORT_FIELD;
  try {
    const storedValue = storage.getItem(WISHLIST_SORT_STORAGE_KEY);
    return SORT_OPTIONS.some((option) => option.value === storedValue)
      ? (storedValue as SortField)
      : DEFAULT_SORT_FIELD;
  } catch {
    return DEFAULT_SORT_FIELD;
  }
}

export function saveWishlistSortField(
  storage: Pick<Storage, "setItem"> | null,
  sortField: SortField,
): void {
  if (!storage) return;
  try {
    storage.setItem(WISHLIST_SORT_STORAGE_KEY, sortField);
  } catch {
    // Storage may be disabled or unavailable; sorting still works for this session.
  }
}

function isWishlistPreview(preview: JevRunPreview | null): preview is JevWishlistRunPreview {
  return preview !== null && "scope" in preview && preview.scope.scope === "wishlist";
}

export default function WishlistPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>(DEFAULT_SORT_FIELD);
  const [sortPreferenceLoaded, setSortPreferenceLoaded] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [projections, setProjections] = useState<Map<number, CurrentWishlistRow>>(new Map());
  const [runMode, setRunMode] = useState<"all" | "selected">("all");
  const [maxProviderAttempts, setMaxProviderAttempts] = useState(
    String(DEFAULT_JEV_RUN_BUDGET.maxProviderAttempts),
  );
  const [reportedTokenStopThreshold, setReportedTokenStopThreshold] = useState(
    String(DEFAULT_JEV_RUN_BUDGET.reportedTokenStopThreshold),
  );
  const [maxRunDurationMinutes, setMaxRunDurationMinutes] = useState(
    String(DEFAULT_JEV_RUN_BUDGET.maxRunDurationMs / 60_000),
  );
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const [preview, setPreview] = useState<JevRunPreview | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const previewRevision = useRef(0);
  const [liveActivity, setLiveActivity] = useState<LiveActivity>({ state: "unavailable" });
  const liveActivityRef = useRef<LiveActivity>({ state: "unavailable" });
  const [savedProgress, setSavedProgress] = useState<RunProgressSnapshot>({ state: "unavailable" });
  const runStatusVersion = useRef(0);
  const observedWishlistRunId = useRef<string | null>(null);
  const completedWishlistRuns = useRef(new Set<string>());
  const projectionRevision = useRef(0);
  const { budget: selectedRunBudget, error: runBudgetError } = validateWishlistRunBudget(
    maxProviderAttempts,
    reportedTokenStopThreshold,
    maxRunDurationMinutes,
  );

  function invalidateWishlistProjections(): number {
    const revision = ++projectionRevision.current;
    // Collection changes can alter every current score and rank.
    setProjections(new Map());
    return revision;
  }

  async function reloadWishlistProjections(revision = projectionRevision.current) {
    const response = await fetch("/api/daemon/wishlist/redundancy", { cache: "no-store" });
    if (!response.ok) throw new Error("Current comparison could not be refreshed");
    const results: unknown = await response.json();
    if (revision !== projectionRevision.current) return;
    if (!Array.isArray(results)) {
      setProjections(new Map());
      throw new Error("Current wishlist results are unavailable");
    }
    const next = new Map<number, CurrentWishlistRow>();
    for (const result of results) {
      const row = toCurrentWishlistRow(result);
      if (row) next.set(row.entry.bggId, row);
    }
    if (revision === projectionRevision.current) setProjections(next);
  }

  function refreshWishlistProjectionAfterRun(runId: string) {
    if (completedWishlistRuns.current.has(runId)) return;
    completedWishlistRuns.current.add(runId);
    const revision = invalidateWishlistProjections();
    void reloadWishlistProjections(revision).catch(() => {});
  }

  function applyRunStatus(payload: unknown, version: number) {
    if (version !== runStatusVersion.current) return false;
    const status = readRunStatusSnapshot(payload);
    liveActivityRef.current = status.activity;
    setLiveActivity(status.activity);
    setSavedProgress(status.progress);
    if (status.activity.state === "active") {
      observedWishlistRunId.current =
        status.activity.scope === "wishlist" ? status.activity.runId : null;
    } else if (status.activity.state === "idle") {
      const completedRunId = observedWishlistRunId.current;
      observedWishlistRunId.current = null;
      if (completedRunId) refreshWishlistProjectionAfterRun(completedRunId);
    } else {
      observedWishlistRunId.current = null;
    }
    return true;
  }

  useEffect(() => {
    let restoredSortField = DEFAULT_SORT_FIELD;
    try {
      restoredSortField = loadWishlistSortField(window.localStorage);
    } catch {
      // Accessing localStorage itself can throw in restricted browser contexts.
    }
    setSortField(restoredSortField);
    setSortPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (loading) return;
    const revision = projectionRevision.current;
    void reloadWishlistProjections(revision).catch(() => {
      /* Entries remain visible, but no stored score is used without a valid current projection. */
    });
  }, [loading]);

  useEffect(() => {
    const refreshVisibleProjection = () => {
      if (document.visibilityState !== "visible" || loading) return;
      const revision = invalidateWishlistProjections();
      void reloadWishlistProjections(revision).catch(() => {
        /* Keep entries visible without presenting an older score after settings may have changed. */
      });
    };
    document.addEventListener("visibilitychange", refreshVisibleProjection);
    return () => document.removeEventListener("visibilitychange", refreshVisibleProjection);
  }, [entries, loading]);

  useEffect(() => {
    let alive = true;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      const requestVersion = ++runStatusVersion.current;
      try {
        const response = await fetch("/api/daemon/redundancy/semantic/refresh-progress", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Run status is unavailable");
        if (!alive) return;
        applyRunStatus(await response.json(), requestVersion);
      } catch {
        if (alive && requestVersion === runStatusVersion.current) {
          setLiveActivity({ state: "unavailable" });
          liveActivityRef.current = { state: "unavailable" };
          setSavedProgress({ state: "unavailable" });
          observedWishlistRunId.current = null;
          setRunError("Run status could not be loaded. Try refreshing status.");
        }
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  function invalidatePreview() {
    previewRevision.current += 1;
    setPreview(null);
    setRunError(null);
  }
  async function prepareRun() {
    if (!selectedRunBudget) {
      setRunError(runBudgetError);
      return;
    }
    const revision = ++previewRevision.current;
    setRunBusy(true);
    setRunError(null);
    setRunMessage(null);
    setPreview(null);
    try {
      const params = new URLSearchParams({ scope: "wishlist" });
      params.set("maxProviderAttempts", String(selectedRunBudget.maxProviderAttempts));
      params.set(
        "reportedTokenStopThreshold",
        String(selectedRunBudget.reportedTokenStopThreshold),
      );
      params.set("maxRunDurationMs", String(selectedRunBudget.maxRunDurationMs));
      if (runMode === "selected") {
        for (const id of [...new Set(selectedIds)]) params.append("bggId", String(id));
      }
      const response = await fetch(`/api/daemon/redundancy/semantic/run-preview?${params}`, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          response.status === 412
            ? "Wishlist changed during preparation. Prepare a new preview."
            : "Could not prepare run details.",
        );
      const result = (await response.json()) as JevRunPreview;
      if (revision === previewRevision.current) setPreview(result);
    } catch (cause) {
      if (revision === previewRevision.current)
        setRunError(cause instanceof Error ? cause.message : "Could not prepare run details.");
    } finally {
      setRunBusy(false);
    }
  }
  async function startRun() {
    if (!isWishlistPreview(preview)) return;
    setRunBusy(true);
    setRunError(null);
    setRunMessage(null);
    const actionVersion = ++runStatusVersion.current;
    try {
      const response = await fetch("/api/daemon/redundancy/semantic/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: preview.requestId,
          precondition: preview.precondition,
          noteTransmissionAuthorized: false,
        }),
      });
      if (!response.ok) {
        setPreview(null);
        throw new Error(
          response.status === 412
            ? "Wishlist or comparison sources changed. Nothing was started; prepare a new preview."
            : "Run could not be started. Prepare a new preview before trying again.",
        );
      }
      const result = (await response.json()) as { runId: string };
      if (actionVersion !== runStatusVersion.current) {
        setPreview(null);
        await refreshRunStatus();
        return;
      }
      const localActivity: LiveActivity = {
        state: "active",
        runId: result.runId,
        scope: "wishlist",
      };
      liveActivityRef.current = localActivity;
      setLiveActivity(localActivity);
      observedWishlistRunId.current = result.runId;
      setPreview(null);
      setRunMessage(
        preview.scope.sendablePairCount === 0
          ? "Wishlist run started. No provider request is expected for this run."
          : "Wishlist run started. Only the disclosed description comparisons can be sent.",
      );
      await refreshRunStatus();
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : "Run could not be started.");
    } finally {
      setRunBusy(false);
    }
  }
  async function cancelRun() {
    if (!window.confirm("Request cancellation of this wishlist comparison run?")) return;
    const current = liveActivityRef.current;
    if (current.state !== "active" || current.scope !== "wishlist") return;
    const runId = current.runId;
    ++runStatusVersion.current;
    setRunBusy(true);
    try {
      const response = await fetch("/api/daemon/redundancy/semantic/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      if (!response.ok) throw new Error("Could not request cancellation.");
      setRunMessage("Cancellation requested.");
      await refreshRunStatus();
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : "Could not request cancellation.");
    } finally {
      setRunBusy(false);
    }
  }
  async function refreshRunStatus() {
    const requestVersion = ++runStatusVersion.current;
    try {
      const response = await fetch("/api/daemon/redundancy/semantic/refresh-progress", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      applyRunStatus(await response.json(), requestVersion);
    } catch {
      if (requestVersion === runStatusVersion.current) {
        setLiveActivity({ state: "unavailable" });
        liveActivityRef.current = { state: "unavailable" };
        setSavedProgress({ state: "unavailable" });
        observedWishlistRunId.current = null;
        setRunError("Run status could not be loaded. Try again.");
      }
    }
  }

  useEffect(() => {
    if (!sortPreferenceLoaded) return;
    try {
      saveWishlistSortField(window.localStorage, sortField);
    } catch {
      // Accessing localStorage itself can throw in restricted browser contexts.
    }
  }, [sortField, sortPreferenceLoaded]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/daemon/wishlist");
        if (!res.ok) throw new Error("Failed to load wishlist");
        const data = (await res.json()) as WishlistEntry[];
        setEntries(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load wishlist");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleRemove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      const res = await fetch(`/api/daemon/wishlist/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // Refetch on failure
        const refetch = await fetch("/api/daemon/wishlist");
        if (refetch.ok) setEntries((await refetch.json()) as WishlistEntry[]);
      }
    } catch {
      // Refetch on failure
      try {
        const refetch = await fetch("/api/daemon/wishlist");
        if (refetch.ok) setEntries((await refetch.json()) as WishlistEntry[]);
      } catch {
        // ignore
      }
    }
  }

  async function handleRefresh(id: string) {
    const revision = invalidateWishlistProjections();
    try {
      const res = await fetch(`/api/daemon/wishlist/${id}/refresh`, { method: "POST" });
      if (!res.ok) {
        setError("Failed to refresh entry");
        void reloadWishlistProjections(revision).catch(() => {});
        return;
      }
      const { entry } = (await res.json()) as { entry: WishlistEntry };
      setEntries((prev) => prev.map((e) => (e.id === id ? entry : e)));
      void reloadWishlistProjections(revision).catch(() => {});
    } catch {
      setError("Failed to refresh entry");
      void reloadWishlistProjections(revision).catch(() => {});
    }
  }

  async function handleRefreshAll() {
    setRefreshingAll(true);
    setError(null);
    const revision = invalidateWishlistProjections();
    try {
      const res = await fetch("/api/daemon/wishlist/refresh", { method: "POST" });
      if (!res.ok) {
        setError("Failed to refresh wishlist");
        void reloadWishlistProjections(revision).catch(() => {});
        return;
      }
      const { refreshed, errors } = (await res.json()) as {
        refreshed: number;
        errors: string[];
      };
      // Refetch full list to get updated data
      const listRes = await fetch("/api/daemon/wishlist");
      if (listRes.ok) {
        setEntries((await listRes.json()) as WishlistEntry[]);
      }
      void reloadWishlistProjections(revision).catch(() => {
        /* Entries remain visible with an unavailable current-result message. */
      });
      if (errors.length > 0) {
        setError(
          `Refreshed ${refreshed} of ${refreshed + errors.length} entries. ${errors.length} error(s).`,
        );
      }
    } catch {
      setError("Failed to refresh wishlist");
      void reloadWishlistProjections(revision).catch(() => {});
    } finally {
      setRefreshingAll(false);
    }
  }

  async function handleAddToCollection(bggId: number) {
    setError(null);
    try {
      const res = await fetch("/api/daemon/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bggId }),
      });
      if (res.status === 409) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "This game is already in your collection");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        setError(data.error ?? `Failed: ${res.status}`);
        return;
      }
      const { game } = (await res.json()) as { game: { id: string } };
      // Entry auto-removed by REQ-WISH-10, update local state
      setEntries((prev) => prev.filter((e) => e.bggId !== bggId));
      router.push(`/games/${game.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add game");
    }
  }

  async function handleClearAll() {
    if (!confirm(`Remove all ${entries.length} wishlisted games?`)) return;
    try {
      const res = await fetch("/api/daemon/wishlist", { method: "DELETE" });
      if (res.ok) {
        setEntries([]);
      }
    } catch {
      setError("Failed to clear wishlist");
    }
  }

  const sorted = sortCurrentWishlistRows(
    entries.map(
      (entry) =>
        projections.get(entry.bggId) ??
        unavailableCurrentWishlistRow(
          entry,
          "Current prediction unavailable. Refresh factual details to calculate it.",
        ),
    ),
    "desc",
    sortField === "predictedScore"
      ? "score"
      : sortField === "redundancy"
        ? "redundancy"
        : sortField,
  );
  const activeSortLabel = SORT_OPTIONS.find((o) => o.value === sortField)?.label ?? "Date Added";
  const currentWishlistRun = liveActivity.state === "active" && liveActivity.scope === "wishlist";
  const currentRunProgress =
    liveActivity.state === "active" &&
    progressBelongsToActivity(
      liveActivity,
      savedProgress.state === "saved" ? savedProgress.relation : undefined,
      savedProgress.state === "saved" ? savedProgress.scope : undefined,
    )
      ? runProgressSummary(savedProgress.state === "saved" ? savedProgress.value : null)
      : null;
  const progress =
    liveActivity.state === "idle" &&
    savedProgress.state === "saved" &&
    savedProgress.relation === "historical"
      ? readDisplayRunProgress(savedProgress.value)
      : null;
  const runId = currentWishlistRun && liveActivity.state === "active" ? liveActivity.runId : null;
  const wishlistRunId = runId;

  if (loading) {
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Wishlist</div>
        </div>
        <div className="main-scroll">
          <div className="wishlist-content">
            <div style={{ textAlign: "center", padding: "64px 32px", color: "var(--text-muted)" }}>
              Loading...
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Wishlist</div>
        <span className="topbar-meta">
          {entries.length} game{entries.length !== 1 ? "s" : ""}
        </span>

        {/* Sort widget */}
        <div style={{ position: "relative" }}>
          <button className="sort-widget" onClick={() => setSortMenuOpen(!sortMenuOpen)}>
            <span className="sort-widget-label">Sort</span>
            {activeSortLabel}
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="currentColor"
              style={{ opacity: 0.5 }}
            >
              <path d="M5 7L1 3h8L5 7z" />
            </svg>
          </button>
          {sortMenuOpen && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 9 }}
                onClick={() => setSortMenuOpen(false)}
              />
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 4,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  zIndex: 10,
                  minWidth: 160,
                  overflow: "hidden",
                }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSortField(opt.value);
                      setSortMenuOpen(false);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 14px",
                      fontSize: 13,
                      background: sortField === opt.value ? "var(--action-subtle)" : "transparent",
                      color: sortField === opt.value ? "var(--action)" : "var(--text-secondary)",
                      fontWeight: sortField === opt.value ? 500 : 400,
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Refresh All */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void handleRefreshAll();
          }}
          disabled={refreshingAll || entries.length === 0}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.65 2.35A8 8 0 102 13.65M13.65 2.35V6h-3.6M2 13.65V10h3.6" />
          </svg>
          {refreshingAll ? "Refreshing..." : "Refresh All"}
        </button>
      </div>

      <div className="main-scroll">
        <div className="wishlist-content">
          {error && <div className="error-banner">{error}</div>}

          {entries.length === 0 ? (
            <div className="wishlist-empty">
              <div className="wishlist-empty-title">No wishlisted games</div>
              <p>
                <Link href="/search">Browse games</Link> to add to your wishlist.
              </p>
            </div>
          ) : (
            <>
              <section
                aria-labelledby="wishlist-run-heading"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  borderRadius: 6,
                  padding: "16px 20px",
                  marginBottom: 16,
                }}
              >
                <h2 id="wishlist-run-heading" style={{ fontSize: 16, margin: "0 0 8px" }}>
                  Compare wishlist descriptions
                </h2>
                <p style={{ margin: "0 0 12px", color: "var(--text-secondary)" }}>
                  Compare selected wishlist games with eligible games in your collection. Owner
                  notes are not included.
                </p>
                <fieldset
                  className="redundancy-run-limits"
                  aria-describedby="wishlist-run-limits-help"
                >
                  <legend>Limits for this run</legend>
                  <p id="wishlist-run-limits-help">
                    Retries count toward the HTTP attempt limit. These limits apply only to this
                    run.
                  </p>
                  <div className="redundancy-run-limit-grid">
                    <label>
                      Maximum HTTP attempts
                      <input
                        aria-label="Maximum HTTP attempts"
                        aria-invalid={Boolean(runBudgetError)}
                        aria-describedby={runBudgetError ? "wishlist-run-limits-error" : undefined}
                        type="number"
                        min="1"
                        max="75000"
                        step="1"
                        value={maxProviderAttempts}
                        onChange={(event) => {
                          invalidatePreview();
                          setMaxProviderAttempts(event.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Stop after this many reported tokens
                      <input
                        aria-label="Reported-token stop threshold"
                        aria-invalid={Boolean(runBudgetError)}
                        aria-describedby={runBudgetError ? "wishlist-run-limits-error" : undefined}
                        type="number"
                        min="1"
                        step="1"
                        value={reportedTokenStopThreshold}
                        onChange={(event) => {
                          invalidatePreview();
                          setReportedTokenStopThreshold(event.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Maximum run duration (minutes)
                      <input
                        aria-label="Maximum run duration in minutes"
                        aria-invalid={Boolean(runBudgetError)}
                        aria-describedby={runBudgetError ? "wishlist-run-limits-error" : undefined}
                        type="number"
                        min="1"
                        max="720"
                        step="1"
                        value={maxRunDurationMinutes}
                        onChange={(event) => {
                          invalidatePreview();
                          setMaxRunDurationMinutes(event.target.value);
                        }}
                      />
                    </label>
                  </div>
                  {runBudgetError && (
                    <p
                      id="wishlist-run-limits-error"
                      className="redundancy-inline-guidance"
                      role="alert"
                    >
                      {runBudgetError}
                    </p>
                  )}
                </fieldset>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <label>
                    <input
                      type="radio"
                      name="wishlist-run-mode"
                      checked={runMode === "all"}
                      disabled={runBusy || !!preview}
                      onChange={() => {
                        setRunMode("all");
                        setSelectedIds([]);
                        invalidatePreview();
                      }}
                    />{" "}
                    All wishlist games
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="wishlist-run-mode"
                      checked={runMode === "selected"}
                      disabled={runBusy || !!preview}
                      onChange={() => {
                        setRunMode("selected");
                        invalidatePreview();
                      }}
                    />{" "}
                    Choose games
                  </label>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void prepareRun()}
                    disabled={
                      runBusy ||
                      liveActivity.state !== "idle" ||
                      !selectedRunBudget ||
                      (runMode === "selected" && selectedIds.length === 0)
                    }
                  >
                    {runBusy ? "Preparing…" : "Prepare comparison"}
                  </button>
                  {currentWishlistRun && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void cancelRun()}
                      disabled={runBusy}
                    >
                      Cancel run
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void refreshRunStatus()}
                    disabled={runBusy}
                  >
                    Refresh status
                  </button>
                </div>
                {runMode === "selected" && (
                  <fieldset
                    disabled={runBusy || !!preview}
                    style={{
                      border: 0,
                      padding: "12px 0 0",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px 16px",
                    }}
                  >
                    <legend className="sr-only">Choose wishlist games to compare</legend>
                    {entries.map((entry) => (
                      <label key={entry.id}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(entry.bggId)}
                          onChange={(event) => {
                            setSelectedIds((ids) =>
                              event.target.checked
                                ? [...new Set([...ids, entry.bggId])]
                                : ids.filter((id) => id !== entry.bggId),
                            );
                            invalidatePreview();
                          }}
                        />{" "}
                        {entry.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                {runError && (
                  <p role="alert" style={{ color: "var(--score-low)" }}>
                    {runError}
                  </p>
                )}
                {runMessage && <p role="status">{runMessage}</p>}
                {liveActivity.state === "active" && (
                  <p role="status">
                    {activityLabel(liveActivity, "wishlist")}{" "}
                    {currentWishlistRun ? currentRunProgress : null}
                  </p>
                )}
                {liveActivity.state === "unavailable" && (
                  <p role="status">
                    Live run status is unavailable; cancellation is not available.
                  </p>
                )}
                {savedProgress.state === "saved" && savedProgress.relation === "unknown" && (
                  <p role="status">Saved progress is available, but its run scope is unknown.</p>
                )}
                {savedProgress.state === "unavailable" && liveActivity.state !== "unavailable" && (
                  <p role="status">Run progress is unavailable.</p>
                )}
                {progress && (
                  <p role="status">
                    {runId
                      ? runId === wishlistRunId
                        ? "Wishlist run in progress"
                        : "Redundancy run progress"
                      : `Last run: ${progress.state}`}{" "}
                    · {progress.completedPairs}/{progress.pairCount} pairs · {progress.cacheHits}{" "}
                    cached · {progress.cacheMisses} misses · {progress.failedPairs} errors
                  </p>
                )}
                {isWishlistPreview(preview) && (
                  <div
                    role="group"
                    aria-labelledby="wishlist-run-disclosure"
                    style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}
                  >
                    <h3 id="wishlist-run-disclosure" style={{ fontSize: 14 }}>
                      Review before starting
                    </h3>
                    <p>
                      {preview.scope.selectedCandidateCount} selected of{" "}
                      {preview.scope.wishlistEntryCount} wishlist games ·{" "}
                      {preview.scope.requestedCandidateCount} requested ·{" "}
                      {preview.scope.eligibleCandidateCount} eligible ·{" "}
                      {preview.scope.unavailableCandidateCount} unavailable ·{" "}
                      {preview.scope.ownedOverlapCandidateCount} already owned
                    </p>
                    <p>
                      {preview.scope.sendablePairCount} description comparisons may be sent ·{" "}
                      {preview.scope.cachedHitPairCount} current cached results ·{" "}
                      {preview.scope.eligibleOwnedGameCount} eligible owned games
                    </p>
                    <p>
                      Provider: {preview.provider} · Model: {preview.modelId} · Budget: up to{" "}
                      {preview.limits.maxProviderAttempts.toLocaleString()} attempts ·{" "}
                      {preview.limits.reportedTokenStopThreshold.toLocaleString()} reported tokens
                      (not a billing ceiling) · up to{" "}
                      {Math.ceil(preview.limits.maxRunDurationMs / 60_000)} minutes
                    </p>
                    <p>{preview.retentionCaveat}</p>
                    {preview.scope.sendablePairCount === 0 && (
                      <p>
                        No provider requests are expected; this run can use current cached results.
                      </p>
                    )}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void startRun()}
                      disabled={runBusy || !selectedRunBudget}
                    >
                      Authorize and start
                    </button>{" "}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setPreview(null);
                        setRunError(null);
                      }}
                    >
                      Back
                    </button>
                  </div>
                )}
              </section>
              {sorted.map((row) => (
                <WishlistCurrentProjectionCard
                  key={row.entry.id}
                  row={row}
                  onRemove={(id) => void handleRemove(id)}
                  onRefresh={handleRefresh}
                  onAddToCollection={handleAddToCollection}
                />
              ))}

              <div className="wishlist-clear-row">
                <button
                  className="wishlist-clear-btn"
                  onClick={() => {
                    void handleClearAll();
                  }}
                >
                  Clear entire wishlist
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
