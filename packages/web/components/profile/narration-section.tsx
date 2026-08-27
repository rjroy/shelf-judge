import type { CollectionProfile, NarratedClaim } from "@shelf-judge/shared";
import { NarrationActions } from "./narration-actions";

interface NarrationSectionProps {
  profile: CollectionProfile;
}

export function NarrationClaim({
  claim,
  profile,
}: {
  claim: NarratedClaim;
  profile: CollectionProfile;
}) {
  const insights = [...(profile.divergence ?? []), ...profile.outliers, ...profile.suggestions];
  return (
    <li>
      <div>
        <strong>Observation:</strong> {claim.observation}
      </div>
      {claim.interpretation && (
        <div>
          <strong>Interpretation:</strong> {claim.interpretation}
        </div>
      )}
      <div className="narration-evidence">
        Evidence:{" "}
        {claim.evidenceReferences.map((reference, index) => {
          const insight = insights.find(({ id }) => id === reference.insightId);
          return (
            <span key={reference.insightId}>
              {index > 0 && ", "}
              <a href={`#insight-${reference.insightId}`}>{reference.insightId}</a>
              {reference.gameIds.map((gameId) => {
                const gameName = insight?.evidence.find((game) => game.gameId === gameId)?.gameName;
                return (
                  <span key={gameId}>
                    {" · "}
                    <a href={`/games/${gameId}`}>{gameName ?? gameId}</a>
                  </span>
                );
              })}
            </span>
          );
        })}
      </div>
    </li>
  );
}

function ClaimBlock({
  title,
  claims,
  profile,
}: {
  title: string;
  claims: NarratedClaim[];
  profile: CollectionProfile;
}) {
  if (claims.length === 0) return null;
  return (
    <div className="narration-block">
      <h4 className="narration-block-title">{title}</h4>
      <ul className="narration-list">
        {claims.map((claim, index) => (
          <NarrationClaim key={`${claim.observation}:${index}`} claim={claim} profile={profile} />
        ))}
      </ul>
    </div>
  );
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

      {narration.abstention ? (
        <div className="narration-summary">{narration.abstention}</div>
      ) : (
        <>
          <ClaimBlock title="Summary" claims={narration.summary} profile={profile} />
          <ClaimBlock title="Surprises" claims={narration.surprises} profile={profile} />
          <ClaimBlock title="Tensions" claims={narration.tensions} profile={profile} />
        </>
      )}
    </div>
  );
}
