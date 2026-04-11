import type { Metadata } from "next";
import Link from "next/link";
import { getReadiness, listAxes } from "@/lib/api";

export const metadata: Metadata = { title: "Prediction Readiness" };
export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<number, string> = {
  0: "Not Ready",
  1: "Basic",
  2: "Moderate",
  3: "Strong",
};

const STAGE_DESCRIPTIONS: Record<number, string> = {
  0: "Rate more games to unlock predictions. The engine needs a baseline of rated games to find meaningful patterns.",
  1: "Basic predictions available. Confidence is limited by the small reference pool. Rate more games to improve accuracy.",
  2: "Moderate predictions with reasonable confidence. Most axes have enough reference data for useful estimates.",
  3: "Strong prediction confidence. The engine has a rich reference pool across your rated axes.",
};

const STAGE_THRESHOLDS: Record<number, string> = {
  0: "0 games",
  1: "5 games",
  2: "15 games",
  3: "30 games",
};

export default async function ReadinessPage() {
  let readiness;
  let axes;
  try {
    [readiness, axes] = await Promise.all([getReadiness(), listAxes()]);
  } catch {
    return (
      <>
        <div className="topbar">
          <div className="topbar-title">Prediction Readiness</div>
        </div>
        <div className="main-scroll">
          <div className="empty-state">
            <h3>Readiness unavailable</h3>
            <p>Add games and rate them to see prediction readiness status.</p>
            <div className="empty-state-actions">
              <Link href="/collection" className="btn btn-secondary">
                View Collection
              </Link>
              <Link href="/search" className="btn btn-primary">
                Add Game
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const progressPercent =
    readiness.nextStageAt > 0
      ? Math.min(100, Math.round((readiness.ratedGameCount / readiness.nextStageAt) * 100))
      : readiness.stage === 3
        ? 100
        : 0;

  // Build axis name lookup
  const axisMap = new Map(axes.map((a) => [a.id, a.name]));

  // Determine bar tier for axis coverage
  const maxRated =
    readiness.weakAxes.length > 0 ? Math.max(...readiness.weakAxes.map((a) => a.ratedCount)) : 1;

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Prediction Readiness</div>
      </div>

      <div className="main-scroll">
        {/* Stage banner */}
        <div className="readiness-stage-banner">
          <div className="readiness-stage-banner-title">
            Stage {readiness.stage} &mdash; {STAGE_LABELS[readiness.stage]}
          </div>
          <div className="readiness-stage-banner-desc">{STAGE_DESCRIPTIONS[readiness.stage]}</div>
          <div className="readiness-stage-banner-progress">
            <div
              className="readiness-stage-banner-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="readiness-stage-banner-count">
            {readiness.ratedGameCount} / {readiness.nextStageAt} rated
            {readiness.stage < 3 && (
              <>
                {" "}
                &mdash; {readiness.nextStageAt - readiness.ratedGameCount} more for Stage{" "}
                {readiness.stage + 1}
              </>
            )}
          </div>
        </div>

        {/* Stage timeline */}
        <div className="readiness-timeline">
          {[0, 1, 2, 3].map((stageNum) => {
            const isCurrent = stageNum === readiness.stage;
            const isPast = stageNum < readiness.stage;
            return (
              <div
                key={stageNum}
                className={`readiness-timeline-stage${isCurrent ? " current" : ""}${isPast ? " past" : ""}`}
              >
                <div className="readiness-timeline-stage-num">{stageNum}</div>
                <div className="readiness-timeline-stage-label">{STAGE_LABELS[stageNum]}</div>
                <div className="readiness-timeline-stage-desc">
                  {stageNum === 0
                    ? "No predictions"
                    : stageNum === 1
                      ? "Basic predictions"
                      : stageNum === 2
                        ? "Moderate confidence"
                        : "Strong confidence"}
                </div>
                <div className="readiness-timeline-stage-threshold">
                  {STAGE_THRESHOLDS[stageNum]}
                </div>
              </div>
            );
          })}
        </div>

        {/* Weak axes section */}
        {readiness.weakAxes.length > 0 && (
          <>
            <div className="panel-section-title">Axes with Thin Coverage</div>
            <div className="improve-grid">
              <div className="improve-card">
                <div className="improve-card-title">Coverage per axis</div>
                <div className="improve-axis-list">
                  {readiness.weakAxes.map((wa) => {
                    const name = axisMap.get(wa.axisId) ?? wa.axisName;
                    const pct = maxRated > 0 ? Math.round((wa.ratedCount / maxRated) * 100) : 0;
                    const tier =
                      wa.ratedCount <= 2 ? "low" : wa.ratedCount <= 5 ? "medium" : "high";
                    return (
                      <div key={wa.axisId} className="improve-axis-item">
                        <span className="improve-axis-name">{name}</span>
                        <div className="improve-axis-bar-track">
                          <div
                            className={`improve-axis-bar-fill ${tier}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="improve-axis-count">{wa.ratedCount} rated</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Suggested actions */}
        {readiness.suggestedActions.length > 0 && (
          <>
            <div className="panel-section-title">Suggested Actions</div>
            <div className="suggest-list">
              {readiness.suggestedActions.map((action, i) => (
                <div key={i} className="suggest-item">
                  <span className="suggest-dot" />
                  <span>{action}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
