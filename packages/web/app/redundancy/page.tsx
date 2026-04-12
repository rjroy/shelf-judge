"use client";

import { useState, useEffect, useCallback } from "react";
import type { RedundancySettings, ComponentWeights } from "@shelf-judge/shared";

const DEFAULT_SETTINGS: RedundancySettings = {
  enabled: false,
  stage: "annotation",
  similarityThreshold: 0.6,
  maxPenalty: 2.0,
  componentWeights: { binary: 0.4, continuous: 0.3, personalAxes: 0.3 },
  minNeighbors: 1,
  expectedNeighbors: 5,
};

function settingsEqual(a: RedundancySettings, b: RedundancySettings): boolean {
  return (
    a.enabled === b.enabled &&
    a.stage === b.stage &&
    a.similarityThreshold === b.similarityThreshold &&
    a.maxPenalty === b.maxPenalty &&
    a.componentWeights.binary === b.componentWeights.binary &&
    a.componentWeights.continuous === b.componentWeights.continuous &&
    a.componentWeights.personalAxes === b.componentWeights.personalAxes &&
    a.minNeighbors === b.minNeighbors &&
    a.expectedNeighbors === b.expectedNeighbors
  );
}

export default function RedundancyPage() {
  const [settings, setSettings] = useState<RedundancySettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<RedundancySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/daemon/redundancy/settings");
        if (!res.ok) throw new Error("Failed to load redundancy settings");
        const data = (await res.json()) as RedundancySettings;
        setSettings(data);
        setSavedSettings(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty =
    settings !== null && savedSettings !== null && !settingsEqual(settings, savedSettings);

  const update = useCallback((patch: Partial<RedundancySettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSuccess(null);
  }, []);

  const updateWeight = useCallback((key: keyof ComponentWeights, value: number) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return { ...prev, componentWeights: { ...prev.componentWeights, [key]: value } };
    });
    setSuccess(null);
  }, []);

  const resetDefaults = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    setSuccess(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // 1. Save settings
      const saveRes = await fetch("/api/daemon/redundancy/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!saveRes.ok) {
        const data = (await saveRes.json().catch(() => ({ error: "Save failed" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Save failed");
      }
      const saved = (await saveRes.json()) as RedundancySettings;

      // 2. Regenerate fitness
      const normRes = await fetch("/api/daemon/tournament/normalize-fitness", {
        method: "POST",
      });
      if (!normRes.ok) {
        const data = (await normRes.json().catch(() => ({ error: "Normalize failed" }))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Failed to regenerate fitness scores");
      }
      const normData = (await normRes.json()) as { normalized: number };

      setSettings(saved);
      setSavedSettings(saved);
      setSuccess(
        `Saved. ${normData.normalized} game${normData.normalized === 1 ? "" : "s"} updated.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [settings]);

  if (loading) return <p className="axes-content loading-text">Loading settings...</p>;

  if (!settings) {
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Redundancy</div>
        </div>
        <div className="main-scroll">
          <div className="axes-content">
            {error && <div className="error-banner">{error}</div>}
            <p className="loading-text">Could not load redundancy settings.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Redundancy</div>
        <button
          className="btn btn-primary"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          {saving ? "Saving..." : "Save & Regenerate"}
        </button>
      </div>

      <div className="main-scroll">
        <div className="axes-content">
          {error && <div className="error-banner">{error}</div>}
          {success && <div className="success-banner">{success}</div>}

          <div className="redundancy-settings-body">
            {/* Enable/disable */}
            <div className="redundancy-setting-row">
              <label className="redundancy-setting-label">Enable Redundancy Scoring</label>
              <div
                className={`predictions-toggle-switch${settings.enabled ? " active" : ""}`}
                onClick={() => update({ enabled: !settings.enabled })}
              />
            </div>

            {/* Stage */}
            <div className="redundancy-setting-row">
              <label className="redundancy-setting-label">Mode</label>
              <div className="redundancy-stage-buttons">
                <button
                  className={`seg-btn${settings.stage === "annotation" ? " active" : ""}`}
                  onClick={() => update({ stage: "annotation" })}
                >
                  Annotation
                </button>
                <button
                  className={`seg-btn${settings.stage === "integrated" ? " active" : ""}`}
                  onClick={() => update({ stage: "integrated" })}
                >
                  Integrated
                </button>
              </div>
            </div>
            <div className="redundancy-stage-desc">
              {settings.stage === "annotation"
                ? "Penalties shown as previews. Scores are not modified."
                : "Penalties applied to fitness scores."}
            </div>

            {/* Similarity threshold */}
            <div className="redundancy-setting-row">
              <label className="redundancy-setting-label">
                Similarity Threshold: {settings.similarityThreshold.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.similarityThreshold}
                onChange={(e) => update({ similarityThreshold: parseFloat(e.target.value) })}
                className="redundancy-slider"
              />
            </div>

            {/* Max penalty */}
            <div className="redundancy-setting-row">
              <label className="redundancy-setting-label">
                Max Penalty: {settings.maxPenalty.toFixed(1)}
              </label>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={settings.maxPenalty}
                onChange={(e) => update({ maxPenalty: parseFloat(e.target.value) })}
                className="redundancy-slider"
              />
            </div>

            {/* Component weights */}
            <div className="redundancy-weights-section">
              <div className="redundancy-setting-label">Component Weights</div>
              <div className="redundancy-weight-row">
                <label>
                  Mechanics &amp; Categories: {settings.componentWeights.binary.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.componentWeights.binary}
                  onChange={(e) => updateWeight("binary", parseFloat(e.target.value))}
                  className="redundancy-slider"
                />
              </div>
              <div className="redundancy-weight-row">
                <label>
                  Weight &amp; Player Count: {settings.componentWeights.continuous.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.componentWeights.continuous}
                  onChange={(e) => updateWeight("continuous", parseFloat(e.target.value))}
                  className="redundancy-slider"
                />
              </div>
              <div className="redundancy-weight-row">
                <label>
                  Your Personal Ratings: {settings.componentWeights.personalAxes.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.componentWeights.personalAxes}
                  onChange={(e) => updateWeight("personalAxes", parseFloat(e.target.value))}
                  className="redundancy-slider"
                />
              </div>
            </div>

            {/* Min neighbors */}
            <div className="redundancy-setting-row">
              <label className="redundancy-setting-label">Minimum Neighbors</label>
              <input
                type="number"
                min="1"
                value={settings.minNeighbors}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1) update({ minNeighbors: val });
                }}
                className="redundancy-number-input"
              />
            </div>

            {/* Expected neighbors */}
            <div className="redundancy-setting-row">
              <label className="redundancy-setting-label">Expected Neighbors</label>
              <input
                type="number"
                min="1"
                value={settings.expectedNeighbors}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1) update({ expectedNeighbors: val });
                }}
                className="redundancy-number-input"
              />
            </div>

            {/* Reset */}
            <button className="btn btn-ghost btn-sm redundancy-reset-btn" onClick={resetDefaults}>
              Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
