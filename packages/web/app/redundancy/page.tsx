"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_JEV_RUN_BUDGET } from "@shelf-judge/shared";
import type { RedundancySettings } from "@shelf-judge/shared";

type Weights = { factual: number; description: number; ownerNote: number };
type Semantic = {
  settings: { enabled: boolean; weights: Weights; cachedOwnerNoteUse: boolean };
  status: string | { status?: unknown; publicationStatus?: unknown };
};
type SettingsResponse = RedundancySettings & { semantic: Semantic; migrationNotice?: string };
type Preview = {
  requestId: string;
  precondition: string;
  provider: string;
  modelId: string;
  eligibleGameCount: number;
  pairCount: number;
  descriptionBearingPairCount: number;
  noteBearingPairCount: number;
  noteTransmissionPermitted: boolean;
  providerConfigured: boolean;
  signalScope: { description: boolean; ownerNotes: boolean };
  scoringEffect: "integrated-fitness" | "annotation-only";
  retentionCaveat: string;
  limits: {
    maxEligiblePairs: number;
    maxProviderAttempts: number;
    reportedTokenStopThreshold: number;
    reportedTokenThresholdIsBilledCeiling: false;
    maxRunDurationMs: number;
  };
  withinPairLimit: boolean;
  expiresAt: string;
};
type Refresh = {
  status: string;
  measurement: string;
  eligibleGameCount: number | null;
  pairCount: number | null;
  coverage: Record<
    string,
    { covered: number; missing: number; invalid: number; unavailable: number; blocked: number }
  > | null;
  progress: null | {
    state: "last-known-running" | "completed" | "interrupted" | "failed";
    pairCount: number;
    completedPairs: number;
    cacheHits: number;
    cacheMisses: number;
    failedPairs: number;
    stopReason?:
      | "application-attempt-limit"
      | "application-token-threshold"
      | "application-deadline"
      | "provider-limit"
      | "provider-rate-limited"
      | "provider-unconfigured";
  };
};
type ActiveRun = { runId: string } | null;
type CheapStatus = {
  activity: { state: "active"; runId: string } | { state: "idle" } | { state: "unavailable" };
  progress:
    | {
        state: "saved";
        relation: "active-run" | "historical" | "unknown";
        value: Refresh["progress"];
      }
    | { state: "none" }
    | { state: "unavailable" };
};

const readCheapStatus = () =>
  request<CheapStatus>("/api/daemon/redundancy/semantic/refresh-progress");
const readFullStatus = () => request<Refresh>("/api/daemon/redundancy/semantic/refresh-status");

const statusCopy: Record<string, string> = {
  ready: "Ready",
  stale: "Stale — no current semantic results are available",
  partial: "Partial — available semantic results already affect relevant pairs",
  disabled: "Semantic comparison is off",
  "not-ready": "Not ready — no usable semantic results are available",
  unavailable: "Unavailable",
};

const stopReasonCopy: Record<string, string> = {
  "application-attempt-limit":
    "Stopped at the application HTTP attempt limit selected for this run. Results may be partial.",
  "application-token-threshold":
    "Stopped at the application's reported-token threshold for this run. This is not a billing limit; results may be partial.",
  "application-deadline":
    "The application stopped the run when its selected maximum duration elapsed. Results may be partial.",
  "provider-limit":
    "Stopped at the previous application attempt limit. This does not mean TypeSafe rate-limited the run.",
  "provider-rate-limited": "The provider rate-limited requests. Results may be partial.",
  "provider-unconfigured": "No provider key was available for remaining comparisons.",
};

function positiveSafeInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

type RunLimits = {
  maxProviderAttempts: number;
  reportedTokenStopThreshold: number;
  maxRunDurationMs: number;
};

function validateRunLimits(
  attemptsText: string,
  tokenThresholdText: string,
  durationMinutesText: string,
): { limits: RunLimits | null; error: string | null } {
  const attempts = positiveSafeInteger(attemptsText);
  const tokenThreshold = positiveSafeInteger(tokenThresholdText);
  const durationMinutes = positiveSafeInteger(durationMinutesText);
  if (attempts === null)
    return { limits: null, error: "Enter a positive whole number of HTTP attempts." };
  if (attempts > 75_000) return { limits: null, error: "HTTP attempts cannot exceed 75,000." };
  if (tokenThreshold === null)
    return { limits: null, error: "Enter a positive, safe whole-number reported-token threshold." };
  if (durationMinutes === null)
    return { limits: null, error: "Enter a whole-number run duration from 1 to 720 minutes." };
  if (durationMinutes > 720)
    return { limits: null, error: "Run duration cannot exceed 12 hours (720 minutes)." };
  return {
    limits: {
      maxProviderAttempts: attempts,
      reportedTokenStopThreshold: tokenThreshold,
      maxRunDurationMs: durationMinutes * 60_000,
    },
    error: null,
  };
}

