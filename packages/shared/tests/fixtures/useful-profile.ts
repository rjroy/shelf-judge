import type {
  CollectionProfile,
  CollectionProfileResult,
  PlayIntention,
  CollectionProfileEntityClassResult,
} from "@shelf-judge/shared";
import { DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY } from "@shelf-judge/shared";

export const activeIntentionFixture: PlayIntention = {
  intentionId: "intention-1",
  gameId: "game-4",
  kind: "first-play",
  baseline: {
    playCount: 0,
    evidenceSource: "bgg-collection",
    observedAt: "2026-08-27T10:00:00.000Z",
  },
  createdAt: "2026-08-27T10:01:00.000Z",
  version: 1,
  resolution: null,
};

const comparatorGames = [
  { gameId: "game-1", gameName: "Alpha", currentFitness: 8, vetoed: false },
  { gameId: "game-2", gameName: "Beta", currentFitness: 6, vetoed: false },
  { gameId: "game-3", gameName: "Gamma", currentFitness: 0, vetoed: true },
];

const comparatorMean = 14 / 3;
const standardDeviation = Math.sqrt(
  comparatorGames.reduce(
    (sum, { currentFitness }) => sum + (currentFitness - comparatorMean) ** 2,
    0,
  ) / comparatorGames.length,
);

const readiness = {
  state: "complete" as const,
  ownedGameCount: 4,
  completeGameCount: 4,
  refreshNeededGameCount: 0,
  unrefreshableGameCount: 0,
};

export const mechanicClassFixture: CollectionProfileEntityClassResult = {
  entityClass: "mechanic",
  result: "supported",
  metadataReadiness: readiness,
  associatedGameCount: 3,
  comparator: {
    gameCount: 3,
    meanCurrentFitness: comparatorMean,
    games: comparatorGames,
  },
  exclusions: [
    {
      gameId: "game-4",
      gameName: "Heat",
      reason: "missing-or-invalid-fitness",
      hasEntityAssociation: false,
      correctionDestination: { operationId: "shelf.game.rating.set" },
    },
  ],
  refreshWarnings: [],
  entities: [
    {
      entityId: 101,
      name: "Worker Placement",
      support: "supported",
      associatedGameCount: 3,
      meanCurrentFitness: comparatorMean,
      adjustedMeanCurrentFitness: comparatorMean,
      populationStandardDeviation: standardDeviation,
      range: { min: 0, max: 8 },
      comparatorMeanCurrentFitness: comparatorMean,
      differenceFromComparator: 0,
      games: comparatorGames,
    },
    {
      entityId: 102,
      name: "Solo",
      support: "limited",
      associatedGameCount: 1,
      meanCurrentFitness: 8,
      adjustedMeanCurrentFitness: 11 / 2,
      populationStandardDeviation: 0,
      range: { min: 8, max: 8 },
      comparatorMeanCurrentFitness: comparatorMean,
      differenceFromComparator: 8 - comparatorMean,
      games: [comparatorGames[0]],
    },
  ],
  overviewEntityIds: [101],
  orderings: {
    bestFit: [102, 101],
    support: [101, 102],
    name: [102, 101],
  },
};

const emptyClass = (
  entityClass: "mechanic" | "designer" | "artist",
): CollectionProfileEntityClassResult => ({
  entityClass,
  result: "evaluated-empty",
  metadataReadiness: readiness,
  associatedGameCount: 0,
  comparator: {
    gameCount: 3,
    meanCurrentFitness: comparatorMean,
    games: comparatorGames,
  },
  exclusions: [
    {
      gameId: "game-4",
      gameName: "Heat",
      reason: "missing-or-invalid-fitness",
      hasEntityAssociation: false,
      correctionDestination: { operationId: "shelf.game.rating.set" },
    },
  ],
  refreshWarnings: [],
  entities: [],
  overviewEntityIds: [],
  orderings: { bestFit: [], support: [], name: [] },
});

export const usefulProfileFixture: CollectionProfile = {
  status: "available",
  entityPolicy: DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  identity: {
    collectionState: "populated",
    classes: {
      mechanic: mechanicClassFixture,
      designer: emptyClass("designer"),
      artist: emptyClass("artist"),
    },
    axisDistributions: [],
  },
  attention: {
    state: "ranked",
    cardLimit: 6,
    cards: [
      {
        id: "attention:game-4:explicit-intention",
        gameId: "game-4",
        ruleId: "explicit-intention",
        ruleVersion: 1,
        dependencyVersion: 1,
        intention: activeIntentionFixture,
        gameName: "Heat",
        question: "Do you still want to play Heat?",
        reason: "You marked Heat as Want to play.",
        scoreExplanation: "Signal strength 1 × category weight 0.7 = attention score 0.7.",
        actions: [
          {
            action: "resolve-intention",
            operationId: "shelf.game.intention.complete",
            destination: { gameId: "game-4", operationId: "shelf.game.intention.complete" },
            command: null,
          },
          {
            action: "retire-intention",
            operationId: "shelf.game.intention.retire",
            destination: { gameId: "game-4", operationId: "shelf.game.intention.retire" },
            command: null,
          },
          {
            action: "not-now",
            operationId: "shelf.profile.attention.not-now",
            destination: { gameId: "game-4", operationId: "shelf.profile.attention.not-now" },
            command: {
              operation: "not-now",
              gameId: "game-4",
              ruleId: "explicit-intention",
              ruleVersion: 1,
              fingerprint: "a".repeat(64),
              expectedVersion: 0,
            },
          },
          {
            action: "intentional",
            operationId: "shelf.profile.attention.intentional",
            destination: { gameId: "game-4", operationId: "shelf.profile.attention.intentional" },
            command: {
              operation: "intentional",
              gameId: "game-4",
              ruleId: "explicit-intention",
              ruleVersion: 1,
              fingerprint: "a".repeat(64),
              expectedVersion: 0,
            },
          },
          {
            action: "open-game",
            operationId: "shelf.game.get",
            destination: { gameId: "game-4", operationId: "shelf.game.get" },
            command: null,
          },
        ],
        evidence: {
          kind: "intention",
          intentionId: "intention-1",
          intentionKind: "first-play",
          createdAt: "2026-08-27T10:01:00.000Z",
          baseline: {
            playCount: 0,
            evidenceSource: "bgg-collection",
            observedAt: "2026-08-27T10:00:00.000Z",
          },
        },
        disposition: { state: "none", expectedVersion: 0 },
        nonClockFingerprint: "a".repeat(64),
        signalStrength: { numerator: "1", denominator: "1" },
        categoryWeight: { numerator: "7", denominator: "10" },
        attentionScore: { numerator: "7", denominator: "10" },
      },
    ],
  },
  computedAt: "2026-08-27T12:00:00.000Z",
};

