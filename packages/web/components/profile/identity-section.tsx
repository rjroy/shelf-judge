import Link from "next/link";
import type {
  CollectionProfile,
  CollectionProfileEntityClass,
  CollectionProfileEntityClassResult,
  CollectionProfileEntityEvidence,
} from "@shelf-judge/shared";
import { EntityCard } from "./entity-card";

const entityClasses: CollectionProfileEntityClass[] = ["mechanic", "designer", "artist"];

const classLabels: Record<CollectionProfileEntityClass, string> = {
  mechanic: "Mechanics",
  designer: "Designers",
  artist: "Artists",
};

const resultLabels: Record<CollectionProfileEntityClassResult["result"], string> = {
  supported: "Supported associations available",
  limited: "Limited evidence only",
  "no-eligible-ratings": "Associations found, but no eligible ratings",
  "evaluated-empty": "Evaluated, with no associations",
  "not-evaluated": "Not evaluated",
};

function overviewEntities(
  result: CollectionProfileEntityClassResult,
): CollectionProfileEntityEvidence[] {
  return result.overviewEntityIds.flatMap((entityId) => {
    const entity = result.entities.find((candidate) => candidate.entityId === entityId);
    return entity === undefined ? [] : [entity];
  });
}

function ClassOverview({ result }: { result: CollectionProfileEntityClassResult }) {
  const entities = overviewEntities(result);
  const headingId = `profile-${result.entityClass}-heading`;
  return (
    <section className="profile-class" aria-labelledby={headingId} data-result={result.result}>
      <div className="profile-class-heading">
        <h3 id={headingId}>{classLabels[result.entityClass]}</h3>
        <span className="profile-status-label">{resultLabels[result.result]}</span>
      </div>
      <p className="profile-readiness" data-readiness={result.metadataReadiness.state}>
        Metadata: {result.metadataReadiness.state}. {result.metadataReadiness.completeGameCount} of{" "}
        {result.metadataReadiness.ownedGameCount} owned games have complete metadata;{" "}
        {result.metadataReadiness.refreshNeededGameCount} need refresh and{" "}
        {result.metadataReadiness.unrefreshableGameCount} cannot be refreshed.
      </p>
      {entities.length > 0 ? (
        <div className="profile-entity-grid">
          {entities.map((entity) => (
            <EntityCard key={entity.entityId} entity={entity} entityClass={result.entityClass} />
          ))}
        </div>
      ) : (
        <p className="profile-class-empty">
          {result.result === "limited"
            ? "One- and two-game associations are available in the complete evidence drilldown, but are not identity claims."
            : resultLabels[result.result] + "."}
        </p>
      )}
      {(result.exclusions.length > 0 || result.refreshWarnings.length > 0) && (
        <p className="profile-warning">
          Evidence details include {result.exclusions.length} exclusions and{" "}
          {result.refreshWarnings.length} refresh warnings.
        </p>
      )}
      <Link href={`/profile/entities?class=${result.entityClass}`}>
        View all {classLabels[result.entityClass].toLowerCase()} and evidence
      </Link>
    </section>
  );
}

export function IdentitySection({ identity }: { identity: CollectionProfile["identity"] }) {
  return (
    <section className="profile-question" aria-labelledby="identity-question">
      <h2 id="identity-question">What does my collection reveal about me?</h2>
      {identity.collectionState === "empty" ? (
        <div className="profile-state" data-profile-state="empty-collection">
          <p className="profile-status-label">Empty collection</p>
          <p>Owned games are needed before Shelf Judge can describe collection associations.</p>
          <div className="profile-actions">
            <Link className="btn btn-secondary" href="/import">
              Import games
            </Link>
            <Link className="btn btn-primary" href="/search">
              Add a game
            </Link>
          </div>
        </div>
      ) : (
        <div className="profile-class-list">
          {entityClasses.map((entityClass) => (
            <ClassOverview key={entityClass} result={identity.classes[entityClass]} />
          ))}
        </div>
      )}
      <p className="profile-diagnostic-link">
        <Link href="/profile/axes">Inspect axis distributions as diagnostics</Link>. These verify
        rating coverage and spread; they are not identity claims.
      </p>
    </section>
  );
}