function semanticStatusValue(status: Semantic["status"]): string {
  if (typeof status === "string") return status;
  const value = status.publicationStatus ?? status.status;
  return typeof value === "string" ? value : "unavailable";
}

function progressCopy(progress: NonNullable<Refresh["progress"]>): string {
  const summary = `${progress.completedPairs} of ${progress.pairCount} pairs completed; ${progress.failedPairs} failed; ${progress.cacheHits} reused from cache.`;
  if (progress.state === "last-known-running")
    return `${progress.completedPairs} of ${progress.pairCount} pairs completed; ${progress.cacheHits} reused from cache.`;
  if (progress.state === "completed")
    return `Run completed. ${progress.completedPairs} of ${progress.pairCount} pairs completed; ${progress.cacheHits} reused from cache.`;
  if (progress.state === "interrupted") return `Run stopped before completion. ${summary}`;
  if (progress.stopReason === "application-attempt-limit")
    return `HTTP request limit reached. ${summary} Start another run with a higher request limit to continue.`;
  if (progress.stopReason === "provider-limit")
    return `Previous application request limit reached. ${summary} Start another run with a higher request limit to continue.`;
  if (progress.stopReason === "application-token-threshold")
    return `Reported-token stop limit reached. ${summary} This is not a billing limit. Start another run with a higher token limit to continue.`;
  if (progress.stopReason === "application-deadline")
    return `Run time limit reached. ${summary} Start another run with a longer duration to continue.`;
  return `Run failed. ${summary}`;
}

