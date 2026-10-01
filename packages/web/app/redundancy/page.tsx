"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RedundancySettings } from "@shelf-judge/shared";

type Weights = { factual: number; description: number; ownerNote: number };
type Pair = {
  gameA: string;
  gameB: string;
  hasDescriptionA: boolean;
  hasDescriptionB: boolean;
  hasOwnerNoteA: boolean;
  hasOwnerNoteB: boolean;
};
type Manifest = {
  id: string;
  digest: string;
  signalScope: "description-only" | "owner-notes-only" | "description-and-owner-notes";
  providerId: string;
  modelId: string;
  budget: { maxRequests: number; maxTokens: number; maxDurationMs: number };
  expiresAt: string;
  pairCount: number;
  notePairCount: number;
  pageSize: number;
};
type Semantic = {
  settings: { enabled: boolean; weights: Weights; cachedOwnerNoteUse: boolean };
  status: string | { status?: unknown; publicationStatus?: unknown };
  migrationNotice?: {
    kind: "jev-cache-v9-to-v10";
    discardedPairCount: number;
  } | null;
};
type SettingsResponse = RedundancySettings & { semantic: Semantic; migrationNotice?: string };
type Refresh = {
  status: string;
  publicationStatus: string;
  manifest?: {
    id: string;
    digest: string;
    signalScope: Manifest["signalScope"];
    expiresAt: string;
  };
  execution?: {
    commandId?: string;
    status: string;
    attemptCount: number;
    completedPairCount: number;
    failedPairCount: number;
  };
  pairCount?: number;
};
type SemanticSummary = {
  disclosure?: { id: string; digest: string; pairCount: number; expiresAt: string } | null;
};

const MANIFEST_REVIEW_PAGE_SIZE = 50;

function activeCommandFromDaemon(refresh: Refresh, summary: SemanticSummary): string | undefined {
  const execution = refresh.execution;
  const disclosure = summary.disclosure;
  const manifest = refresh.manifest;
  if (
    !execution ||
    !["running", "queued"].includes(execution.status) ||
    !disclosure ||
    !manifest ||
    !manifest.id ||
    !manifest.digest ||
    manifest.id !== disclosure.id ||
    manifest.digest !== disclosure.digest ||
    disclosure.pairCount !== refresh.pairCount ||
    disclosure.expiresAt !== manifest.expiresAt ||
    (execution.commandId !== undefined && execution.commandId !== manifest.id) ||
    Date.parse(disclosure.expiresAt) <= Date.now()
  ) {
    return undefined;
  }
  // The daemon starts each execution under its immutable manifest ID; only the
  // current summary disclosure is used, never a tab-local cached command ID.
  return manifest.id;
}

async function readRefreshSnapshot(): Promise<{
  refresh: Refresh;
  commandId?: string;
  identityMessage?: string;
}> {
  const refresh = await request<Refresh>("/api/daemon/redundancy/semantic/refresh-status");
  const summary = await request<SemanticSummary>("/api/daemon/redundancy/semantic/summary").catch(
    () => null,
  );
  const commandId = summary ? activeCommandFromDaemon(refresh, summary) : undefined;
  const active = ["running", "queued"].includes(refresh.execution?.status ?? "");
  const identityMessage = active
    ? summary === null
      ? "Could not read the current disclosure identity. Cancellation is disabled until status can be verified."
      : commandId === undefined
        ? "The active refresh identity does not match the current disclosure. Cancellation is disabled; reload status before retrying."
        : undefined
    : undefined;
  return {
    refresh,
    ...(commandId ? { commandId } : {}),
    ...(identityMessage ? { identityMessage } : {}),
  };
}

const statusCopy: Record<string, string> = {
  ready: "Ready",
  stale: "Stale — factual-only results are shown",
  disabled: "Semantic comparison is off",
  "not-ready": "Not ready — factual-only results are shown",
  unavailable: "Unavailable",
};

function semanticStatusValue(status: Semantic["status"]): string {
  if (typeof status === "string") return status;
  const value = status.publicationStatus ?? status.status;
  return typeof value === "string" ? value : "unavailable";
}

function semanticMigrationCopy(notice: Semantic["migrationNotice"]): string | null {
  if (
    !notice ||
    notice.kind !== "jev-cache-v9-to-v10" ||
    !Number.isSafeInteger(notice.discardedPairCount) ||
    notice.discardedPairCount < 0
  )
    return null;
  const preserved = "Your games, notes, and preferences were preserved.";
  if (notice.discardedPairCount === 0)
    return `Semantic cache storage was upgraded. No cached game-pair results were discarded. ${preserved}`;
  if (notice.discardedPairCount === 1)
    return `Semantic cache storage was upgraded. The cached result for 1 game pair was discarded because its inputs could not be verified. ${preserved}`;
  return `Semantic cache storage was upgraded. Cached results for ${notice.discardedPairCount} game pairs were discarded because their inputs could not be verified. ${preserved}`;
}

