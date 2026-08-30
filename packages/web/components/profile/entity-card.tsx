import Link from "next/link";
import type {
  CollectionProfileEntityEvidence,
  CollectionProfileEntityClass,
} from "@shelf-judge/shared";

function score(value: number): string {
  return value.toFixed(1);
}

export function EntityCard({
  entity,
  entityClass,
}: {
  entity: CollectionProfileEntityEvidence;
  entityClass: CollectionProfileEntityClass;
}) {
  return (
    <article className="profile-entity-summary" data-support={entity.support}>
      <div className="profile-entity-summary-heading">
        <strong>{entity.name}</strong>
        <span className="profile-status-label">Supported association</span>
      </div>
      <p>
        <strong>Adjusted fit</strong> {score(entity.adjustedMeanCurrentFitness)}
      </p>
      <p>For games in this collection associated with this {entityClass}:</p>
      <dl className="profile-facts">
        <div>
          <dt>Raw mean</dt>
          <dd>{score(entity.meanCurrentFitness)}</dd>
        </div>
        <div>
          <dt>Class comparator</dt>
          <dd>{score(entity.comparatorMeanCurrentFitness)}</dd>
        </div>
        <div>
          <dt>Associated games</dt>
          <dd>{entity.associatedGameCount}</dd>
        </div>
      </dl>
      <Link href={`/profile/entities?class=${entityClass}&entity=${entity.entityId}`}>
        Inspect complete evidence for {entity.name}
      </Link>
    </article>
  );
}
