import type {
  FutureUsefulCollectionProfile,
  FutureUsefulProfileResult,
  PlayIntention,
  ProfileEntityClassResult,
} from "@shelf-judge/shared";

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

export const mechanicClassFixture: ProfileEntityClassResult = {
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
      populationStandardDeviation: 0,
      range: { min: 8, max: 8 },
      comparatorMeanCurrentFitness: comparatorMean,
      differenceFromComparator: 8 - comparatorMean,
      games: [comparatorGames[0]],
    },
  ],
  overviewEntityIds: [101],
  orderings: {
    rating: [102, 101],
    support: [101, 102],
    name: [102, 101],
  },
};

const emptyClass = (entityClass: "mechanic" | "designer" | "artist"): ProfileEntityClassResult => ({
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
  orderings: { rating: [], support: [], name: [] },
});

export const usefulProfileFixture: FutureUsefulCollectionProfile = {
  status: "available",
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
    state: "active",
    items: [
      {
        id: "attention:intention-1",
        decisionFamily: "play-intention",
        intention: activeIntentionFixture,
        gameName: "Heat",
        question: "Do you still intend to play Heat?",
        whyNow: "You asked Shelf Judge to keep this intention visible.",
        currentPlayEvidence: {
          status: "valid",
          playCount: 0,
          source: "bgg-collection",
          observedAt: "2026-08-27T10:00:00.000Z",
          stale: false,
        },
        responses: ["leave-visible", "complete", "retire", "correct-or-refresh-evidence"],
        abstentionBasis: "Only an explicit active intention qualifies.",
        resolution: null,
        reopenCondition: "Create a new explicit intention after resolution.",
        destination: { gameId: "game-4", operationId: "shelf.game.intention.manage" },
        evidenceDestination: { gameId: "game-4", operationId: "shelf.game.plays.set" },
      },
    ],
  },
  computedAt: "2026-08-27T12:00:00.000Z",
};

export const supportedUsefulProfileFixture: FutureUsefulCollectionProfile = {
  ...structuredClone(usefulProfileFixture),
  attention: { state: "nothing-to-decide", items: [] },
};

export const limitedUsefulProfileFixture: FutureUsefulCollectionProfile = (() => {
  const profile = structuredClone(supportedUsefulProfileFixture);
  const mechanic = profile.identity.classes.mechanic;
  mechanic.result = "limited";
  mechanic.entities = [mechanic.entities[1]];
  mechanic.associatedGameCount = 1;
  mechanic.overviewEntityIds = [];
  mechanic.orderings = { rating: [102], support: [102], name: [102] };
  return profile;
})();

export const mixedReadinessUsefulProfileFixture: FutureUsefulCollectionProfile = (() => {
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

export const activeUsefulProfileFixture: FutureUsefulCollectionProfile =
  structuredClone(usefulProfileFixture);

export const warningUsefulProfileFixture: FutureUsefulCollectionProfile = (() => {
  const profile = structuredClone(activeUsefulProfileFixture);
  profile.attention.items[0].currentPlayEvidence = {
    status: "stale",
    playCount: 0,
    source: "bgg-collection",
    observedAt: "2026-08-27T10:00:00.000Z",
    warning: "A newer BGG check did not provide a valid play count.",
  };
  return profile;
})();

export const nothingToDecideUsefulProfileFixture: FutureUsefulCollectionProfile = {
  status: "available",
  identity: {
    collectionState: "populated",
    classes: {
      mechanic: emptyClass("mechanic"),
      designer: emptyClass("designer"),
      artist: emptyClass("artist"),
    },
    axisDistributions: [],
  },
  attention: { state: "nothing-to-decide", items: [] },
  computedAt: "2026-08-27T12:00:00.000Z",
};

const emptyCollectionClass = (
  entityClass: "mechanic" | "designer" | "artist",
): ProfileEntityClassResult => ({
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
  orderings: { rating: [], support: [], name: [] },
});

export const emptyUsefulProfileFixture: FutureUsefulCollectionProfile = {
  status: "available",
  identity: {
    collectionState: "empty",
    classes: {
      mechanic: emptyCollectionClass("mechanic"),
      designer: emptyCollectionClass("designer"),
      artist: emptyCollectionClass("artist"),
    },
    axisDistributions: [],
  },
  attention: { state: "empty-collection", items: [] },
  computedAt: "2026-08-27T12:00:00.000Z",
};

export const unavailableUsefulProfileFixture: FutureUsefulProfileResult = {
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
    FutureUsefulProfileResult,
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
