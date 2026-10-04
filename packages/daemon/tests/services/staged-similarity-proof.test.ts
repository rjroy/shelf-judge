import { describe, expect, test } from "bun:test";
import type {
  Collection,
  DurableGame,
  PredictionSettings,
  TournamentData,
} from "@shelf-judge/shared";
import { createInitialSemanticRedundancyStateV10 } from "@shelf-judge/shared";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureSimilaritySettings } from "../../src/services/unified-similarity.js";
import { DEFAULT_REDUNDANCY_SETTINGS } from "../../src/services/redundancy-engine.js";
import {
  createJevPairCache,
  type JevDependencyKind,
  type JevPairCache,
  type JevPairJudgment,
  type JevSignal,
} from "../../src/services/jev-pair-cache-service.js";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import {
  buildJevPairDependencies,
  encodeOwnedLocalMember,
  encodeWishlistBggMember,
} from "../../src/services/jev-pair-identity.js";
import { canonicalSha256 } from "../../src/services/profile-source-coordinator.js";
import type { SourceVector } from "../../src/services/source-vector.js";
import {
  captureStagedSimilaritySources,
  type StagedSimilaritySources,
  type StagedWishlistCandidateSource,
} from "../../src/services/staged-similarity-capture.js";
import {
  createPreparedSimilarity,
  type StagedSimilarityPair,
} from "../../src/services/prepared-similarity.js";
import {
  createStagedSimilarityPublicationGuard,
  mayRetainStagedNoteDependentOutput,
  readStagedDerivedArtifact,
  type StagedDerivedArtifact,
} from "../../src/services/staged-similarity-publication.js";

const NOW = "2026-10-04T00:00:00.000Z";

function game(
  id: string,
  options: {
    note?: string | null;
    ownership?: "owned" | "previously-owned";
    mechanic?: string;
  } = {},
): DurableGame {
  return {
    id,
    bggId: Number(id.replace(/\D/g, "")) || 101,
    name: `Game ${id}`,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: 3,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 7,
      bayesAverage: 7,
      weight: 2.5,
      numWeightVotes: 0,
      description: `Description ${id}`,
      mechanics: [{ id: 1, name: options.mechanic ?? "Drafting" }],
      categories: [{ id: 2, name: "Strategy" }],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: NOW,
    },
    numPlays: null,
    acquisition: { state: "unknown" },
    playCountEvidence: { status: "missing", source: "manual", observedAt: null },
    durationEvidence: { status: "missing", source: "manual", observedAt: null },
    playerRangeEvidence: { status: "missing", source: "manual", observedAt: null },
    suggestedPlayerPoll: {
      status: "valid",
      state: "absent",
      buckets: [],
      source: "manual",
      observedAt: null,
    },
    bestPlayersInvalidEvidence: null,
    manualValues: { playingTime: null, playerCount: null },
    entityMetadata: { status: "unknown" },
    latestPlayCountCheck: null,
    ownership: options.ownership ?? "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: { personal: 8 },
    createdAt: NOW,
    updatedAt: NOW,
    ownerNote:
      options.note === null
        ? { state: "missing", version: 0, updatedAt: null }
        : {
            state: "present",
            version: 2,
            updatedAt: NOW,
            text: options.note ?? `Private note ${id}`,
          },
  } as unknown as DurableGame;
}

interface SourceOptions {
  games?: DurableGame[];
  notePermission?: boolean;
  ownerNoteWeight?: number;
  descriptionWeight?: number;
  processEpoch?: string;
  changeToken?: number;
  collectionRevision?: number;
  wishlistCandidates?: readonly StagedWishlistCandidateSource[];
}