function showStopReasonDetails(refresh: Refresh): boolean {
  const reason = refresh.progress?.stopReason;
  return Boolean(
    reason &&
    ![
      "application-attempt-limit",
      "application-token-threshold",
      "application-deadline",
      "provider-limit",
    ].includes(reason),
  );
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export default function RedundancyPage() {
  const [settings, setSettings] = useState<RedundancySettings | null>(null);
  const [saved, setSaved] = useState<RedundancySettings | null>(null);
  const [semantic, setSemantic] = useState<Semantic | null>(null);
  const [savedSemantic, setSavedSemantic] = useState<Semantic["settings"] | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<string>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [refresh, setRefresh] = useState<Refresh | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun>(null);
  const [cheap, setCheap] = useState<CheapStatus | null>(null);
  const statusGeneration = useRef(0);
  const wasActive = useRef(false);
  const activityUnavailable = useRef(false);
  const coverageError = useRef(false);
  const measuring = useRef(false);
  const measurePending = useRef(false);
  const measureCoverage = async () => {
    if (measuring.current) {
      measurePending.current = true;
      return;
    }
    measuring.current = true;
    measurePending.current = false;
    const generation = ++statusGeneration.current;
    setRefresh(null);
    try {
      const full = await readFullStatus();
      if (generation === statusGeneration.current) {
        coverageError.current = false;
        setRefresh(full);
        if (!coverageError.current) setStatusError(undefined);
      }
    } catch (cause) {
      if (generation === statusGeneration.current) {
        coverageError.current = true;
        setStatusError(cause instanceof Error ? cause.message : "Could not measure coverage.");
      }
    } finally {
      measuring.current = false;
      if (measurePending.current) void measureCoverage();
    }
  };
  const invalidateCoverage = () => {
    statusGeneration.current += 1;
    setRefresh(null);
  };
  const applyCheapStatus = async (latest: CheapStatus) => {
    setCheap(latest);
    if (latest.activity.state === "active") {
      activityUnavailable.current = false;
      wasActive.current = true;
      setActiveRun({ runId: latest.activity.runId });
      invalidateCoverage();
      return;
    }
    if (latest.activity.state === "unavailable") {
      activityUnavailable.current = true;
      wasActive.current = false;
      invalidateCoverage();
      return;
    }
    const shouldMeasure = wasActive.current || activityUnavailable.current;
    activityUnavailable.current = false;
    setActiveRun(null);
    if (shouldMeasure) {
      wasActive.current = false;
      await measureCoverage();
    }
  };
  const [noteTransmissionAuthorized, setNoteTransmissionAuthorized] = useState(false);
  const [maxProviderAttempts, setMaxProviderAttempts] = useState(
    String(DEFAULT_JEV_RUN_BUDGET.maxProviderAttempts),
  );
  const [reportedTokenStopThreshold, setReportedTokenStopThreshold] = useState(
    String(DEFAULT_JEV_RUN_BUDGET.reportedTokenStopThreshold),
  );
  const [maxRunDurationMinutes, setMaxRunDurationMinutes] = useState(
    String(DEFAULT_JEV_RUN_BUDGET.maxRunDurationMs / 60_000),
  );
  const previewRevision = useRef(0);
  const [busy, setBusy] = useState(false);
  const [factualSaving, setFactualSaving] = useState(false);
  const [semanticSaving, setSemanticSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [statusError, setStatusError] = useState<string>();
  const [factualError, setFactualError] = useState<string>();
  const [semanticError, setSemanticError] = useState<string>();
  const [runError, setRunError] = useState<string>();
  const runRef = useRef<HTMLDivElement>(null);
  const { limits: selectedRunLimits, error: runLimitsError } = validateRunLimits(
    maxProviderAttempts,
    reportedTokenStopThreshold,
    maxRunDurationMinutes,
  );

  const reload = useCallback(async () => {
    const [data, status] = await Promise.all([
      request<SettingsResponse>("/api/daemon/redundancy/settings"),
      readCheapStatus().catch((cause: unknown) => {
        setStatusError(cause instanceof Error ? cause.message : "Could not load refresh status.");
        return null;
      }),
    ]);
    setSettings(data);
    setSaved(data);
    setSemantic(data.semantic);
    setSavedSemantic(data.semantic.settings);
    setMigrationNotice(data.migrationNotice);
    if (status) {
      if (status.activity.state === "active") await applyCheapStatus(status);
      else if (status.activity.state === "unavailable") await applyCheapStatus(status);
      else {
        setCheap(status);
        setActiveRun(null);
        wasActive.current = false;
        activityUnavailable.current = false;
        void measureCoverage();
      }
    }
  }, []);
  useEffect(() => {
    void reload()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load settings"))
      .finally(() => setLoading(false));
  }, [reload]);
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const latest = await readCheapStatus();
        if (!alive) return;
        await applyCheapStatus(latest);
        if (!alive) return;
        if (!coverageError.current) setStatusError(undefined);
      } catch (e) {
        if (alive) {
          activityUnavailable.current = true;
          wasActive.current = false;
          invalidateCoverage();
          setStatusError(
            e instanceof Error ? e.message : "Refresh status could not be loaded; retrying.",
          );
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const saveFactual = async () => {
    if (!settings) return;
    setBusy(true);
    setFactualSaving(true);
    setFactualError(undefined);
    setMessage(undefined);
    invalidateCoverage();
    try {
      const result = await request<RedundancySettings>("/api/daemon/redundancy/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: settings.enabled,
          stage: settings.stage,
          similarityThreshold: settings.similarityThreshold,
          maxPenalty: settings.maxPenalty,
          minNeighbors: settings.minNeighbors,
          expectedNeighbors: settings.expectedNeighbors,
          componentWeights: settings.componentWeights,
        }),
      });
      setSettings(result);
      setSaved(result);
      setMessage("Factual scoring settings saved.");
    } catch (e) {
      setFactualError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setFactualSaving(false);
      setBusy(false);
    }
  };
  const saveSemantic = async (patch: Partial<Semantic["settings"]>) => {
    if (!semantic) return;
    setBusy(true);
    setSemanticSaving(true);
    setSemanticError(undefined);
    setMessage(undefined);
    invalidateCoverage();
    try {
      const result = await request<{ settings: Semantic["settings"] }>(
        "/api/daemon/redundancy/semantic-settings",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      setSemantic({
        ...semantic,
        settings: result.settings,
        status: !result.settings.enabled
          ? "disabled"
          : semanticStatusValue(semantic.status) === "disabled"
            ? { status: "not-ready", publicationStatus: "not-ready" }
            : semantic.status,
      });
      setSavedSemantic(result.settings);
      setMessage(
        result.settings.enabled
          ? "Similarity preferences saved. No provider request was made."
          : "Similarity scoring is off. Cached semantic results will not be used.",
      );
    } catch (e) {
      setSemanticError(e instanceof Error ? e.message : "Could not save preferences");
    } finally {
      setSemanticSaving(false);
      setBusy(false);
    }
  };
  const loadPreview = async () => {
    const limits = selectedRunLimits;
    if (!limits) return;
    const revision = previewRevision.current;
    setBusy(true);
    setRunError(undefined);
    setMessage(undefined);
    setPreview(null);
    try {
      const params = new URLSearchParams({
        maxProviderAttempts: String(limits.maxProviderAttempts),
        reportedTokenStopThreshold: String(limits.reportedTokenStopThreshold),
        maxRunDurationMs: String(limits.maxRunDurationMs),
      });
      const result = await request<Preview>(
        `/api/daemon/redundancy/semantic/run-preview?${params.toString()}`,
      );
      if (revision !== previewRevision.current) return;
      setPreview(result);
      setNoteTransmissionAuthorized(false);
      runRef.current?.scrollIntoView({ block: "nearest" });
    } catch (e) {
      if (revision !== previewRevision.current) return;
      setRunError(e instanceof Error ? e.message : "Could not prepare run details");
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    if (!preview) return;
    setBusy(true);
    setRunError(undefined);
    setMessage(undefined);
    try {
      const result = await request<{ state: string; runId: string }>(
        "/api/daemon/redundancy/semantic/run",
        json({
          requestId: preview.requestId,
          precondition: preview.precondition,
          noteTransmissionAuthorized:
            preview.signalScope.ownerNotes &&
            preview.noteBearingPairCount > 0 &&
            preview.noteTransmissionPermitted
              ? noteTransmissionAuthorized
              : false,
        }),
      );
      setActiveRun({ runId: result.runId });
      wasActive.current = true;
      activityUnavailable.current = false;
      invalidateCoverage();
      setMessage("Run started. Uncached comparisons may now be sent to the provider.");
      setPreview(null);
      try {
        const status = await readCheapStatus();
        if (status.activity.state === "unavailable") {
          wasActive.current = true;
          setActiveRun({ runId: result.runId });
          invalidateCoverage();
          setCheap(status);
        } else await applyCheapStatus(status);
        if (!coverageError.current) setStatusError(undefined);
      } catch (cause) {
        setStatusError(
          cause instanceof Error
            ? `The run started, but status could not be refreshed: ${cause.message}`
            : "The run started, but status could not be refreshed.",
        );
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Refresh was not started";
      if (reason.toLowerCase().includes("precondition")) {
        setPreview(null);
        setRunError(
          "Collection or saved settings changed after this preview. Nothing was started; load a fresh preview before trying again.",
        );
      } else setRunError(reason);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (runId: string) => {
    setBusy(true);
    setRunError(undefined);
    try {
      await request("/api/daemon/redundancy/semantic/cancel", json({ runId }));
      setMessage("Cancellation requested for this run.");
      try {
        const afterCancel = await readCheapStatus();
        await applyCheapStatus(afterCancel);
        if (!coverageError.current) setStatusError(undefined);
      } catch (cause) {
        setStatusError(
          cause instanceof Error
            ? `Cancellation was requested, but status could not be refreshed: ${cause.message}`
            : "Cancellation was requested, but status could not be refreshed.",
        );
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Could not cancel refresh");
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Redundancy</div>
        </div>
        <div className="main-scroll">
          <div className="axes-content">
            <p className="loading-text" role="status">
              Loading scoring settings…
            </p>
          </div>
        </div>
      </>
    );
  if (!settings || !semantic)
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Redundancy</div>
        </div>
        <div className="main-scroll">
          <div className="axes-content">
            <p className="error-banner" role="alert">
              {error ?? "Could not load redundancy settings."}
            </p>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setLoading(true);
                setError(undefined);
                void reload()
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : "Could not load settings"),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </>
    );
  const dirty = saved !== null && JSON.stringify(settings) !== JSON.stringify(saved);
  const semanticDirty =
    savedSemantic !== null && JSON.stringify(semantic.settings) !== JSON.stringify(savedSemantic);
  const clearPreparedDisclosure = () => {
    previewRevision.current += 1;
    setPreview(null);
    setNoteTransmissionAuthorized(false);
    invalidateCoverage();
  };
  const updateWeight = (key: keyof Weights, value: number) => {
    // A prepared preview reflects saved settings. Weight edits only tune cached-result use.
    clearPreparedDisclosure();
    setSemantic({
      ...semantic,
      settings: { ...semantic.settings, weights: { ...semantic.settings.weights, [key]: value } },
    });
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Redundancy</div>
      </div>
      <div className="main-scroll">
        <main className="axes-content redundancy-settings-body">
          <h1>Redundancy scoring</h1>
          <p className="redundancy-intro">
            Set how similar owned games affect fitness, then choose whether to compare their written
            descriptions or your notes. Saving either set of preferences only updates local
            settings. It never contacts JEV.
          </p>
          <ol className="redundancy-steps" aria-label="How a refresh works">
            <li>
              <strong>Set preferences</strong>
              <span>Saved locally; no provider call.</span>
            </li>
            <li>
              <strong>Preview the run</strong>
              <span>Check provider, scope, limits, and note consent.</span>
            </li>
            <li>
              <strong>Run once</strong>
              <span>This explicit action contacts the provider.</span>
            </li>
          </ol>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="success-banner" role="status">
              {message}
            </div>
          )}
          {migrationNotice && (
            <div className="redundancy-stage-desc" role="status">
              Settings updated: {migrationNotice}
            </div>
          )}

          <section aria-labelledby="factual-heading" className="redundancy-step">
            <h2 id="factual-heading">Factual scoring</h2>
            <p>
              These controls compare game facts such as mechanics, categories, weight, and player
              count.
            </p>
            <label className="redundancy-setting-row">
              <span className="redundancy-setting-label">Enable redundancy scoring</span>
              <input
                type="checkbox"
                disabled={busy}
                checked={settings.enabled}
                onChange={(e) => {
                  clearPreparedDisclosure();
                  setSettings({ ...settings, enabled: e.target.checked });
                }}
              />
            </label>
            <div className="redundancy-setting-row">
              <span className="redundancy-setting-label">Effect on fitness</span>
              <div className="redundancy-stage-buttons">
                <button
                  className={`seg-btn${settings.stage === "annotation" ? " active" : ""}`}
                  aria-pressed={settings.stage === "annotation"}
                  disabled={busy}
                  onClick={() => {
                    clearPreparedDisclosure();
                    setSettings({ ...settings, stage: "annotation" });
                  }}
                >
                  Show separately
                </button>
                <button
                  className={`seg-btn${settings.stage === "integrated" ? " active" : ""}`}
                  aria-pressed={settings.stage === "integrated"}
                  disabled={busy}
                  onClick={() => {
                    clearPreparedDisclosure();
                    setSettings({ ...settings, stage: "integrated" });
                  }}
                >
                  Include in fitness
                </button>
              </div>
            </div>
            <p className="redundancy-stage-desc">
              {settings.stage === "annotation"
                ? "Show the adjustment beside fitness; do not change the fitness score."
                : "Include the adjustment in displayed fitness scores."}
            </p>
            <label className="redundancy-setting-row">
              Similarity threshold: {settings.similarityThreshold.toFixed(2)}
              <input
                aria-label="Similarity threshold"
                disabled={busy}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.similarityThreshold}
                onChange={(e) => {
                  clearPreparedDisclosure();
                  setSettings({ ...settings, similarityThreshold: Number(e.target.value) });
                }}
              />
            </label>
            <label className="redundancy-setting-row">
              Maximum penalty: {settings.maxPenalty.toFixed(1)}
              <input
                aria-label="Maximum penalty"
                disabled={busy}
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={settings.maxPenalty}
                onChange={(e) => {
                  clearPreparedDisclosure();
                  setSettings({ ...settings, maxPenalty: Number(e.target.value) });
                }}
              />
            </label>
            <h3>Redundancy factual weights</h3>
            <p className="loading-text">
              Binary controls whether mechanics and categories match; continuous compares weight and
              player-count values. Both are factual signals.
            </p>
            <label className="redundancy-weight-row">
              Binary — mechanics &amp; categories: {settings.componentWeights.binary.toFixed(2)}
              <input
                aria-label="Binary factual weight"
                disabled={busy}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.componentWeights.binary}
                onChange={(e) => {
                  clearPreparedDisclosure();
                  setSettings({
                    ...settings,
                    componentWeights: {
                      ...settings.componentWeights,
                      binary: Number(e.target.value),
                    },
                  });
                }}
              />
            </label>
            <label className="redundancy-weight-row">
              Continuous — weight &amp; player count:{" "}
              {settings.componentWeights.continuous.toFixed(2)}
              <input
                aria-label="Continuous factual weight"
                disabled={busy}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.componentWeights.continuous}
                onChange={(e) => {
                  clearPreparedDisclosure();
                  setSettings({
                    ...settings,
                    componentWeights: {
                      ...settings.componentWeights,
                      continuous: Number(e.target.value),
                    },
                  });
                }}
              />
            </label>
            <div className="redundancy-save-row">
              {dirty || factualSaving ? (
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void saveFactual()}
                >
                  {factualSaving ? "Saving factual settings…" : "Save factual scoring settings"}
                </button>
              ) : (
                <span className="redundancy-save-status" role="status">
                  Factual settings saved · Stored on this Shelf Judge instance
                </span>
              )}
              {dirty && <span role="status">Unsaved factual changes</span>}
              {factualError && (
                <p className="error-banner" role="alert">
                  Could not save factual settings: {factualError}
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby="semantic-heading" className="redundancy-step">
            <h2 id="semantic-heading">Similarity preferences</h2>
            <p>
              These shared weights affect both prediction and redundancy. A separate run prepares
              any new comparisons; note text is sent only with permission in that run.
            </p>
            <label className="redundancy-setting-row">
              <span className="redundancy-setting-label">
                Use cached description and note comparisons
              </span>
              <input
                type="checkbox"
                disabled={busy}
                checked={semantic.settings.enabled}
                onChange={(e) => {
                  clearPreparedDisclosure();
                  const value = e.target.checked;
                  setSemantic({ ...semantic, settings: { ...semantic.settings, enabled: value } });
                }}
              />
            </label>
            <p className="loading-text">
              Turning this off keeps description and note comparisons out of prediction and
              redundancy. It does not change factual scoring.
            </p>
            {(
              [
                ["factual", "Game facts (mechanics, categories, weight, players)"],
                ["description", "BoardGameGeek descriptions"],
                ["ownerNote", "Your game notes"],
              ] as const
            ).map(([key, label]) => (
              <label className="redundancy-weight-row" key={key}>
                {label}: {semantic.settings.weights[key]}
                <input
                  aria-label={`${label} weight`}
                  disabled={busy}
                  type="range"
                  min="0"
                  max="10"
                  step="1"
                  value={semantic.settings.weights[key]}
                  onChange={(e) => updateWeight(key, Number(e.target.value))}
                />
              </label>
            ))}
            <p className="loading-text">
              Game facts are compared locally. Description and note weights control how cached JEV
              results are used; changing them does not request new comparisons.
            </p>
            <label className="redundancy-setting-row">
              <span>Use cached comparisons based on my notes</span>
              <input
                type="checkbox"
                disabled={busy}
                checked={semantic.settings.cachedOwnerNoteUse}
                onChange={(e) => (
                  clearPreparedDisclosure(),
                  setSemantic({
                    ...semantic,
                    settings: { ...semantic.settings, cachedOwnerNoteUse: e.target.checked },
                  })
                )}
              />
            </label>
            <p className="redundancy-help">
              Saving this never sends notes. It permits note-based cached comparisons and makes
              notes eligible for a separately confirmed run. Turning it off deletes saved note-based
              comparisons.
            </p>
            <div className="redundancy-save-row">
              {semanticDirty || semanticSaving ? (
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void saveSemantic(semantic.settings)}
                >
                  {semanticSaving ? "Saving preferences…" : "Save similarity preferences"}
                </button>
              ) : (
                <span className="redundancy-save-status" role="status">
                  Similarity preferences saved · Stored on this Shelf Judge instance
                </span>
              )}
              {semanticDirty && <span role="status">Unsaved similarity changes</span>}
              {semanticError && (
                <p className="error-banner" role="alert">
                  Could not save similarity preferences: {semanticError}
                </p>
              )}
            </div>
            <div className="redundancy-run" ref={runRef}>
              <h3>Preview, then run once</h3>
              <p>
                Preferences must be saved before preparing this offline preview. Saving or reading
                status never contacts the provider.
              </p>
              <fieldset className="redundancy-run-limits" aria-describedby="run-limits-help">
                <legend>Limits for this run</legend>
                <p id="run-limits-help">
                  Retries count toward the HTTP attempt limit. These limits apply only to this run.
                </p>
                <div className="redundancy-run-limit-grid">
                  <label>
                    Maximum HTTP attempts
                    <input
                      aria-label="Maximum HTTP attempts"
                      aria-invalid={Boolean(runLimitsError)}
                      aria-describedby={runLimitsError ? "run-limits-error" : undefined}
                      type="number"
                      min="1"
                      max="75000"
                      step="1"
                      value={maxProviderAttempts}
                      onChange={(event) => {
                        clearPreparedDisclosure();
                        setMaxProviderAttempts(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Stop after this many reported tokens
                    <input
                      aria-label="Reported-token stop threshold"
                      aria-invalid={Boolean(runLimitsError)}
                      aria-describedby={runLimitsError ? "run-limits-error" : undefined}
                      type="number"
                      min="1"
                      step="1"
                      value={reportedTokenStopThreshold}
                      onChange={(event) => {
                        clearPreparedDisclosure();
                        setReportedTokenStopThreshold(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Maximum run duration (minutes)
                    <input
                      aria-label="Maximum run duration in minutes"
                      aria-invalid={Boolean(runLimitsError)}
                      aria-describedby={runLimitsError ? "run-limits-error" : undefined}
                      type="number"
                      min="1"
                      max="720"
                      step="1"
                      value={maxRunDurationMinutes}
                      onChange={(event) => {
                        clearPreparedDisclosure();
                        setMaxRunDurationMinutes(event.target.value);
                      }}
                    />
                  </label>
                </div>
                {runLimitsError && (
                  <p id="run-limits-error" className="redundancy-inline-guidance" role="alert">
                    {runLimitsError}
                  </p>
                )}
              </fieldset>
              {(semanticDirty || dirty) && (
                <p className="redundancy-inline-guidance" role="status">
                  Save {semanticDirty ? "similarity preferences" : ""}
                  {semanticDirty && dirty ? " and " : ""}
                  {dirty ? "factual scoring settings" : ""} before previewing. The run will use
                  saved settings.
                </p>
              )}
              <button
                className="btn btn-secondary"
                disabled={
                  busy || semanticDirty || dirty || !semantic.settings.enabled || !selectedRunLimits
                }
                onClick={() => void loadPreview()}
              >
                {busy ? "Loading preview…" : "Preview one run"}
              </button>
              {!semantic.settings.enabled && (
                <p className="redundancy-inline-guidance" role="status">
                  Turn on semantic comparisons and save preferences before preparing a run.
                </p>
              )}
              {preview && (
                <div
                  className="redundancy-disclosure"
                  role="region"
                  aria-labelledby="run-preview-heading"
                >
                  <h3 id="run-preview-heading">Before you run</h3>
                  <p>
                    <strong>{preview.provider}</strong> · model <strong>{preview.modelId}</strong>.{" "}
                    {preview.pairCount} game pairs from {preview.eligibleGameCount} eligible games;
                    descriptions are available for {preview.descriptionBearingPairCount} pairs and
                    notes for {preview.noteBearingPairCount} pair
                    {preview.noteBearingPairCount === 1 ? "" : "s"}.
                  </p>
                  <p>
                    Game names
                    {preview.signalScope.description && preview.descriptionBearingPairCount > 0
                      ? " and cached BoardGameGeek descriptions"
                      : ""}{" "}
                    may be sent to {preview.provider}
                    {preview.signalScope.ownerNotes && preview.noteBearingPairCount > 0
                      ? preview.noteTransmissionPermitted
                        ? ". Note text is sent only if you allow it below; without permission, note-based results may remain incomplete"
                        : ". Owner notes are in scope, but this source does not permit transmitting them; note-based results may remain incomplete"
                      : ". No owner-note text will be sent in this run"}
                    . Provider retention is unknown: {preview.retentionCaveat}
                  </p>
                  <p>
                    Up to {preview.limits.maxProviderAttempts.toLocaleString()} HTTP attempts,
                    including retries, or {Math.round(preview.limits.maxRunDurationMs / 60_000)}{" "}
                    minutes. The app stops at{" "}
                    {preview.limits.reportedTokenStopThreshold.toLocaleString()} reported tokens;
                    this threshold is not a billing limit. Any limit can stop the run with partial
                    results.
                  </p>
                  <p>
                    {preview.scoringEffect === "integrated-fitness"
                      ? "Semantic results affect fitness scores."
                      : "Semantic results are annotations only."}{" "}
                    Pairs with usable semantic results can use them immediately. For pairs without
                    one, scoring uses available factual and other configured signals. Preview
                    expires {new Date(preview.expiresAt).toLocaleString()}.
                  </p>
                  {preview.noteBearingPairCount > 0 &&
                    preview.signalScope.ownerNotes &&
                    preview.noteTransmissionPermitted && (
                      <label className="redundancy-setting-row">
                        <span>
                          For this run only, allow owner notes to be sent to {preview.provider}.
                        </span>
                        <input
                          type="checkbox"
                          checked={noteTransmissionAuthorized}
                          onChange={(e) => setNoteTransmissionAuthorized(e.target.checked)}
                        />
                      </label>
                    )}
                  {!preview.providerConfigured && (
                    <p className="redundancy-inline-guidance" role="status">
                      No provider key is configured. The run can still reuse cached results; pairs
                      without a cached result may be unavailable.
                    </p>
                  )}
                  {!preview.withinPairLimit && (
                    <p className="redundancy-inline-guidance" role="status">
                      This preview exceeds the {preview.limits.maxEligiblePairs} eligible-pair
                      limit. Reduce the scope before running.
                    </p>
                  )}
                  {preview.pairCount === 0 && (
                    <p className="redundancy-inline-guidance" role="status">
                      There are no eligible pairs to refresh right now.
                    </p>
                  )}
                  <button
                    className="btn btn-primary"
                    disabled={busy || !preview.withinPairLimit || preview.pairCount === 0}
                    onClick={() => void start()}
                  >
                    Run once
                  </button>
                </div>
              )}
              <div className={`redundancy-refresh-status${activeRun ? " is-running" : ""}`}>
                <h3>Refresh status</h3>
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    void readCheapStatus()
                      .then((latest) => {
                        return applyCheapStatus(latest);
                      })
                      .catch((e: unknown) =>
                        (() => {
                          activityUnavailable.current = true;
                          wasActive.current = false;
                          invalidateCoverage();
                          setStatusError(
                            e instanceof Error ? e.message : "Could not reload progress.",
                          );
                        })(),
                      )
                  }
                >
                  Refresh progress
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={busy || Boolean(activeRun) || cheap?.activity.state !== "idle"}
                  onClick={() => {
                    const generation = ++statusGeneration.current;
                    setStatusError(undefined);
                    void readFullStatus()
                      .then((full) => {
                        if (generation === statusGeneration.current) {
                          coverageError.current = false;
                          setRefresh(full);
                          setStatusError(undefined);
                        }
                      })
                      .catch((e: unknown) =>
                        (() => {
                          if (generation !== statusGeneration.current) return;
                          coverageError.current = true;
                          setStatusError(
                            e instanceof Error ? e.message : "Could not refresh coverage.",
                          );
                        })(),
                      );
                  }}
                >
                  Refresh coverage
                </button>
                {refresh && cheap?.activity.state === "idle" && (
                  <p role="status">
                    {statusCopy[refresh.status] ?? refresh.status}.{" "}
                    {refresh.pairCount === null
                      ? "Eligible pair count unavailable."
                      : `Coverage measured across ${refresh.pairCount} eligible pairs.`}{" "}
                  </p>
                )}
                {activeRun && (
                  <p role="status">
                    {cheap?.progress.state === "saved" &&
                    cheap.progress.relation === "active-run" &&
                    cheap.progress.value
                      ? `Refresh is running. ${progressCopy(cheap.progress.value)}`
                      : "Run progress is not available yet."}
                  </p>
                )}
                {!activeRun &&
                  cheap?.progress.state === "saved" &&
                  cheap.progress.relation === "historical" &&
                  cheap.progress.value && (
                    <p role="status">
                      {cheap.activity.state === "unavailable"
                        ? "Activity status unavailable; saved run:"
                        : "Last saved run:"}{" "}
                      {progressCopy(cheap.progress.value)}
                    </p>
                  )}
                {cheap?.activity.state === "unavailable" && (
                  <p role="status">
                    Live activity status is unavailable. Coverage is not being presented as current.
                  </p>
                )}
                {cheap?.progress.state === "unavailable" && (
                  <p role="status">Run progress is unavailable.</p>
                )}
                {cheap?.progress.state === "saved" && cheap.progress.relation === "unknown" && (
                  <p role="status">Saved progress is available, but its run scope is unknown.</p>
                )}
                {cheap?.progress.state === "none" && cheap.activity.state === "idle" && (
                  <p role="status">No saved run progress.</p>
                )}
                {activeRun && (
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => void cancel(activeRun.runId)}
                  >
                    Cancel live run
                  </button>
                )}
                {refresh?.progress?.stopReason && showStopReasonDetails(refresh) && (
                  <p role="status">{stopReasonCopy[refresh.progress.stopReason]}</p>
                )}
                {statusError && <p role="alert">Status could not be loaded: {statusError}</p>}
                {runError && (
                  <p className="error-banner" role="alert">
                    {runError}
                  </p>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
