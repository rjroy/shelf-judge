"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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

export function RedundancySettingsPanel() {
  const [settings, setSettings] = useState<RedundancySettings | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/daemon/redundancy/settings");
        if (res.ok) {
          setSettings((await res.json()) as RedundancySettings);
        }
      } catch {
        // Settings not available
      }
    })();
  }, []);

  const persist = useCallback((patch: Partial<RedundancySettings>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          setError(null);
          const res = await fetch("/api/daemon/redundancy/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({ error: "Save failed" }))) as {
              error?: string;
            };
            setError(data.error ?? "Save failed");
            return;
          }
          setSettings((await res.json()) as RedundancySettings);
        } catch {
          setError("Could not save settings");
        }
      })();
    }, 300);
  }, []);

  const update = useCallback(
    (patch: Partial<RedundancySettings>) => {
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
      persist(patch);
    },
    [persist],
  );

  const updateWeight = useCallback(
    (key: keyof ComponentWeights, value: number) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const weights = { ...prev.componentWeights, [key]: value };
        persist({ componentWeights: weights });
        return { ...prev, componentWeights: weights };
      });
    },
    [persist],
  );

  const resetDefaults = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    persist(DEFAULT_SETTINGS);
  }, [persist]);

  if (!settings) return null;

  return (
    <div className="redundancy-settings">
      <button className="redundancy-settings-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="redundancy-settings-toggle-label">Redundancy Settings</span>
        <span className="chevron">{open ? "\u25B2" : "\u25BC"}</span>
      </button>

      {open && (
        <div className="redundancy-settings-body">
          {error && <div className="redundancy-settings-error">{error}</div>}

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
                if (!isNaN(val) && val >= 1) update({ expectedNeighbors : val });
              }}
              className="redundancy-number-input"
            />
          </div>

          {/* Reset */}
          <button className="btn btn-ghost btn-sm redundancy-reset-btn" onClick={resetDefaults}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
