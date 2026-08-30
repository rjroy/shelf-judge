// Pure computation for the approved collection profile. No I/O or service dependencies.

import type {
  Collection,
  CollectionProfile,
  CollectionProfileAttentionItem,
  CollectionProfileClassExclusion,
  CollectionProfileEntityClass,
  CollectionProfileEntityClassResult,
  CollectionProfileEntityEvidence,
  CollectionProfileEntityPolicy,
  CollectionProfileGameFitnessEvidence,
  FitnessResult,
  Game,
} from "@shelf-judge/shared";
import {
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  ExactRational,
  isEnabledScoringAxis,
} from "@shelf-judge/shared";
import { computeCollectionProfileAxisDistributions } from "./collection-profile-axis-distributions.js";

export interface CollectionProfileInput {
  collection: Collection;
  fitnessResults: ReadonlyMap<string, FitnessResult>;
  computedAt: string;
  entityPolicy?: CollectionProfileEntityPolicy;
}

const PROFILE_ENTITY_CLASSES: CollectionProfileEntityClass[] = ["mechanic", "designer", "artist"];

function compareNormalizedCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left.normalize("NFC"), (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right.normalize("NFC"), (value) => value.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function profileFitnessEvidence(
  game: Game,
  fitness: FitnessResult,
): CollectionProfileGameFitnessEvidence {
  return {
    gameId: game.id,
    gameName: game.name,
    currentFitness: fitness.score,
    vetoed: fitness.vetoed,
  };
}

function classExclusion(
  game: Game,
  entityClass: CollectionProfileEntityClass,
  fitness: FitnessResult | undefined,
): CollectionProfileClassExclusion | null {
  const metadata = game.entityMetadata[entityClass];
  const hasEntityAssociation = metadata.state === "complete" && metadata.entities.length > 0;
  if (metadata.state === "refresh-needed") {
    return {
      gameId: game.id,
      gameName: game.name,
      reason: "refresh-needed-metadata",
      hasEntityAssociation,
      correctionDestination: { operationId: "shelf.game.bgg.refresh" },
    };
  }
  if (metadata.state === "unrefreshable") {
    return {
      gameId: game.id,
      gameName: game.name,
      reason: "unrefreshable-metadata",
      hasEntityAssociation,
      correctionDestination: null,
    };
  }
  if ((fitness?.predictionMeta?.predictedAxisCount ?? 0) > 0) {
    return {
      gameId: game.id,
      gameName: game.name,
      reason: "predicted-fitness",
      hasEntityAssociation,
      correctionDestination: null,
    };
  }
  if (
    fitness === undefined ||
    !fitness.breakdown.some(({ contribution }) => contribution !== null) ||
    !Number.isFinite(fitness.score) ||
    fitness.score < 0 ||
    fitness.score > 10 ||
    (fitness.vetoed && fitness.score !== 0)
  ) {
    return {
      gameId: game.id,
      gameName: game.name,
      reason: "missing-or-invalid-fitness",
      hasEntityAssociation,
      correctionDestination: { operationId: "shelf.game.rating.set" },
    };
  }
  return null;
}

function exactFitnessMean(games: CollectionProfileGameFitnessEvidence[]): ExactRational {
  return games
    .reduce(
      (sum, game) => sum.add(ExactRational.fromDecimal(game.currentFitness.toString())),
      new ExactRational(0n),
    )
    .divide(new ExactRational(BigInt(games.length)));
}

function entityOrderings(entities: CollectionProfileEntityEvidence[]) {
  const rating = [...entities].sort(
    (left, right) =>
      exactFitnessMean(right.games).compare(exactFitnessMean(left.games)) ||
      right.associatedGameCount - left.associatedGameCount ||
      compareNormalizedCodePoints(left.name, right.name) ||
      left.entityId - right.entityId,
  );
  const support = [...entities].sort(
    (left, right) =>
      right.associatedGameCount - left.associatedGameCount ||
      exactFitnessMean(right.games).compare(exactFitnessMean(left.games)) ||
      compareNormalizedCodePoints(left.name, right.name) ||
      left.entityId - right.entityId,
  );
  const name = [...entities].sort(
    (left, right) =>
      compareNormalizedCodePoints(left.name, right.name) || left.entityId - right.entityId,
  );
  return {
    rating: rating.map(({ entityId }) => entityId),
    support: support.map(({ entityId }) => entityId),
    name: name.map(({ entityId }) => entityId),
  };
}

function computeEntityClass(
  ownedGames: Game[],
  fitnessResults: ReadonlyMap<string, FitnessResult>,
  entityClass: CollectionProfileEntityClass,
  policy: CollectionProfileEntityPolicy,
): CollectionProfileEntityClassResult {
  const classPolicy = policy[entityClass];
  const readinessCounts = { complete: 0, "refresh-needed": 0, unrefreshable: 0 };
  const exclusions: CollectionProfileClassExclusion[] = [];
  const comparatorGames: CollectionProfileGameFitnessEvidence[] = [];
  for (const game of ownedGames) {
    readinessCounts[game.entityMetadata[entityClass].state] += 1;
    const fitness = fitnessResults.get(game.id);
    const exclusion = classExclusion(game, entityClass, fitness);
    if (exclusion !== null) exclusions.push(exclusion);
    else if (fitness !== undefined) comparatorGames.push(profileFitnessEvidence(game, fitness));
  }
  comparatorGames.sort((left, right) => compareNormalizedCodePoints(left.gameId, right.gameId));
  exclusions.sort((left, right) => compareNormalizedCodePoints(left.gameId, right.gameId));

  const comparatorMean =
    comparatorGames.length === 0 ? null : exactFitnessMean(comparatorGames).toNumber();
  const eligibleById = new Map(comparatorGames.map((evidence) => [evidence.gameId, evidence]));
  const observations = new Map<
    number,
    {
      name: string;
      observedAt: string;
      gameId: string;
      evidence: CollectionProfileGameFitnessEvidence;
    }[]
  >();
  for (const game of ownedGames) {
    const evidence = eligibleById.get(game.id);
    const metadata = game.entityMetadata[entityClass];
    if (evidence === undefined || metadata.state !== "complete") continue;
    const seen = new Set<number>();
    for (const entity of metadata.entities) {
      if (seen.has(entity.id)) {
        observations.get(entity.id)?.push({
          name: entity.name,
          observedAt: metadata.observedAt,
          gameId: game.id,
          evidence,
        });
        continue;
      }
      seen.add(entity.id);
      const values = observations.get(entity.id) ?? [];
      values.push({
        name: entity.name,
        observedAt: metadata.observedAt,
        gameId: game.id,
        evidence,
      });
      observations.set(entity.id, values);
    }
  }

  const entities = [...observations].map(([entityId, values]): CollectionProfileEntityEvidence => {
    const canonical = ownedGames
      .flatMap((game) => {
        const metadata = game.entityMetadata[entityClass];
        return metadata.state === "complete"
          ? metadata.entities
              .filter(({ id }) => id === entityId)
              .map(({ name }) => ({ name, observedAt: metadata.observedAt, gameId: game.id }))
          : [];
      })
      .sort(
        (left, right) =>
          Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
          compareNormalizedCodePoints(left.name, right.name) ||
          compareNormalizedCodePoints(left.gameId, right.gameId),
      )[0];
    if (canonical === undefined || comparatorMean === null) {
      throw new Error(`Entity ${entityId} has no eligible evidence`);
    }
    const games = [
      ...new Map(values.map(({ evidence }) => [evidence.gameId, evidence])).values(),
    ].sort((left, right) => compareNormalizedCodePoints(left.gameId, right.gameId));
    const entityMean = exactFitnessMean(games).toNumber();
    const populationStandardDeviation = Math.sqrt(
      games.reduce((sum, game) => sum + (game.currentFitness - entityMean) ** 2, 0) / games.length,
    );
    return {
      entityId,
      name: canonical.name,
      support: games.length >= classPolicy.minimumSupportedGames ? "supported" : "limited",
      associatedGameCount: games.length,
      meanCurrentFitness: entityMean,
      populationStandardDeviation,
      range: {
        min: Math.min(...games.map(({ currentFitness }) => currentFitness)),
        max: Math.max(...games.map(({ currentFitness }) => currentFitness)),
      },
      comparatorMeanCurrentFitness: comparatorMean,
      differenceFromComparator: entityMean - comparatorMean,
      games,
    };
  });
  const orderings = entityOrderings(entities);
  const associatedGameIds = new Set(
    entities.flatMap(({ games }) => games.map(({ gameId }) => gameId)),
  );
  for (const exclusion of exclusions) {
    if (exclusion.hasEntityAssociation) associatedGameIds.add(exclusion.gameId);
  }
  const completeGameCount = readinessCounts.complete;
  const metadataReadiness = {
    state:
      completeGameCount === ownedGames.length
        ? ("complete" as const)
        : completeGameCount === 0
          ? ("refresh-needed" as const)
          : ("partial" as const),
    ownedGameCount: ownedGames.length,
    completeGameCount,
    refreshNeededGameCount: readinessCounts["refresh-needed"],
    unrefreshableGameCount: readinessCounts.unrefreshable,
  };
  const result = entities.some(({ support: entitySupport }) => entitySupport === "supported")
    ? "supported"
    : entities.length > 0
      ? "limited"
      : associatedGameIds.size > 0
        ? "no-eligible-ratings"
        : completeGameCount > 0
          ? "evaluated-empty"
          : "not-evaluated";
  return {
    entityClass,
    result,
    metadataReadiness,
    associatedGameCount: associatedGameIds.size,
    comparator: {
      gameCount: comparatorGames.length,
      meanCurrentFitness: comparatorMean,
      games: comparatorGames,
    },
    exclusions,
    refreshWarnings: ownedGames
      .flatMap((game) => {
        const metadata = game.entityMetadata[entityClass];
        return metadata.state === "complete" && metadata.refreshFailure !== null
          ? [{ gameId: game.id, gameName: game.name, ...metadata.refreshFailure }]
          : [];
      })
      .sort((left, right) => compareNormalizedCodePoints(left.gameId, right.gameId)),
    entities,
    overviewEntityIds: orderings.rating
      .filter(
        (entityId) =>
          entities.find((entity) => entity.entityId === entityId)?.support === "supported",
      )
      .slice(0, classPolicy.overviewLimit),
    orderings,
  };
}

function attentionPlayEvidence(game: Game): CollectionProfileAttentionItem["currentPlayEvidence"] {
  const evidence = game.playCountEvidence;
  const latestCheck = game.latestPlayCountCheck;
  const stale =
    evidence.status === "valid" &&
    latestCheck !== null &&
    latestCheck.status !== "valid" &&
    (evidence.observedAt === null ||
      Date.parse(latestCheck.observedAt) > Date.parse(evidence.observedAt));
  if (evidence.status === "valid" && evidence.observedAt !== null && !stale) {
    return {
      status: "valid",
      playCount: evidence.value,
      source: evidence.source,
      observedAt: evidence.observedAt,
      stale: false,
    };
  }
  if (evidence.status === "valid" && stale) {
    return {
      status: "stale",
      playCount: evidence.value,
      source: evidence.source,
      observedAt: evidence.observedAt,
      warning: "A newer BGG check did not provide a valid play count.",
    };
  }
  if (evidence.status === "invalid" || latestCheck?.status === "invalid") {
    return {
      status: "invalid",
      playCount: null,
      source: evidence.source,
      observedAt: evidence.observedAt,
      warning: "Current play evidence is invalid.",
    };
  }
  return {
    status: "missing",
    playCount: null,
    source: evidence.source,
    observedAt: evidence.observedAt,
    warning: "Current play evidence is missing.",
  };
}

function attentionItem(
  game: Game,
  intention: Collection["intentions"][number],
): CollectionProfileAttentionItem {
  const currentPlayEvidence = attentionPlayEvidence(game);
  return {
    id: `attention:${intention.intentionId}`,
    decisionFamily: "play-intention",
    intention: structuredClone(intention),
    gameName: game.name,
    question:
      intention.kind === "first-play"
        ? `Do you still intend to play ${game.name}?`
        : `Do you still intend to replay ${game.name}?`,
    whyNow: "You asked Shelf Judge to keep this intention visible.",
    currentPlayEvidence,
    responses: ["leave-visible", "complete", "retire", "correct-or-refresh-evidence"],
    abstentionBasis: "Only an explicit active intention qualifies.",
    resolution: null,
    reopenCondition: "Create a new explicit intention after resolution.",
    destination: { gameId: game.id, operationId: "shelf.game.intention.manage" },
    evidenceDestination: {
      gameId: game.id,
      operationId:
        currentPlayEvidence.status === "valid" || game.bggId === null
          ? "shelf.game.plays.set"
          : "shelf.game.bgg.refresh",
    },
  };
}

/** Compute the useful collection profile without reading or mutating external state. */
export function computeCollectionProfile(input: CollectionProfileInput): CollectionProfile {
  const entityPolicy = input.entityPolicy ?? DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY;
  const ownedGames = input.collection.games.filter(({ ownership }) => ownership === "owned");
  const gamesById = new Map(ownedGames.map((game) => [game.id, game]));
  const ownedFitnessResults = new Map(
    [...input.fitnessResults].filter(([gameId]) => gamesById.has(gameId)),
  );
  const items = input.collection.intentions
    .flatMap((intention) => {
      const game = gamesById.get(intention.gameId);
      return intention.resolution === null && game !== undefined
        ? [attentionItem(game, intention)]
        : [];
    })
    .sort(
      (left, right) =>
        compareNormalizedCodePoints(left.gameName, right.gameName) ||
        compareNormalizedCodePoints(left.intention.gameId, right.intention.gameId),
    );
  const collectionState = ownedGames.length === 0 ? "empty" : "populated";
  return {
    status: "available",
    entityPolicy: structuredClone(entityPolicy),
    identity: {
      collectionState,
      classes: Object.fromEntries(
        PROFILE_ENTITY_CLASSES.map((entityClass) => [
          entityClass,
          computeEntityClass(ownedGames, ownedFitnessResults, entityClass, entityPolicy),
        ]),
      ) as Record<CollectionProfileEntityClass, CollectionProfileEntityClassResult>,
      axisDistributions: computeCollectionProfileAxisDistributions(
        input.collection.axes.filter(isEnabledScoringAxis),
        ownedFitnessResults,
      ),
    },
    attention: {
      state:
        items.length > 0
          ? "active"
          : collectionState === "empty"
            ? "empty-collection"
            : "nothing-to-decide",
      items,
    },
    computedAt: input.computedAt,
  };
}
