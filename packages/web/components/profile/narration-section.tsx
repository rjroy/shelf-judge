import type { CollectionProfile } from "@shelf-judge/shared";
import { NarrationActions } from "./narration-actions";

interface NarrationSectionProps {
  profile: CollectionProfile;
}

export function NarrationSection({ profile }: NarrationSectionProps) {
  const { narration, narrationState } = profile;

  if (narrationState === "empty" || !narration) {
    return (
      <div className="narration-empty">
        <div className="narration-text">
          <div className="narration-label">Collection Narrative</div>
          <div className="narration-desc">
            Generate a natural-language interpretation of your profile &mdash; what your collection
            says about what you value, and where the tensions are.
          </div>
        </div>
        <NarrationActions state="empty" />
      </div>
    );
  }

  return (
    <div className="narration-section">
      <div className="narration-header">
        <div className="narration-label">Collection Narrative</div>
        {narrationState === "stale" && (
          <span className="narration-stale-badge">Based on an older profile</span>
        )}
        <NarrationActions state={narrationState} />
      </div>

      <div className="narration-summary">{narration.summary}</div>

      {narration.surprises.length > 0 && (
        <div className="narration-block">
          <h4 className="narration-block-title">Surprises</h4>
          <ul className="narration-list">
            {narration.surprises.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {narration.tensions.length > 0 && (
        <div className="narration-block">
          <h4 className="narration-block-title">Tensions</h4>
          <ul className="narration-list">
            {narration.tensions.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {narration.blindSpots.length > 0 && (
        <div className="narration-block">
          <h4 className="narration-block-title">Blind Spots</h4>
          <ul className="narration-list">
            {narration.blindSpots.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {narration.curveInsights.length > 0 && (
        <div className="narration-block">
          <h4 className="narration-block-title">Curve Insights</h4>
          <ul className="narration-list">
            {narration.curveInsights.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