function scopeDescription(scope: Manifest["signalScope"]): string {
  if (scope === "description-only") return "C-only · cached BGG descriptions; no owner notes";
  if (scope === "owner-notes-only") return "D-only · owner notes; no descriptions";
  return "C + D · cached descriptions and owner notes";
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
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [manifestPage, setManifestPage] = useState(0);
  const [deliveryComplete, setDeliveryComplete] = useState(false);
  const [refresh, setRefresh] = useState<Refresh | null>(null);
  const [noteTransmission, setNoteTransmission] = useState(false);
  const [cachedNotes, setCachedNotes] = useState(false);
  const [ack, setAck] = useState(false);
  const [signalScope, setSignalScope] = useState<Manifest["signalScope"]>("description-only");
  const [commandId, setCommandId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [factualSaving, setFactualSaving] = useState(false);
  const [semanticSaving, setSemanticSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [statusError, setStatusError] = useState<string>();
  const authorizeRef = useRef<HTMLDivElement>(null);
  const disclosureRevision = useRef(0);

  const reload = useCallback(async () => {
    const [data, status] = await Promise.all([
      request<SettingsResponse>("/api/daemon/redundancy/settings"),
      readRefreshSnapshot().catch(() => null),
    ]);
    setSettings(data);
    setSaved(data);
    setSemantic(data.semantic);
    setSavedSemantic(data.semantic.settings);
    setMigrationNotice(data.migrationNotice);
    if (status) {
      setRefresh(status.refresh);
      setCommandId(status.commandId);
      setStatusError(status.identityMessage);
    }
  }, []);
  useEffect(() => {
    void reload()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load settings"))
      .finally(() => setLoading(false));
  }, [reload]);
  useEffect(() => {
    if (!commandId && !["running", "queued"].includes(refresh?.execution?.status ?? "")) return;
    let alive = true;
    const poll = async () => {
      try {
        const latest = await readRefreshSnapshot();
        if (!alive) return;
        setRefresh(latest.refresh);
        setCommandId(latest.commandId);
        setStatusError(latest.identityMessage);
      } catch (e) {
        if (alive)
          setStatusError(
            e instanceof Error ? e.message : "Refresh status could not be loaded; retrying.",
          );
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [commandId, refresh?.execution?.status]);
  useEffect(() => {
    if (deliveryComplete) authorizeRef.current?.scrollIntoView({ block: "nearest" });
  }, [deliveryComplete]);

  const saveFactual = async () => {
    if (!settings) return;
    setBusy(true);
    setFactualSaving(true);
    setError(undefined);
    setMessage(undefined);
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
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setFactualSaving(false);
      setBusy(false);
    }
  };
  const saveSemantic = async (patch: Partial<Semantic["settings"]>) => {
    if (!semantic) return;
    setBusy(true);
    setSemanticSaving(true);
    setError(undefined);
    setMessage(undefined);
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
      setError(e instanceof Error ? e.message : "Could not save preferences");
    } finally {
      setSemanticSaving(false);
      setBusy(false);
    }
  };
  const disclose = async () => {
    clearPreparedDisclosure();
    const revision = disclosureRevision.current;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    setNoteTransmission(false);
    setCachedNotes(false);
    setManifest(null);
    setPairs([]);
    setDeliveryComplete(false);
    setAck(false);
    try {
      const created = await request<Manifest>(
        "/api/daemon/redundancy/semantic/disclosure",
        json({ signalScope }),
      );
      setManifest(created);
      const collected: Pair[] = [];
      for (let offset = 0; ; ) {
        const page = await request<{ pairs: Pair[]; nextOffset: number; complete: boolean }>(
          "/api/daemon/redundancy/semantic/disclosure/page",
          json({ manifestId: created.id, manifestDigest: created.digest, offset }),
        );
        if (revision !== disclosureRevision.current) return;
        collected.push(...page.pairs);
        setPairs([...collected]);
        if (
          !Number.isSafeInteger(page.nextOffset) ||
          page.nextOffset < offset ||
          page.nextOffset > created.pairCount
        ) {
          throw new Error(
            "The disclosure returned an invalid page position. Nothing was authorized.",
          );
        }
        if (page.complete) {
          if (page.nextOffset !== created.pairCount)
            throw new Error(
              "The complete disclosure did not cover every pair. Nothing was authorized.",
            );
          break;
        }
        if (page.nextOffset <= offset)
          throw new Error(
            "The disclosure did not advance to another page. Nothing was authorized.",
          );
        offset = page.nextOffset;
      }
      setDeliveryComplete(collected.length === created.pairCount);
      if (collected.length !== created.pairCount)
        throw new Error("The full pair list could not be delivered. Nothing was authorized.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare disclosure");
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    if (!manifest || !deliveryComplete || !ack) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await request<{
        disposition?: "CREATED" | "REPLAYED";
        status?: string;
        commandId: string;
      }>(
        "/api/daemon/redundancy/semantic/acknowledge-and-start",
        json({
          manifestId: manifest.id,
          manifestDigest: manifest.digest,
          pairCount: manifest.pairCount,
          transmissionAuthorized: true,
          noteTransmissionAuthorized:
            manifest.signalScope === "description-only" ? false : noteTransmission,
          cachedOwnerNoteUseAuthorized: cachedNotes,
        }),
      );
      setCommandId(result.commandId);
      setMessage(
        result.disposition === "REPLAYED"
          ? "The daemon recognized this request as a replay; showing its existing refresh status."
          : "One refresh was authorized. You can cancel it below.",
      );
      setAck(false);
      setManifest(null);
      setPairs([]);
      setDeliveryComplete(false);
      const status = await readRefreshSnapshot();
      setRefresh(status.refresh);
      setCommandId(status.commandId);
      setStatusError(status.identityMessage);
      void result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh was not started");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const latest = await readRefreshSnapshot();
      setRefresh(latest.refresh);
      setCommandId(latest.commandId);
      setStatusError(latest.identityMessage);
      if (!latest.commandId)
        throw new Error(
          "No current running refresh could be verified. Reload status before cancelling.",
        );
      await request(
        "/api/daemon/redundancy/semantic/cancel",
        json({ commandId: latest.commandId }),
      );
      const afterCancel = await readRefreshSnapshot();
      setRefresh(afterCancel.refresh);
      setCommandId(afterCancel.commandId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel refresh");
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
  const semanticMigrationMessage = semanticMigrationCopy(semantic.migrationNotice);
  const clearPreparedDisclosure = () => {
    disclosureRevision.current += 1;
    setManifest(null);
    setPairs([]);
    setManifestPage(0);
    setDeliveryComplete(false);
    setNoteTransmission(false);
    setCachedNotes(false);
    setAck(false);
  };
  const updateWeight = (key: keyof Weights, value: number) => {
    clearPreparedDisclosure();
    setSemantic({
      ...semantic,
      settings: { ...semantic.settings, weights: { ...semantic.settings.weights, [key]: value } },
    });
  };
  const manifestPageCount = Math.ceil(pairs.length / MANIFEST_REVIEW_PAGE_SIZE);
  const visiblePairs = pairs.slice(
    manifestPage * MANIFEST_REVIEW_PAGE_SIZE,
    (manifestPage + 1) * MANIFEST_REVIEW_PAGE_SIZE,
  );
  const manifestRangeStart = pairs.length ? manifestPage * MANIFEST_REVIEW_PAGE_SIZE + 1 : 0;
  const manifestRangeEnd = Math.min((manifestPage + 1) * MANIFEST_REVIEW_PAGE_SIZE, pairs.length);

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
          <ol className="redundancy-steps" aria-label="Refresh steps">
            <li>
              <strong>Set preferences</strong>
              <span>Saved locally; no provider call.</span>
            </li>
            <li>
              <strong>Review pairs</strong>
              <span>Build and inspect the exact list offline.</span>
            </li>
            <li>
              <strong>Authorize refresh</strong>
              <span>This is the only action that contacts JEV.</span>
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
          {semanticMigrationMessage && (
            <div className="success-banner" role="status">
              {semanticMigrationMessage}
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
                  Annotation
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
                  Integrated
                </button>
              </div>
            </div>
            <p className="redundancy-stage-desc">
              {settings.stage === "annotation"
                ? "Shows a separate redundancy adjustment; the fitness score is unchanged."
                : "Applies the adjustment to displayed fitness scores."}
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
            <h3>Factual similarity weights</h3>
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
            </div>
          </section>

          <section aria-labelledby="semantic-heading" className="redundancy-step">
            <h2 id="semantic-heading">Similarity preferences</h2>
            <p>
              These preferences affect semantic comparisons. They are separate from what you approve
              sending in a single refresh.
            </p>
            <p className="redundancy-stage-desc">
              Status:{" "}
              <strong>
                {statusCopy[semanticStatusValue(semantic.status)] ??
                  semanticStatusValue(semantic.status)}
              </strong>
              . A game can have a status even when it has no qualifying neighbor.
            </p>
            <label className="redundancy-setting-row">
              <span className="redundancy-setting-label">Use semantic comparisons in scoring</span>
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
              Turn this on only after reviewing weights and privacy choices below. Saving
              preferences does not contact a provider.
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
              Game facts are compared locally. BoardGameGeek descriptions come from cached source
              text. Your notes are personal text and are sent only if you separately allow it for a
              refresh below.
            </p>
            <label className="redundancy-setting-row">
              <span>Allow previously cached comparisons informed by my notes</span>
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
              This controls reuse of an existing result; it does not send your note text.
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
            </div>
            <h3>Review and authorize one refresh</h3>
            <p>
              Preparing the pair list is offline: no game data is sent. Only “Authorize one refresh”
              below starts a JEV request. Reusing an old note-informed result is separate from
              sending note text for this refresh.
            </p>
            {(semanticDirty || dirty) && (
              <p className="redundancy-inline-guidance" role="status">
                {semanticDirty && "Save similarity preferences"}
                {semanticDirty && dirty && " and "}
                {dirty && "Save factual scoring settings"} before preparing a pair list. No refresh
                can use unsaved preferences.
              </p>
            )}
            <label className="redundancy-setting-row">
              Evidence sent for this execution
              <select
                value={signalScope}
                disabled={busy}
                onChange={(e) => {
                  clearPreparedDisclosure();
                  setSignalScope(e.target.value as Manifest["signalScope"]);
                }}
              >
                <option value="description-only">BGG descriptions only — no note text</option>
                <option value="owner-notes-only">My notes only — no BGG descriptions</option>
                <option value="description-and-owner-notes">BGG descriptions and my notes</option>
              </select>
            </label>
            <button
              className="btn btn-secondary"
              disabled={busy || !semantic.settings.enabled || semanticDirty || dirty}
              onClick={() => void disclose()}
            >
              {busy ? "Preparing list…" : "Prepare pair list (offline)"}
            </button>
            {manifest && (
              <div className="redundancy-disclosure" aria-labelledby="disclosure-title">
                <h3 id="disclosure-title">Exact refresh disclosure</h3>
                <p>
                  Provider: <strong>{manifest.providerId}</strong> · pinned model:{" "}
                  <strong>{manifest.modelId}</strong>
                </p>
                <p>
                  Scope: {scopeDescription(manifest.signalScope)} · {manifest.pairCount} game pairs
                  · {manifest.notePairCount} pairs include notes on both games · expires{" "}
                  {new Date(manifest.expiresAt).toLocaleString()}.
                </p>
                <p>
                  Budget ceiling: {manifest.budget.maxRequests} requests,{" "}
                  {manifest.budget.maxTokens} reported tokens,{" "}
                  {Math.ceil(manifest.budget.maxDurationMs / 60000)} minutes. These are limits, not
                  a price estimate. Provider data-retention terms apply; do not send notes unless
                  comfortable with that disclosure.
                </p>
                <p>
                  Full manifest delivered: {pairs.length} of {manifest.pairCount} pairs. Review the
                  complete list below. Note flags show presence only; no note text is displayed.
                  Large lists are split into pages; all pairs are available to inspect before you
                  authorize.
                </p>
                <div
                  className="redundancy-manifest-pagination"
                  role="group"
                  aria-label="Manifest page controls"
                >
                  <p role="status" aria-live="polite">
                    Showing pairs {manifestRangeStart}–{manifestRangeEnd} of {pairs.length}
                    {manifestPageCount > 1
                      ? ` · Page ${manifestPage + 1} of ${manifestPageCount}`
                      : ""}
                  </p>
                  <div className="redundancy-page-buttons">
                    <button
                      className="btn btn-secondary"
                      disabled={manifestPage === 0}
                      onClick={() => setManifestPage((page) => Math.max(0, page - 1))}
                    >
                      Previous pair page
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={manifestPage + 1 >= manifestPageCount}
                      onClick={() =>
                        setManifestPage((page) => Math.min(manifestPageCount - 1, page + 1))
                      }
                    >
                      Next pair page
                    </button>
                  </div>
                </div>
                <div
                  className="redundancy-manifest"
                  role="region"
                  aria-label="Complete disclosed game-pair manifest"
                  tabIndex={0}
                >
                  <table>
                    <caption>Disclosed pairs and evidence availability</caption>
                    <thead>
                      <tr>
                        <th scope="col">Game A</th>
                        <th scope="col">Game B</th>
                        <th scope="col">Description flags</th>
                        <th scope="col">Owner-note flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePairs.map((pair, index) => (
                        <tr
                          key={`${pair.gameA}:${pair.gameB}:${manifestPage * MANIFEST_REVIEW_PAGE_SIZE + index}`}
                        >
                          <td>{pair.gameA}</td>
                          <td>{pair.gameB}</td>
                          <td>
                            {pair.hasDescriptionA ? "A present" : "A absent"};{" "}
                            {pair.hasDescriptionB ? "B present" : "B absent"}
                          </td>
                          <td>
                            {pair.hasOwnerNoteA ? "A present" : "A absent"};{" "}
                            {pair.hasOwnerNoteB ? "B present" : "B absent"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {manifestPageCount > 1 && (
                  <div
                    className="redundancy-manifest-pagination redundancy-manifest-pagination-bottom"
                    role="group"
                    aria-label="Manifest page controls after table"
                  >
                    <span>
                      Page {manifestPage + 1} of {manifestPageCount}
                    </span>
                    <div className="redundancy-page-buttons">
                      <button
                        className="btn btn-secondary"
                        disabled={manifestPage === 0}
                        onClick={() => setManifestPage((page) => Math.max(0, page - 1))}
                      >
                        Previous pair page
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={manifestPage + 1 >= manifestPageCount}
                        onClick={() =>
                          setManifestPage((page) => Math.min(manifestPageCount - 1, page + 1))
                        }
                      >
                        Next pair page
                      </button>
                    </div>
                  </div>
                )}
                {deliveryComplete && (
                  <div className="redundancy-authorize" ref={authorizeRef}>
                    {manifest.signalScope !== "description-only" ? (
                      <label className="redundancy-setting-row">
                        <span>
                          For this execution only, permit transmitting owner notes to{" "}
                          {manifest.providerId} ({manifest.modelId})
                        </span>
                        <input
                          type="checkbox"
                          checked={noteTransmission}
                          onChange={(e) => setNoteTransmission(e.target.checked)}
                        />
                      </label>
                    ) : (
                      <p className="loading-text">
                        BGG descriptions only: no owner-note text will be sent to JEV.
                      </p>
                    )}
                    <label className="redundancy-setting-row">
                      <span>
                        For this execution only, permit use of cached note-derived judgments
                      </span>
                      <input
                        type="checkbox"
                        checked={cachedNotes}
                        onChange={(e) => setCachedNotes(e.target.checked)}
                      />
                    </label>
                    <label className="redundancy-setting-row">
                      <span>
                        I reviewed all {manifest.pairCount} pairs and authorize one refresh within
                        the disclosed budget.
                      </span>
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                      />
                    </label>
                    <button
                      className="btn btn-primary"
                      disabled={
                        busy ||
                        !ack ||
                        (manifest.signalScope !== "description-only" && !noteTransmission)
                      }
                      onClick={() => void start()}
                    >
                      Authorize one JEV refresh
                    </button>
                    <p className="loading-text">
                      No refresh runs unless you select this authorization. Settings saves and
                      pair-list preparation never contact JEV.
                    </p>
                  </div>
                )}
              </div>
            )}
            {(commandId || refresh?.execution) && (
              <div className="redundancy-refresh-status" role="status">
                <h3>Refresh progress</h3>
                {refresh?.execution ? (
                  <>
                    <p>
                      Refresh: {refresh.execution.status}. {refresh.execution.completedPairCount} of{" "}
                      {refresh.pairCount ?? "?"} pairs complete; {refresh.execution.failedPairCount}{" "}
                      failed. {refresh.execution.attemptCount} attempts.
                    </p>
                    {["running", "queued"].includes(refresh.execution.status) && (
                      <button
                        className="btn btn-secondary"
                        disabled={busy || !commandId}
                        onClick={() => void cancel()}
                      >
                        Cancel refresh
                      </button>
                    )}
                    {["failed", "cancelled", "canceled", "incomplete"].includes(
                      refresh.execution.status,
                    ) && (
                      <p>
                        Refresh ended without a complete current result. Review status before
                        preparing a new disclosure.
                      </p>
                    )}
                  </>
                ) : (
                  <p>Waiting for daemon progress…</p>
                )}
                {["running", "queued"].includes(refresh?.execution?.status ?? "") && !commandId && (
                  <p>
                    The daemon reports an active refresh. Confirming its current cancellation ID;
                    cancellation stays disabled until that ID matches the active disclosure.
                  </p>
                )}
                {statusError && (
                  <p role="alert">
                    Status unavailable: {statusError}. Progress will retry automatically; this does
                    not start another request.
                  </p>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </>
  );
}
