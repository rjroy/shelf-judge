import Link from "next/link";
import type {
  FutureUsefulCollectionProfile,
  PlayIntentionAttentionItem,
} from "@shelf-judge/shared";

const responseLabels: Record<PlayIntentionAttentionItem["responses"][number], string> = {
  "leave-visible": "Leave it visible or prioritize the play outside Shelf Judge",
  complete: "Mark the intention complete from personal knowledge",
  retire: "Retire it because it is no longer an intention",
  "correct-or-refresh-evidence": "Correct or refresh the play evidence before deciding",
};

function evidenceActionLabel(item: PlayIntentionAttentionItem): string {
  return item.evidenceDestination.operationId === "shelf.game.bgg.refresh"
    ? "Refresh play evidence"
    : "Correct play evidence";
}

function AttentionItem({ item }: { item: PlayIntentionAttentionItem }) {
  const headingId = `${item.id}-heading`;
  const evidenceId = `${item.id}-evidence`;
  const current = item.currentPlayEvidence;
  return (
    <article id={item.id} className="attention-card" aria-labelledby={headingId}>
      <p className="profile-status-label">Active play intention</p>
      <h3 id={headingId}>{item.question}</h3>
      <p>{item.whyNow}</p>
      <section className="attention-evidence" aria-labelledby={evidenceId}>
        <h4 id={evidenceId}>Evidence</h4>
        <dl className="profile-facts">
          <div>
            <dt>Intention</dt>
            <dd>{item.intention.kind === "first-play" ? "First play" : "Replay"}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{item.intention.createdAt}</dd>
          </div>
          <div>
            <dt>Baseline</dt>
            <dd>
              {item.intention.baseline.playCount} plays from{" "}
              {item.intention.baseline.evidenceSource}, observed{" "}
              {item.intention.baseline.observedAt}
            </dd>
          </div>
          <div>
            <dt>Current evidence</dt>
            <dd>
              {current.status === "valid"
                ? `${current.playCount} plays from ${current.source}, observed ${current.observedAt}`
                : `${current.status}; ${current.playCount === null ? "no valid count" : `${current.playCount} plays`}${current.source === null ? "" : ` from ${current.source}`}${current.observedAt === null ? "" : `, observed ${current.observedAt}`}`}
            </dd>
          </div>
        </dl>
        {current.status !== "valid" && (
          <p className="profile-warning" role="status">
            Evidence warning: {current.warning}
          </p>
        )}
      </section>
      <section className="attention-responses" aria-label="Available responses">
        <h4>Available responses</h4>
        <ul>
          {item.responses.map((response) => (
            <li key={response}>{responseLabels[response]}</li>
          ))}
        </ul>
      </section>
      <dl className="profile-facts">
        <div>
          <dt>Stable intention ID</dt>
          <dd>{item.intention.intentionId}</dd>
        </div>
        <div>
          <dt>Decision family</dt>
          <dd>{item.decisionFamily}</dd>
        </div>
        <div>
          <dt>Why this qualifies</dt>
          <dd>{item.abstentionBasis}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>Active, with no recorded resolution.</dd>
        </div>
        <div>
          <dt>Reopen condition</dt>
          <dd>{item.reopenCondition}</dd>
        </div>
      </dl>
      <div className="profile-actions">
        <Link className="btn btn-primary" href={`/games/${item.destination.gameId}`}>
          Review intention for {item.gameName}
        </Link>
        <Link className="btn btn-secondary" href={`/games/${item.evidenceDestination.gameId}`}>
          {evidenceActionLabel(item)}
        </Link>
      </div>
    </article>
  );
}

export function AttentionSection({
  attention,
  collectionState,
}: {
  attention: FutureUsefulCollectionProfile["attention"];
  collectionState: FutureUsefulCollectionProfile["identity"]["collectionState"];
}) {
  return (
    <section className="profile-question" aria-labelledby="attention-question">
      <h2 id="attention-question">What deserves my attention or a decision now?</h2>
      {attention.state === "active" ? (
        <div className="attention-list" data-attention-state="active">
          {attention.items.map((item) => (
            <AttentionItem key={item.id} item={item} />
          ))}
        </div>
      ) : attention.state === "empty-collection" || collectionState === "empty" ? (
        <div className="profile-state" data-attention-state="empty-collection">
          <p className="profile-status-label">Empty collection</p>
          <p>There are no active collection decisions because there are no owned games.</p>
        </div>
      ) : (
        <div className="profile-state profile-success" data-attention-state="nothing-to-decide">
          <p className="profile-status-label">Available profile, no active intentions</p>
          <p>
            <strong>Nothing needs attention right now.</strong>
          </p>
        </div>
      )}
    </section>
  );
}
