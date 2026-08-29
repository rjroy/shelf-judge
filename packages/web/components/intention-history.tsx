import type { ResolvedPlayIntentionHistory } from "@shelf-judge/shared";

const kindLabel = { "first-play": "First play", replay: "Replay" } as const;
const sourceLabel = {
  "observed-play-increase": "Observed play-count increase",
  "owner-confirmed": "Owner confirmed completion",
  "owner-retired": "Owner retired intention",
} as const;

export function IntentionHistory({ history }: { history: ResolvedPlayIntentionHistory }) {
  if (history.length === 0) return null;
  return (
    <section className="intention-history" aria-labelledby="intention-history-heading">
      <h2 id="intention-history-heading">Resolved play intentions</h2>
      <p className="intention-help">Past decisions stay here as durable game history.</p>
      <ol className="intention-history-list">
        {history.map((item) => (
          <li key={item.intentionId} className="intention-history-item">
            <h3>{kindLabel[item.kind]}</h3>
            <dl className="intention-facts">
              <dt>Baseline</dt>
              <dd>{item.baseline.playCount} recorded plays</dd>
              <dt>Created</dt>
              <dd>
                {item.createdAt}, from {item.baseline.evidenceSource} evidence observed at{" "}
                {item.baseline.observedAt}
              </dd>
              <dt>Resolution</dt>
              <dd>
                {item.resolution.outcome === "completed" ? "Completed" : "Retired"} via{" "}
                {sourceLabel[item.resolution.source]} at {item.resolution.resolvedAt}
              </dd>
              <dt>Intention ID</dt>
              <dd className="intention-id">{item.intentionId}</dd>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
