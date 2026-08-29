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
        Games associated with this {entityClass} average{" "}
        <strong>{score(entity.meanCurrentFitness)}</strong> current fitness, compared with{" "}
        <strong>{score(entity.comparatorMeanCurrentFitness)}</strong> across the eligible
        collection. Based on {entity.associatedGameCount} games.
      </p>
      <Link href={`/profile/entities#${entityClass}-${entity.entityId}`}>
        Inspect complete evidence for {entity.name}
      </Link>
    </article>
  );
}
