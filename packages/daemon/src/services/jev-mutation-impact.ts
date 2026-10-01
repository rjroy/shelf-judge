import type { CollectionV10, DurableGame } from "@shelf-judge/shared";

export type JevMutationDependencyKind = "C_ONLY" | "D_ONLY" | "SHARED_CD";

export interface JevMutationSourceImpact {
  gameId: string;
  kinds: JevMutationDependencyKind[];
}

/** Pure description-source impact. It never decides or performs cache deletion. */
export interface JevMutationImpact {
  /** Source games whose incident pair rows require deletion, with exact dependency kinds. */
  sourceInvalidations: JevMutationSourceImpact[];
  /** The accepted collection can no longer safely activate the prior advisory generation. */
  withdrawAdvisory: boolean;
  /** Stable IDs of added, removed, or factual/eligibility-changed games. */
  affectedGameIds: string[];
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function factualEvidenceChanged(prior: DurableGame, accepted: DurableGame): boolean {
  // Deliberately exclude name, BGG description, owner note and observation timestamps:
  // those have their own source dependencies or are timestamp-only observations.
  const fields = (game: DurableGame) => ({
    bggId: game.bggId,
    additionalBggIds: game.additionalBggIds,
    yearPublished: game.yearPublished,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    bestPlayers: game.bestPlayers,
    playingTime: game.playingTime,
    imageUrl: game.imageUrl,
    bggData: game.bggData && {
      communityRating: game.bggData.communityRating,
      bayesAverage: game.bggData.bayesAverage,
      weight: game.bggData.weight,
      numWeightVotes: game.bggData.numWeightVotes,
      mechanics: game.bggData.mechanics,
      categories: game.bggData.categories,
      families: game.bggData.families,
      subdomains: game.bggData.subdomains,
      bestPlayerCount: game.bggData.bestPlayerCount,
    },
    numPlays: game.numPlays,
    recentPlayCount: game.recentPlayCount,
    acquisition: game.acquisition,
    playCountEvidence: game.playCountEvidence,
    durationEvidence: game.durationEvidence,
    playerRangeEvidence: game.playerRangeEvidence,
    suggestedPlayerPoll: game.suggestedPlayerPoll,
    bestPlayersInvalidEvidence: game.bestPlayersInvalidEvidence,
    manualValues: game.manualValues,
    entityMetadata: game.entityMetadata,
    latestPlayCountCheck: game.latestPlayCountCheck,
    ownership: game.ownership,
    boxDimensions: game.boxDimensions,
    manualShelfId: game.manualShelfId,
    ratings: game.ratings,
  });
  return !sameJsonValue(fields(prior), fields(accepted));
}

const KIND_ORDER: JevMutationDependencyKind[] = ["C_ONLY", "D_ONLY", "SHARED_CD"];

function addKinds(
  target: Map<string, Set<JevMutationDependencyKind>>,
  id: string,
  kinds: JevMutationDependencyKind[],
): void {
  const existing = target.get(id) ?? new Set<JevMutationDependencyKind>();
  for (const kind of kinds) existing.add(kind);
  target.set(id, existing);
}

/** Derives affected pair source kinds exclusively from the accepted/prior durable snapshots. */
export function planJevMutationImpact(
  prior: CollectionV10,
  accepted: CollectionV10,
): JevMutationImpact {
  const priorGames = new Map(prior.games.map((game) => [game.id, game]));
  const acceptedGames = new Map(accepted.games.map((game) => [game.id, game]));
  const sourceKinds = new Map<string, Set<JevMutationDependencyKind>>();
  const affected = new Set<string>();
  let withdrawAdvisory = false;

  for (const id of new Set([...priorGames.keys(), ...acceptedGames.keys()])) {
    const before = priorGames.get(id);
    const after = acceptedGames.get(id);
    if (!before || !after) {
      affected.add(id);
      withdrawAdvisory = true;
      if (before && !after) addKinds(sourceKinds, id, KIND_ORDER);
      continue;
    }
    const kinds: JevMutationDependencyKind[] = [];
    if (before.name !== after.name) kinds.push(...KIND_ORDER);
    if (before.bggData?.description !== after.bggData?.description) {
      kinds.push("C_ONLY", "SHARED_CD");
    }
    const beforeNote = before.ownerNote;
    const afterNote = after.ownerNote;
    if (
      beforeNote.state !== afterNote.state ||
      beforeNote.version !== afterNote.version ||
      (beforeNote.state === "present" &&
        afterNote.state === "present" &&
        beforeNote.text !== afterNote.text)
    ) {
      kinds.push("D_ONLY", "SHARED_CD");
    }
    if (kinds.length) addKinds(sourceKinds, id, kinds);
    if (before.ownership !== after.ownership || factualEvidenceChanged(before, after)) {
      affected.add(id);
      withdrawAdvisory = true;
    }
  }

  const beforeSettings = prior.semanticRedundancy.settings;
  const afterSettings = accepted.semanticRedundancy.settings;
  if (!sameJsonValue(beforeSettings, afterSettings)) withdrawAdvisory = true;
  if (
    prior.semanticRedundancy.evidenceEpoch !== accepted.semanticRedundancy.evidenceEpoch ||
    prior.semanticRedundancy.consentEpoch !== accepted.semanticRedundancy.consentEpoch ||
    prior.semanticRedundancy.factualWeightsEpoch !==
      accepted.semanticRedundancy.factualWeightsEpoch ||
    prior.semanticRedundancy.factualWeightsFingerprint !==
      accepted.semanticRedundancy.factualWeightsFingerprint
  ) {
    withdrawAdvisory = true;
  }

  const sourceInvalidations = [...sourceKinds.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([gameId, kinds]) => ({
      gameId,
      kinds: KIND_ORDER.filter((kind) => kinds.has(kind)),
    }));

  return { sourceInvalidations, withdrawAdvisory, affectedGameIds: [...affected].sort() };
}
