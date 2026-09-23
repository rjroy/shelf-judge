import Link from "next/link";
import type {
  CollectionProfile,
  CollectionProfileAttentionCard,
  CollectionProfileAttentionEvidence,
} from "@shelf-judge/shared";
import { AttentionCardActions } from "./attention-card-actions";

function intentionKindLabel(
  kind: NonNullable<CollectionProfileAttentionCard["intention"]>["kind"],
): string {
  return kind === "want-to-play" ? "Want to play" : kind === "first-play" ? "First play" : "Replay";
}

function evidenceDescription(evidence: CollectionProfileAttentionEvidence): string {
  switch (evidence.kind) {
    case "play-count":
      return `${evidence.value} plays from ${evidence.source}, observed ${evidence.observedAt}`;
    case "dormant":
      return `${evidence.playCount} plays; last played ${evidence.lastPlayedOn}`;
    case "purchase-utilization":
      return `${evidence.achievedPercent}% achieved at ${evidence.multiplier.numerator}/${evidence.multiplier.denominator} utilization`;
    case "intention":
      return `${intentionKindLabel(evidence.intentionKind)} created ${evidence.createdAt}`;
  }
}

function AttentionCard({ card }: { card: CollectionProfileAttentionCard }) {
  const headingId = `${card.id}-heading`;
  const isExplicitIntention = card.ruleId === "explicit-intention" && card.intention !== null;

  return (
    <article
      id={card.id}
      className="attention-card attention-card--quiet"
      aria-labelledby={headingId}
    >
      <Link
        className="attention-game"
        href={`/games/${card.gameId}`}
        aria-label={`Open ${card.gameName}`}
      >
        <span className="attention-game-art" aria-hidden="true">
          <span className="attention-game-fallback">{card.gameName.trim().charAt(0) || "?"}</span>
          {card.gameImageUrl ? (
            // A background image layers over the fallback, which remains visible if the URL fails.
            <span
              className="attention-game-image"
              style={{ backgroundImage: `url("${card.gameImageUrl.replaceAll('"', "%22")}")` }}
            />
          ) : null}
        </span>
        <span className="attention-game-copy">
          <span className="attention-game-title">{card.gameName}</span>
        </span>
      </Link>
      <div className="attention-context">
        <p className="attention-reason">{card.reason}</p>
        <h3 id={headingId} className="attention-decision">
          {card.question}
        </h3>
      </div>

      <div className="profile-actions">
        {card.actions
          .filter((action) => action.command === null && action.operationId !== "shelf.game.get")
          .map((action) => (
            <Link
              key={action.action}
              className="btn btn-secondary"
              href={`/games/${action.destination.gameId}`}
              aria-label={`${action.action} for ${card.gameName}`}
            >
              {action.action === "resolve-intention"
                ? "Manage intention"
                : action.action === "retire-intention"
                  ? "Intention history"
                  : action.action}
            </Link>
          ))}
        <AttentionCardActions actions={card.actions} />
      </div>

      <details>
        <summary>Evidence, score, and supplied actions</summary>
        <section className="attention-evidence" aria-labelledby={`${card.id}-evidence`}>
          <h4 id={`${card.id}-evidence`}>Evidence</h4>
          <dl className="profile-facts">
            <div>
              <dt>Rule</dt>
              <dd>
                {card.ruleId} (version {card.ruleVersion})
              </dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>{evidenceDescription(card.evidence)}</dd>
            </div>
            {card.evidence.kind === "intention" && (
              <div>
                <dt>Evidence intention</dt>
                <dd>{card.evidence.intentionId}</dd>
              </div>
            )}
          </dl>
        </section>

        {isExplicitIntention && card.intention !== null && (
          <section aria-label="Explicit intention association">
            <h4>Explicit intention</h4>
            <dl className="profile-facts">
              <div>
                <dt>Intention</dt>
                <dd>{intentionKindLabel(card.intention.kind)}</dd>
              </div>
              <div>
                <dt>Stable intention ID</dt>
                <dd>{card.intention.intentionId}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{card.intention.createdAt}</dd>
              </div>
            </dl>
          </section>
        )}

        <section aria-label="Score explanation">
          <h4>Score explanation</h4>
          <p>{card.scoreExplanation}</p>
          <dl className="profile-facts">
            <div>
              <dt>Signal strength</dt>
              <dd>
                {card.signalStrength.numerator}/{card.signalStrength.denominator}
              </dd>
            </div>
            <div>
              <dt>Category weight</dt>
              <dd>
                {card.categoryWeight.numerator}/{card.categoryWeight.denominator}
              </dd>
            </div>
            <div>
              <dt>Attention score</dt>
              <dd>
                {card.attentionScore.numerator}/{card.attentionScore.denominator}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-label="Supplied actions">
          <h4>Supplied actions</h4>
          <ul>
            {card.actions.map((action) => (
              <li key={`${action.action}-detail`}>
                {action.action} · {action.operationId}
                {action.command !== null && " · command template supplied"}
              </li>
            ))}
          </ul>
        </section>
      </details>
    </article>
  );
}

export function AttentionSection({
  attention,
  collectionState,
}: {
  attention: CollectionProfile["attention"];
  collectionState: CollectionProfile["identity"]["collectionState"];
}) {
  const state = attention.state as string;
  const empty = state === "empty" || state === "no-winner";

  return (
    <section className="profile-question" aria-labelledby="attention-question">
      <h2 id="attention-question">What deserves my attention or a decision now?</h2>
      {collectionState === "empty" || state === "empty-collection" ? (
        <div className="profile-state" data-attention-state="empty-collection">
          <p className="profile-status-label">Empty collection</p>
          <p>There are no active collection decisions because there are no owned games.</p>
        </div>
      ) : state === "disabled" || attention.cardLimit === 0 ? (
        <div className="profile-state" data-attention-state="disabled">
          <p className="profile-status-label">Attention disabled</p>
          <p>Attention cards are disabled for this profile.</p>
        </div>
      ) : empty ? (
        <div className="profile-state profile-success" data-attention-state="empty">
          <p className="profile-status-label">Available profile, no attention cards</p>
          <p>
            <strong>Nothing needs attention right now.</strong>
          </p>
        </div>
      ) : (
        <div className="attention-list" data-attention-state="ranked">
          {attention.cards.map((card) => (
            <AttentionCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