function sources(options: SourceOptions = {}): StagedSimilaritySources {
  const initialSemantic = createInitialSemanticRedundancyStateV10();
  const semanticSettings = {
    ...initialSemantic.settings,
    enabled: true,
    weights: {
      factual: 1,
      description: options.descriptionWeight ?? 2,
      ownerNote: options.ownerNoteWeight ?? 1,
    },
    cachedOwnerNoteUse: options.notePermission ?? true,
  };
  const semantic = {
    ...initialSemantic,
    settings: semanticSettings,
    evidenceEpoch: 3,
    consentEpoch: 4,
    ownerNoteConsentEpoch: 4,
    factualWeightsEpoch: 2,
    factualWeightsFingerprint: "factual-source-fingerprint",
  };
  const collection = {
    id: "collection-staged",
    name: "Staged test",
    schemaVersion: 10,
    revision: options.collectionRevision ?? 1,
    axes: [],
    games: options.games ?? [
      game("local-a"),
      game("local-b", { ownership: "previously-owned" }),
      game("local-c"),
    ],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy: semantic,
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as Collection;
  const similaritySettings = captureSimilaritySettings(
    DEFAULT_REDUNDANCY_SETTINGS,
    semanticSettings,
  );
  const tournament = {
    settings: { kFactorThreshold: 15, normalizationHalfWidth: 400 },
    sessions: [],
    gameStats: {},
  } as TournamentData;
  const predictionSettings: PredictionSettings = {
    stageThresholds: [5, 15, 30],
    defaultK: 5,
    minSimilarityThreshold: 0.2,
  };
  const sourceVector: SourceVector = {
    available: true,
    unavailableSources: [],
    processEpoch: options.processEpoch ?? "process-one",
    changeToken: options.changeToken ?? 1,
    collectionId: collection.id,
    collectionSchemaVersion: collection.schemaVersion,
    collectionRevision: collection.revision,
    semanticEvidenceEpoch: semantic.evidenceEpoch,
    semanticConsentEpoch: semantic.consentEpoch,
    factualWeightsEpoch: semantic.factualWeightsEpoch,
    factualWeightsFingerprint: semantic.factualWeightsFingerprint,
    redundancyWeightsFingerprint: canonicalSha256(similaritySettings.factual),
    tournamentRevision: 2,
    predictionSettingsRevision: 3,
    nicheSettingsRevision: 4,
    redundancySettingsRevision: 5,
    shelfConfigRevision: 6,
    representationVersion: 1,
    algorithmVersion: 1,
  };
  return {
    collection,
    tournament,
    predictionSettings,
    similaritySettings,
    sourceVector,
    wishlistCandidates: options.wishlistCandidates,
  };
}

function collectionRow(
  current: StagedSimilaritySources,
  left: DurableGame,
  right: DurableGame,
  kind: JevDependencyKind,
  signal: JevSignal,
  value: number,
): JevPairJudgment {
  const sourceFor = (item: DurableGame) => ({
    gameId: item.id,
    name: item.name,
    ...(kind !== "D_ONLY" ? { description: item.bggData!.description! } : {}),
    ...(kind !== "C_ONLY"
      ? {
          note: {
            text: item.ownerNote.state === "present" ? item.ownerNote.text : "",
            version: String(item.ownerNote.version),
          },
        }
      : {}),
  });
  const [gameAId, gameBId] = [left.id, right.id].sort();
  const noteDependent = kind !== "C_ONLY";
  return {
    collectionId: current.collection.id,
    ...(noteDependent
      ? { consentEpoch: String(current.collection.semanticRedundancy.consentEpoch) }
      : {}),
    gameAId,
    gameBId,
    signal,
    dependencyKind: kind,
    value,
    confidence: 0.8,
    ...JEV_JUDGMENT_CONTRACT,
    completedAt: NOW,
    dependencies: buildJevPairDependencies(kind, sourceFor(left), sourceFor(right)),
  };
}

function wishlistRow(
  current: StagedSimilaritySources,
  candidate: StagedWishlistCandidateSource,
  owned: DurableGame,
  value: number,
): JevPairJudgment {
  const candidateId = encodeWishlistBggMember(current.collection.id, String(candidate.bggId));
  const ownedId = encodeOwnedLocalMember(current.collection.id, owned.id);
  const [gameAId, gameBId] = [candidateId, ownedId].sort();
  return {
    pairDomain: "wishlist-candidate",
    collectionId: current.collection.id,
    gameAId,
    gameBId,
    signal: "C",
    dependencyKind: "C_ONLY",
    value,
    confidence: 0.8,
    ...JEV_JUDGMENT_CONTRACT,
    completedAt: NOW,
    dependencies: buildJevPairDependencies(
      "C_ONLY",
      {
        gameId: candidateId,
        name: candidate.name,
        description: candidate.bggSource.description ?? undefined,
      },
      {
        gameId: ownedId,
        name: owned.name,
        description: owned.bggData?.description ?? undefined,
      },
    ),
  };
}

function wishlistCandidate(bggId: number): StagedWishlistCandidateSource {
  return {
    bggId,
    name: `Wishlist candidate ${bggId}`,
    bggSource: {
      observedAt: NOW,
      description: `Description ${bggId}`,
      mechanics: [`Mechanic ${bggId}`],
      categories: ["Strategy"],
      weight: 2.5,
      communityRating: 7,
      minPlayers: 2,
      maxPlayers: 4,
      bestPlayers: 3,
      playingTime: 60,
    },
  };
}

async function withCache(
  run: (cache: JevPairCache, directory: string) => void | Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "staged-similarity-proof-"));
  const cache = await createJevPairCache(directory);
  try {
    await run(cache, directory);
  } finally {
    cache.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function derivedArtifact(
  proof: ReturnType<ReturnType<typeof createPreparedSimilarity>["sealProof"]>,
  neighbors: readonly string[],
  score: number,
): StagedDerivedArtifact {
  return {
    semanticScoringInputProof: proof,
    output: {
      neighborIds: [...neighbors],
      predictedScore: score,
      predictionConfidence: "moderate",
      predictedBreakdown: [{ axisName: "Synthetic", rating: score, confidence: "moderate" }],
      redundancyAdjustment: score / 10,
      orderingScore: score - score / 10,
    },
  };
}

function withPenaltyEnabled(
  current: StagedSimilaritySources,
  enabled: boolean,
): StagedSimilaritySources {
  return {
    ...current,
    similaritySettings: captureSimilaritySettings(
      { ...DEFAULT_REDUNDANCY_SETTINGS, enabled },
      current.collection.semanticRedundancy.settings,
    ),
  };
}

function rankedFixtureOutput(
  prepared: ReturnType<typeof createPreparedSimilarity>,
  pairs: readonly { referenceId: string; pair: StagedSimilarityPair }[],
): Omit<StagedDerivedArtifact, "semanticScoringInputProof">["output"] {
  const ranked = pairs
    .map(({ referenceId, pair }) => ({ referenceId, similarity: prepared.similarity(pair) }))
    .filter((item): item is { referenceId: string; similarity: number } => item.similarity !== null)
    .sort((left, right) => right.similarity - left.similarity);
  const winner = ranked[0];
  const score = winner ? winner.similarity * 10 : null;
  const adjustment = winner ? winner.similarity / 10 : null;
  return {
    neighborIds: winner ? [winner.referenceId] : [],
    predictedScore: score,
    predictionConfidence: score === null ? null : "moderate",
    predictedBreakdown:
      score === null ? null : [{ axisName: "Synthetic", rating: score, confidence: "moderate" }],
    redundancyAdjustment: adjustment,
    orderingScore: score === null || adjustment === null ? null : score - adjustment,
  };
}

describe("staged source capture and prepared similarity proof", () => {
  test("rejects settings whose cached-note permission was not captured from source authority", () => {
    const current = sources({ notePermission: false });
    const unauthorizedOverride = {
      ...current.collection.semanticRedundancy.settings,
      cachedOwnerNoteUse: true,
    };
    const mismatched = {
      ...structuredClone(current),
      similaritySettings: captureSimilaritySettings(
        DEFAULT_REDUNDANCY_SETTINGS,
        unauthorizedOverride,
      ),
    };
    expect(() =>
      captureStagedSimilaritySources(mismatched, { readCurrent: () => mismatched }),
    ).toThrow("unavailable or incoherent");
  });

  test("freezes caller inputs and binds labels, prediction/common settings, permission, and examined availability", async () => {
    await withCache((cache) => {
      const initial = sources();
      const capture = captureStagedSimilaritySources(initial, { readCurrent: () => initial });
      const [a, b] = initial.collection.games;
      if (!a || !b) throw new Error("fixture requires two collection games");
      const pair = { domain: "collection", gameAId: a.id, gameBId: b.id } as const;

      const mutable = initial as unknown as {
        collection: { games: DurableGame[]; axes: unknown[] };
        tournament: { settings: { kFactorThreshold: number } };
        predictionSettings: { defaultK: number };
      };
      const mutableGame = mutable.collection.games[0];
      const firstMechanic = mutableGame?.bggData?.mechanics[0];
      if (!mutableGame || !firstMechanic) throw new Error("fixture game requires BGG mechanics");
      firstMechanic.name = "Mutated after capture";
      const mutableNote = mutableGame.ownerNote;
      if (mutableNote?.state === "present") mutableNote.text = "Mutated private note";
      mutableGame.ratings.personal = 1;
      mutable.collection.axes.push({ id: "axis-mutated", name: "Mutated label" });
      mutable.tournament.settings.kFactorThreshold = 99;
      mutable.predictionSettings.defaultK = 99;
      expect(capture.sources.collection.games[0]?.bggData?.mechanics[0]?.name).toBe("Drafting");
      const capturedNote = capture.sources.collection.games[0]?.ownerNote;
      expect(capturedNote?.state === "present" ? capturedNote.text : null).toBe(
        "Private note local-a",
      );
      expect(capture.sources.collection.games[0]?.ratings.personal).toBe(8);
      expect(capture.sources.collection.axes).toEqual([]);
      expect(capture.sources.tournament.settings.kFactorThreshold).toBe(15);
      expect(capture.sources.predictionSettings.defaultK).toBe(5);
      expect(Object.isFrozen(capture.sources.collection.games[0]?.bggData?.mechanics[0])).toBe(
        true,
      );

      const missingCapture = captureStagedSimilaritySources(initial, {
        readCurrent: () => initial,
      });
      const missing = createPreparedSimilarity({ capture: missingCapture, cache });
      missing.resolvePairs([pair]);
      const missingProof = missing.sealProof();
      cache.upsert(collectionRow(initial, a, b, "C_ONLY", "C", 0));
      const availableCapture = captureStagedSimilaritySources(initial, {
        readCurrent: () => initial,
      });
      const available = createPreparedSimilarity({ capture: availableCapture, cache });
      available.resolvePairs([pair]);
      const availableProof = available.sealProof();
      expect(available.evidence(pair)?.description).toMatchObject({ state: "available", value: 0 });
      expect(missingProof.examinedComponentsIdentity).not.toBe(
        availableProof.examinedComponentsIdentity,
      );
      expect(missingProof.identity).not.toBe(availableProof.identity);

      const noNotePermission = sources({ notePermission: false, ownerNoteWeight: 0 });
      const nondependentCapture = captureStagedSimilaritySources(noNotePermission, {
        readCurrent: () => noNotePermission,
      });
      const nondependent = createPreparedSimilarity({ capture: nondependentCapture, cache });
      const nondependentPair = {
        domain: "collection",
        gameAId: a.id,
        gameBId: b.id,
      } as const;
      nondependent.resolvePairs([nondependentPair]);
      const nondependentProof = nondependent.sealProof();
      const availableEvidence = available.evidence(pair)?.description;
      expect(nondependent.evidence(nondependentPair)?.description).toMatchObject({
        state: "available",
        value: 0,
        noteDependent: false,
      });
      const nondependentEvidence = nondependent.evidence(nondependentPair)?.description;
      expect(
        nondependentEvidence?.state === "available" ? nondependentEvidence.rowIdentity : null,
      ).toBe(availableEvidence?.state === "available" ? availableEvidence.rowIdentity : null);
      expect(nondependentProof.identity).not.toBe(availableProof.identity);

      const validShapeRow = collectionRow(initial, a, b, "C_ONLY", "C", 0);
      const invalidRow = {
        ...validShapeRow,
        dependencies: validShapeRow.dependencies.map((dependency, index) =>
          index === 0 ? { ...dependency, descriptionFingerprint: "f".repeat(64) } : dependency,
        ),
      };
      cache.upsert(invalidRow);
      const invalidCapture = captureStagedSimilaritySources(initial, {
        readCurrent: () => initial,
      });
      const invalid = createPreparedSimilarity({ capture: invalidCapture, cache });
      invalid.resolvePairs([pair]);
      const invalidProof = invalid.sealProof();
      expect(invalid.evidence(pair)?.description).toEqual({ state: "invalid-row" });
      expect(invalidProof.examinedComponentsIdentity).not.toBe(
        availableProof.examinedComponentsIdentity,
      );

      const labelChange = structuredClone(initial);
      (labelChange.collection as unknown as { axes: unknown[] }).axes.push({
        id: "axis-actual",
        label: "New actual axis",
      });
      const labelIdentity = captureStagedSimilaritySources(labelChange, {
        readCurrent: () => labelChange,
      }).durableIdentity;
      expect(labelIdentity).not.toBe(capture.durableIdentity);

      const predictionChange = structuredClone(initial);
      (predictionChange.predictionSettings as { defaultK: number }).defaultK = 6;
      const predictionIdentity = captureStagedSimilaritySources(predictionChange, {
        readCurrent: () => predictionChange,
      }).durableIdentity;
      expect(predictionIdentity).not.toBe(capture.durableIdentity);

      const commonWeightChange = structuredClone(initial);
      const commonSettings = commonWeightChange.similaritySettings as {
        factual: { binary: number; continuous: number };
      };
      commonSettings.factual.binary = 1;
      commonSettings.factual.continuous = 2;
      commonWeightChange.sourceVector.redundancyWeightsFingerprint = canonicalSha256(
        commonSettings.factual,
      );
      const commonIdentity = captureStagedSimilaritySources(commonWeightChange, {
        readCurrent: () => commonWeightChange,
      }).durableIdentity;
      expect(commonIdentity).not.toBe(capture.durableIdentity);

      const permissionChange = sources({ notePermission: false, ownerNoteWeight: 0 });
      const permissionIdentity = captureStagedSimilaritySources(permissionChange, {
        readCurrent: () => permissionChange,
      }).durableIdentity;
      expect(permissionIdentity).not.toBe(capture.durableIdentity);
    });
  });

  test("uses indexed point reads once per pair/signal, seals demands, and is durable across process epochs", async () => {
    await withCache(async (cache, directory) => {
      const initial = sources();
      let live = initial;
      const capture = captureStagedSimilaritySources(initial, { readCurrent: () => live });
      const [a, b] = initial.collection.games;
      if (!a || !b) throw new Error("fixture requires two collection games");
      cache.upsert(collectionRow(initial, a, b, "SHARED_CD", "C", 0));
      cache.upsert(collectionRow(initial, a, b, "SHARED_CD", "D", 0.8));
      const reads: string[] = [];
      const encodes: string[] = [];
      const pair: StagedSimilarityPair = { domain: "collection", gameAId: a.id, gameBId: b.id };
      const prepared = createPreparedSimilarity({
        capture,
        cache,
        observer: {
          onFactualContextBuilt: () => reads.push("context"),
          onCachePointRead: (_key, signal) => reads.push(signal),
          onVectorEncoded: (key) => encodes.push(key),
        },
      });
      prepared.resolvePairs([pair, { ...pair, gameAId: b.id, gameBId: a.id }]);
      expect(reads).toEqual(["context", "C", "D"]);
      expect(encodes).toHaveLength(2);
      expect(new Set(encodes).size).toBe(2);
      expect(prepared.evidence(pair)).toMatchObject({
        description: { state: "available", noteDependent: true, value: 0 },
        ownerNote: { state: "available", noteDependent: true, value: 0.8 },
      });
      expect(prepared.hasNoteDependentEvidence()).toBe(true);
      expect(() => createStagedSimilarityPublicationGuard(capture, prepared)).toThrow("sealed");
      const returnedEvidence = prepared.evidence(pair);
      const returnedDescription = returnedEvidence?.description;
      if (returnedDescription?.state !== "available") {
        throw new Error("fixture expects an available shared description judgment");
      }
      const mutableDescription = returnedDescription as { value: number; noteDependent: boolean };
      const similarityBeforeMutation = prepared.similarity(pair);
      expect(() => {
        mutableDescription.value = 0.75;
      }).toThrow();
      expect(() => {
        mutableDescription.noteDependent = false;
      }).toThrow();
      expect(prepared.similarity(pair)).toBe(similarityBeforeMutation);
      expect(prepared.evidence(pair)?.description).toMatchObject({
        state: "available",
        noteDependent: true,
        value: 0,
      });
      const proof = prepared.sealProof();
      expect(() => {
        (proof as { identity: string }).identity = "f".repeat(64);
      }).toThrow();
      expect(prepared.sealProof()).toBe(proof);
      expect(() => {
        mutableDescription.noteDependent = false;
      }).toThrow();
      expect(prepared.evidence(pair)?.description).toMatchObject({
        state: "available",
        noteDependent: true,
        value: 0,
      });
      expect(prepared.isCurrent()).toBe(true);
      expect(JSON.stringify(proof)).not.toContain("Private note local-a");
      const originalGuard = createStagedSimilarityPublicationGuard(capture, prepared);
      const oldArtifact = derivedArtifact(proof, ["note-ranked-neighbor"], 8.5);
      const artifactPath = join(directory, "staged-derived-artifact.json");
      await writeFile(artifactPath, JSON.stringify(oldArtifact));
      const oldArtifactText = await readFile(artifactPath, "utf8");
      expect(
        readStagedDerivedArtifact(oldArtifactText, proof, originalGuard)?.output.neighborIds,
      ).toEqual(["note-ranked-neighbor"]);
      expect(() =>
        prepared.resolvePairs([{ domain: "collection", gameAId: a.id, gameBId: "local-c" }]),
      ).toThrow("sealed");
      expect(() =>
        prepared.similarity({ domain: "collection", gameAId: a.id, gameBId: "local-c" }),
      ).toThrow("sealed");

      const restartedSources = sources({ processEpoch: "process-two", changeToken: 999 });
      const restartedCapture = captureStagedSimilaritySources(restartedSources, {
        readCurrent: () => restartedSources,
      });
      const restarted = createPreparedSimilarity({ capture: restartedCapture, cache });
      restarted.resolvePairs([pair]);
      expect(restarted.sealProof().identity).toBe(proof.identity);
      expect(restarted.isCurrent()).toBe(true);

      const [c] = initial.collection.games.slice(2);
      if (!c) throw new Error("fixture requires an unrelated collection member");
      cache.upsert(collectionRow(initial, a, c, "C_ONLY", "C", 0.3));
      const afterUnrelatedCacheChange = createPreparedSimilarity({
        capture: restartedCapture,
        cache,
      });
      afterUnrelatedCacheChange.resolvePairs([pair]);
      const recapturedProof = afterUnrelatedCacheChange.sealProof();
      expect(recapturedProof.identity).toBe(proof.identity);
      expect(prepared.isCurrent()).toBe(false);
      expect(readStagedDerivedArtifact(oldArtifactText, proof, originalGuard)).toBeNull();
      expect(
        originalGuard.publishIfCurrent(() => {
          throw new Error("stale cache capture must not publish");
        }),
      ).toBe(false);
      expect(reads).toEqual(["context", "C", "D"]);
      const recapturedGuard = createStagedSimilarityPublicationGuard(
        restartedCapture,
        afterUnrelatedCacheChange,
      );
      const recomputedOutput = rankedFixtureOutput(afterUnrelatedCacheChange, [
        { referenceId: b.id, pair },
      ]);
      const recomputedArtifact: StagedDerivedArtifact = {
        semanticScoringInputProof: recapturedProof,
        output: recomputedOutput,
      };
      await writeFile(artifactPath, JSON.stringify(recomputedArtifact));
      expect(
        readStagedDerivedArtifact(
          await readFile(artifactPath, "utf8"),
          recapturedProof,
          recapturedGuard,
        )?.output,
      ).toEqual(recomputedOutput);

      cache.upsert(collectionRow(initial, a, b, "SHARED_CD", "C", 0.9));
      const changedRow = createPreparedSimilarity({ capture: restartedCapture, cache });
      changedRow.resolvePairs([pair]);
      expect(changedRow.sealProof().identity).not.toBe(proof.identity);

      live = sources({ collectionRevision: 2, changeToken: 2 });
      expect(prepared.isCurrent()).toBe(false);
      expect(restarted.isCurrent()).toBe(false);
    });
  });

  test("keeps C_ONLY valid without note permission and marks SHARED_CD C note-dependent at O=0", async () => {
    await withCache((cache) => {
      const current = sources({ notePermission: false, ownerNoteWeight: 10 });
      const [a, b] = current.collection.games;
      if (!a || !b) throw new Error("fixture requires two collection games");
      cache.upsert(collectionRow(current, a, b, "C_ONLY", "C", 0));
      const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
      const prepared = createPreparedSimilarity({ capture, cache });
      const pair = { domain: "collection", gameAId: a.id, gameBId: b.id } as const;
      prepared.resolvePairs([pair]);
      expect(prepared.evidence(pair)).toMatchObject({
        description: { state: "available", noteDependent: false, value: 0 },
        ownerNote: { state: "not-requested" },
      });
      expect(prepared.hasNoteDependentEvidence()).toBe(false);

      const noteAllowed = sources({ notePermission: true, ownerNoteWeight: 0 });
      const [c, d] = noteAllowed.collection.games;
      if (!c || !d) throw new Error("fixture requires two collection games");
      cache.upsert(collectionRow(noteAllowed, c, d, "SHARED_CD", "C", 0.7));
      const secondCapture = captureStagedSimilaritySources(noteAllowed, {
        readCurrent: () => noteAllowed,
      });
      const shared = createPreparedSimilarity({ capture: secondCapture, cache });
      const sharedPair = { domain: "collection", gameAId: c.id, gameBId: d.id } as const;
      shared.resolvePairs([sharedPair]);
      expect(noteAllowed.similaritySettings.semantic.ownerNote).toBe(0);
      expect(shared.evidence(sharedPair)?.description).toMatchObject({
        state: "available",
        noteDependent: true,
      });
      expect(shared.evidence(sharedPair)?.ownerNote).toEqual({ state: "not-requested" });
      expect(shared.hasNoteDependentEvidence()).toBe(true);
    });
  });

  test("typed wishlist C_ONLY pairs use requested previously-owned local refs without D/SHARED reads", async () => {
    await withCache((cache) => {
      const candidate: StagedWishlistCandidateSource = {
        bggId: 9001,
        name: "Requested candidate",
        bggSource: {
          observedAt: NOW,
          description: "Candidate description",
          mechanics: ["Novel mechanic"],
          categories: ["Strategy"],
          weight: 3,
          communityRating: 7,
          minPlayers: 2,
          maxPlayers: 4,
          bestPlayers: 3,
          playingTime: 60,
        },
      };
      const current = sources({
        notePermission: false,
        games: [game("local-prev", { ownership: "previously-owned" }), game("local-other")],
        wishlistCandidates: [candidate],
      });
      const previous = current.collection.games[0];
      if (!previous) throw new Error("fixture requires a previously-owned local reference");
      cache.upsert(wishlistRow(current, candidate, previous, 0));
      const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
      const reads: JevSignal[] = [];
      const prepared = createPreparedSimilarity({
        capture,
        cache,
        observer: { onCachePointRead: (_key, signal) => reads.push(signal) },
      });
      const pair = {
        domain: "wishlist-candidate",
        candidateBggId: candidate.bggId,
        ownedGameId: previous.id,
      } as const;
      prepared.resolvePairs([pair]);
      expect(reads).toEqual(["C"]);
      expect(prepared.evidence(pair)).toMatchObject({
        description: { state: "available", value: 0, noteDependent: false },
        ownerNote: { state: "not-requested" },
      });
      expect(prepared.similarity(pair)).not.toBeNull();
      expect(prepared.hasNoteDependentEvidence()).toBe(false);
    });
  });

  test("indexes wishlist sources once and shares local factual vectors across pair domains", async () => {
    await withCache((cache) => {
      const candidateCount = 48;
      const candidates = Array.from({ length: candidateCount }, (_, index) =>
        wishlistCandidate(20_000 + index),
      );
      const current = sources({ wishlistCandidates: candidates });
      const localGames = current.collection.games;
      const [firstLocal, secondLocal] = localGames;
      const firstCandidate = candidates[0];
      if (!firstLocal || !secondLocal || !firstCandidate) {
        throw new Error("fixture requires collection refs and indexed candidates");
      }

      const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
      const indexed: number[] = [];
      const lookups: number[] = [];
      const encoded: string[] = [];
      let indexBuildCount = 0;
      let indexedCandidateCount = -1;
      const prepared = createPreparedSimilarity({
        capture,
        cache,
        observer: {
          onWishlistCandidateIndexed: (bggId) => indexed.push(bggId),
          onWishlistCandidateIndexBuilt: (count) => {
            indexBuildCount += 1;
            indexedCandidateCount = count;
          },
          onWishlistCandidateLookup: (bggId) => lookups.push(bggId),
          onVectorEncoded: (key) => encoded.push(key),
        },
      });
      const pairs: StagedSimilarityPair[] = candidates.flatMap((candidate) =>
        localGames.map((ownedGame) => ({
          domain: "wishlist-candidate" as const,
          candidateBggId: candidate.bggId,
          ownedGameId: ownedGame.id,
        })),
      );
      const collectionPair = {
        domain: "collection",
        gameAId: firstLocal.id,
        gameBId: secondLocal.id,
      } as const;
      prepared.resolvePairs([collectionPair, ...pairs]);

      expect(indexBuildCount).toBe(1);
      expect(indexedCandidateCount).toBe(candidateCount);
      expect(indexed).toHaveLength(candidateCount);
      expect(new Set(indexed).size).toBe(candidateCount);
      expect(lookups).toHaveLength(candidateCount * localGames.length);
      expect(new Set(lookups).size).toBe(candidateCount);
      expect(encoded).toHaveLength(candidateCount + localGames.length);
      expect(new Set(encoded).size).toBe(candidateCount + localGames.length);
      const localVectorKeys = encoded
        .map((key) => JSON.parse(key) as [string, string, string])
        .filter((parts) => parts[1] === "local-game");
      expect(localVectorKeys).toHaveLength(localGames.length);
      expect(new Set(localVectorKeys.map((parts) => parts[2]))).toEqual(
        new Set(localGames.map((ownedGame) => ownedGame.id)),
      );
      const firstCandidateVectorKey = JSON.stringify([
        current.collection.id,
        "wishlist-bgg-candidate",
        firstCandidate.bggId,
      ]);
      expect(encoded.filter((key) => key === firstCandidateVectorKey)).toHaveLength(1);
      expect(prepared.resolvedPairCount).toBe(pairs.length + 1);
    });
  });

  test("cache unavailability yields coherent F-only evidence; source authority still fences it", () => {
    const current = sources();
    const capture = captureStagedSimilaritySources(current, { readCurrent: () => current });
    const unreadableCache = {
      available: false,
      mutationRevision: () => null,
      lookup: () => {
        throw new Error("unreadable fixture cache");
      },
    };
    const prepared = createPreparedSimilarity({ capture, cache: unreadableCache });
    const [a, b] = current.collection.games;
    if (!a || !b) throw new Error("fixture requires two collection games");
    const pair = { domain: "collection", gameAId: a.id, gameBId: b.id } as const;
    prepared.resolvePairs([pair]);
    expect(prepared.evidence(pair)).toMatchObject({
      factual: "available",
      description: { state: "cache-unavailable" },
      ownerNote: { state: "cache-unavailable" },
    });
    expect(prepared.similarity(pair)).not.toBeNull();
    prepared.sealProof();
    expect(prepared.isCurrent()).toBe(true);

    const revisionlessCache = {
      available: true,
      mutationRevision: () => null,
      lookup: () => {
        throw new Error("revisionless cache must not be queried");
      },
    };
    const revisionless = createPreparedSimilarity({ capture, cache: revisionlessCache });
    revisionless.resolvePairs([pair]);
    expect(revisionless.similarity(pair)).not.toBeNull();
    revisionless.sealProof();
    expect(revisionless.isCurrent()).toBe(true);
  });

  test("v2 artifact reads and publication fail closed through revocation, cleanup failure, and restart", async () => {
    await withCache(async (cache, directory) => {
      const candidate: StagedWishlistCandidateSource = {
        bggId: 9002,
        name: "Synthetic wishlist candidate",
        bggSource: {
          observedAt: NOW,
          description: "Synthetic candidate description",
          mechanics: ["Drafting"],
          categories: ["Strategy"],
          weight: 2.5,
          communityRating: 7,
          minPlayers: 2,
          maxPlayers: 4,
          bestPlayers: 3,
          playingTime: 60,
        },
      };
      const initial = withPenaltyEnabled(
        sources({
          notePermission: true,
          ownerNoteWeight: 0,
          wishlistCandidates: [candidate],
        }),
        false,
      );
      let live = initial;
      const [a, b] = initial.collection.games;
      if (!a || !b) throw new Error("fixture requires two collection games");
      const collectionPair = { domain: "collection", gameAId: a.id, gameBId: b.id } as const;
      const wishlistPair = {
        domain: "wishlist-candidate",
        candidateBggId: candidate.bggId,
        ownedGameId: a.id,
      } as const;
      cache.upsert(collectionRow(initial, a, b, "SHARED_CD", "C", 0.95));
      cache.upsert(wishlistRow(initial, candidate, a, 0.4));

      const capture = captureStagedSimilaritySources(initial, { readCurrent: () => live });
      const prepared = createPreparedSimilarity({ capture, cache });
      prepared.resolvePairs([collectionPair, wishlistPair]);
      const proof = prepared.sealProof();
      const guard = createStagedSimilarityPublicationGuard(capture, prepared);
      expect(guard.requiresNoteFence).toBe(true);
      expect(prepared.hasNoteDependentEvidence()).toBe(true);
      expect(prepared.evidence(collectionPair)?.description).toMatchObject({
        state: "available",
        noteDependent: true,
      });
      expect(prepared.evidence(wishlistPair)?.description).toMatchObject({
        state: "available",
        noteDependent: false,
      });

      const publicationOrder: string[] = [];
      const publicationCapture = captureStagedSimilaritySources(initial, {
        readCurrent: () => {
          publicationOrder.push("authority-check");
          return live;
        },
      });
      const immediatePublication = createStagedSimilarityPublicationGuard(
        publicationCapture,
        prepared,
      );
      expect(
        immediatePublication.publishIfCurrent(() => {
          publicationOrder.push("publish");
        }),
      ).toBe(true);
      expect(publicationOrder).toEqual(["authority-check", "authority-check", "publish"]);

      // This fixture models a complete downstream artifact (owned neighbor selection feeding
      // wishlist ordering); it deliberately does not claim that production prediction is active.
      const oldArtifact = derivedArtifact(proof, ["note-derived-neighbor"], 8.7);
      const artifactPath = join(directory, "derived-profile-artifact.json");
      await writeFile(artifactPath, JSON.stringify(oldArtifact));
      const oldRaw = await readFile(artifactPath, "utf8");
      expect(readStagedDerivedArtifact(oldRaw, proof, guard)?.output).toEqual(oldArtifact.output);

      const revoked = withPenaltyEnabled(
        sources({
          notePermission: false,
          ownerNoteWeight: 0,
          collectionRevision: 2,
          changeToken: 2,
          processEpoch: "process-after-restart",
          wishlistCandidates: [candidate],
        }),
        false,
      );
      live = revoked;
      let published = false;
      expect(
        guard.publishIfCurrent(() => {
          published = true;
        }),
      ).toBe(false);
      expect(published).toBe(false);
      expect(mayRetainStagedNoteDependentOutput(guard)).toBe(false);

      // Best-effort cleanup fails; the durable file remains, but the actual staged read boundary
      // must deny it immediately, including after reopening the file below.
      try {
        throw new Error("simulated cleanup failure leaves old artifact on disk");
      } catch {
        expect(await readFile(artifactPath, "utf8")).toBe(oldRaw);
      }
      expect(
        readStagedDerivedArtifact(await readFile(artifactPath, "utf8"), proof, guard),
      ).toBeNull();

      const restartedCapture = captureStagedSimilaritySources(revoked, {
        readCurrent: () => revoked,
      });
      const restarted = createPreparedSimilarity({ capture: restartedCapture, cache });
      restarted.resolvePairs([collectionPair, wishlistPair]);
      const restartedProof = restarted.sealProof();
      const restartedGuard = createStagedSimilarityPublicationGuard(restartedCapture, restarted);
      expect(restarted.isCurrent()).toBe(true);
      expect(restartedGuard.requiresNoteFence).toBe(false);
      expect(restarted.evidence(collectionPair)?.description.state).not.toBe("available");
      expect(restarted.evidence(wishlistPair)?.description).toMatchObject({
        state: "available",
        noteDependent: false,
      });
      expect(restartedProof.identity).not.toBe(proof.identity);
      expect(
        readStagedDerivedArtifact(
          await readFile(artifactPath, "utf8"),
          restartedProof,
          restartedGuard,
        ),
      ).toBeNull();

      const recomputed = rankedFixtureOutput(restarted, [
        { referenceId: b.id, pair: collectionPair },
      ]);
      const wishlistScore = restarted.similarity(wishlistPair);
      const adjustment = wishlistScore === null ? null : wishlistScore / 10;
      const recomputedOutput = {
        ...recomputed,
        redundancyAdjustment: adjustment,
        orderingScore:
          recomputed.predictedScore === null || adjustment === null
            ? null
            : recomputed.predictedScore - adjustment,
      };
      const refreshedArtifact: StagedDerivedArtifact = {
        semanticScoringInputProof: restartedProof,
        output: recomputedOutput,
      };
      await writeFile(artifactPath, JSON.stringify(refreshedArtifact));
      const readableAfterFullRecompute = readStagedDerivedArtifact(
        await readFile(artifactPath, "utf8"),
        restartedProof,
        restartedGuard,
      );
      expect(readableAfterFullRecompute?.output.neighborIds).toEqual([b.id]);
      expect(readableAfterFullRecompute?.output.neighborIds).not.toEqual(
        oldArtifact.output.neighborIds,
      );
      expect(readableAfterFullRecompute?.output).toEqual(recomputedOutput);
      expect(restarted.similarity(collectionPair)).not.toBeNull();
    });
  });
});
