import Link from "next/link";
import type {
  CollectionProfileClassExclusion,
  CollectionProfileEntityClassResult,
  CollectionProfileEntityEvidence,
  CollectionProfileGameFitnessEvidence,
} from "@shelf-judge/shared";

const exclusionLabels: Record<CollectionProfileClassExclusion["reason"], string> = {
  "predicted-fitness": "Predicted fitness",
  "missing-or-invalid-fitness": "Missing or invalid fitness",
  "refresh-needed-metadata": "Metadata refresh needed",
  "unrefreshable-metadata": "Metadata cannot be refreshed",
};

function score(value: number): string {
  return value.toFixed(1);
}

function GameEvidence({ game }: { game: CollectionProfileGameFitnessEvidence }) {
  return (
    <li>
      <Link href={`/games/${game.gameId}`}>{game.gameName}</Link>: {score(game.currentFitness)}{" "}
      current fitness. {game.vetoed ? "Veto applied; displayed fitness is 0." : "No veto applied."}
    </li>
  );
}

export function EntityEvidence({
  entity,
  entityClass,
}: {
  entity: CollectionProfileEntityEvidence;
  entityClass: CollectionProfileEntityClassResult["entityClass"];
}) {
  const headingId = `${entityClass}-${entity.entityId}-heading`;
  return (
    <article
      id={`${entityClass}-${entity.entityId}`}
      className="entity-evidence"
      aria-labelledby={headingId}
      data-support={entity.support}
    >
      <div className="profile-class-heading">
        <h3 id={headingId}>{entity.name}</h3>
        <span className="profile-status-label">
          {entity.support === "supported"
            ? `Supported association: ${entity.associatedGameCount} games`
            : `Limited evidence: ${entity.associatedGameCount} ${entity.associatedGameCount === 1 ? "game" : "games"}`}
        </span>
      </div>
      {entity.support === "limited" && (
        <p className="profile-warning">
          One or two games are not enough to establish a recurring collection pattern.
        </p>
      )}
      <dl className="profile-facts entity-aggregates">
        <div>
          <dt>Mean current fitness</dt>
          <dd>{score(entity.meanCurrentFitness)}</dd>
        </div>
        <div>
          <dt>Population standard deviation</dt>
          <dd>{score(entity.populationStandardDeviation)}</dd>
        </div>
        <div>
          <dt>Range</dt>
          <dd>
            {score(entity.range.min)} to {score(entity.range.max)}
          </dd>
        </div>
        <div>
          <dt>Eligible collection mean</dt>
          <dd>{score(entity.comparatorMeanCurrentFitness)}</dd>
        </div>
        <div>
          <dt>Difference from collection</dt>
          <dd>
            {entity.differenceFromComparator > 0 ? "+" : ""}
            {score(entity.differenceFromComparator)}
          </dd>
        </div>
      </dl>
      <section aria-labelledby={`${headingId}-games`}>
        <h4 id={`${headingId}-games`}>Supporting games</h4>
        <ul className="profile-game-evidence">
          {entity.games.map((game) => (
            <GameEvidence key={game.gameId} game={game} />
          ))}
        </ul>
      </section>
    </article>
  );
}

export function ClassEvidence({ result }: { result: CollectionProfileEntityClassResult }) {
  return (
    <aside className="class-evidence" aria-label={`${result.entityClass} class evidence`}>
      <p className="profile-readiness" data-readiness={result.metadataReadiness.state}>
        Metadata readiness: {result.metadataReadiness.state}. Complete for{" "}
        {result.metadataReadiness.completeGameCount} of {result.metadataReadiness.ownedGameCount};{" "}
        refresh needed for {result.metadataReadiness.refreshNeededGameCount}; unrefreshable for{" "}
        {result.metadataReadiness.unrefreshableGameCount}.
      </p>
      <section aria-labelledby={`${result.entityClass}-comparator-heading`}>
        <h3 id={`${result.entityClass}-comparator-heading`}>Eligible collection comparator</h3>
        <p>
          {result.comparator.gameCount} games
          {result.comparator.meanCurrentFitness === null
            ? "; no comparator mean is available."
            : `; mean current fitness ${score(result.comparator.meanCurrentFitness)}.`}
        </p>
        {result.comparator.games.length > 0 && (
          <ul className="profile-game-evidence">
            {result.comparator.games.map((game) => (
              <GameEvidence key={game.gameId} game={game} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby={`${result.entityClass}-exclusions-heading`}>
        <h3 id={`${result.entityClass}-exclusions-heading`}>Exclusions</h3>
        {result.exclusions.length === 0 ? (
          <p>No games are excluded.</p>
        ) : (
          <ul className="profile-exclusions">
            {result.exclusions.map((exclusion) => (
              <li key={exclusion.gameId}>
                <Link href={`/games/${exclusion.gameId}`}>{exclusion.gameName}</Link>:{" "}
                {exclusionLabels[exclusion.reason]}.{" "}
                {exclusion.hasEntityAssociation
                  ? "An entity association is present."
                  : "No entity association is present."}{" "}
                {exclusion.correctionDestination !== null && (
                  <Link href={`/games/${exclusion.gameId}`}>Review available correction</Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby={`${result.entityClass}-warnings-heading`}>
        <h3 id={`${result.entityClass}-warnings-heading`}>Refresh warnings</h3>
        {result.refreshWarnings.length === 0 ? (
          <p>No refresh warnings.</p>
        ) : (
          <ul className="profile-warnings">
            {result.refreshWarnings.map((warning) => (
              <li key={`${warning.gameId}:${warning.attemptedAt}`}>
                <Link href={`/games/${warning.gameId}`}>{warning.gameName}</Link>, refresh attempted{" "}
                {warning.attemptedAt}: {warning.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