export const supportedUsefulProfileFixture: CollectionProfile = {
  ...structuredClone(usefulProfileFixture),
  attention: { state: "no-winner", cardLimit: 6, cards: [] },
};

export const limitedUsefulProfileFixture: CollectionProfile = (() => {
  const profile = structuredClone(supportedUsefulProfileFixture);
  const mechanic = profile.identity.classes.mechanic;
  mechanic.result = "limited";
  mechanic.entities = [mechanic.entities[1]];
  mechanic.associatedGameCount = 1;
  mechanic.overviewEntityIds = [];
  mechanic.orderings = { bestFit: [102], support: [102], name: [102] };
  return profile;
})();

export const mixedReadinessUsefulProfileFixture: CollectionProfile = (() => {
  const profile = structuredClone(supportedUsefulProfileFixture);
  const designer = profile.identity.classes.designer;
  designer.metadataReadiness = {
    state: "partial",
    ownedGameCount: 4,
    completeGameCount: 3,
    refreshNeededGameCount: 1,
    unrefreshableGameCount: 0,
  };
  designer.exclusions = [
    {
      gameId: "game-4",
      gameName: "Heat",
      reason: "refresh-needed-metadata",
      hasEntityAssociation: false,
      correctionDestination: { operationId: "shelf.game.bgg.refresh" },
    },
  ];
  return profile;
})();

export const activeUsefulProfileFixture: CollectionProfile = structuredClone(usefulProfileFixture);

export const warningUsefulProfileFixture: CollectionProfile = (() => {
  const profile = structuredClone(activeUsefulProfileFixture);
  return profile;
})();

export const nothingToDecideUsefulProfileFixture: CollectionProfile = {
  status: "available",
  entityPolicy: DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  identity: {
    collectionState: "populated",
    classes: {
      mechanic: emptyClass("mechanic"),
      designer: emptyClass("designer"),
      artist: emptyClass("artist"),
    },
    axisDistributions: [],
  },
  attention: { state: "no-winner", cardLimit: 6, cards: [] },
  computedAt: "2026-08-27T12:00:00.000Z",
};

const emptyCollectionClass = (
  entityClass: "mechanic" | "designer" | "artist",
): CollectionProfileEntityClassResult => ({
  entityClass,
  result: "not-evaluated",
  metadataReadiness: {
    state: "complete",
    ownedGameCount: 0,
    completeGameCount: 0,
    refreshNeededGameCount: 0,
    unrefreshableGameCount: 0,
  },
  associatedGameCount: 0,
  comparator: { gameCount: 0, meanCurrentFitness: null, games: [] },
  exclusions: [],
  refreshWarnings: [],
  entities: [],
  overviewEntityIds: [],
  orderings: { bestFit: [], support: [], name: [] },
});

export const emptyUsefulProfileFixture: CollectionProfile = {
  status: "available",
  entityPolicy: DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  identity: {
    collectionState: "empty",
    classes: {
      mechanic: emptyCollectionClass("mechanic"),
      designer: emptyCollectionClass("designer"),
      artist: emptyCollectionClass("artist"),
    },
    axisDistributions: [],
  },
  attention: { state: "empty-collection", cardLimit: 6, cards: [] },
  computedAt: "2026-08-27T12:00:00.000Z",
};

export const unavailableUsefulProfileFixture: CollectionProfileResult = {
  status: "unavailable",
  error: { kind: "transport", message: "Daemon unavailable" },
  retryDestination: { operationId: "shelf.profile.get" },
};

export const canonicalUsefulProfileFixtures: ReadonlyArray<
  readonly [
    (
      | "supported"
      | "limited"
      | "mixed-readiness"
      | "active"
      | "warning"
      | "nothing-to-decide"
      | "empty"
      | "unavailable"
    ),
    CollectionProfileResult,
  ]
> = [
  ["supported", supportedUsefulProfileFixture],
  ["limited", limitedUsefulProfileFixture],
  ["mixed-readiness", mixedReadinessUsefulProfileFixture],
  ["active", activeUsefulProfileFixture],
  ["warning", warningUsefulProfileFixture],
  ["nothing-to-decide", nothingToDecideUsefulProfileFixture],
  ["empty", emptyUsefulProfileFixture],
  ["unavailable", unavailableUsefulProfileFixture],
];
