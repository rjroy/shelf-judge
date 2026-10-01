import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collection, DurableGame } from "@shelf-judge/shared";
import {
  createInitialEntityMetadata,
  createInitialSemanticRedundancyStateV10,
} from "@shelf-judge/shared";
import { JEV_JUDGMENT_CONTRACT } from "../../src/services/jev/jev-judgment-contract.js";
import {
  createJevPairCache,
  type JevPairJudgment,
  type JevSignal,
} from "../../src/services/jev-pair-cache-service.js";
import { buildJevPairDependencies } from "../../src/services/jev-pair-identity.js";
import { validateJevCachedRow } from "../../src/services/jev-pair-read-proof.js";
import { mapJevPairResult, prepareJevRunPair } from "../../src/services/jev-run-pair.js";
import type { JevRunScope } from "../../src/services/jev-run-scope.js";

const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function game(
  id: string,
  description: string | null = `description-${id}`,
  noteText = `private-note-${id}`,
): DurableGame {
  return {
    id,
    bggId: null,
    name: `Game ${id}`,
    yearPublished: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    bestPlayers: null,
    playingTime: 60,
    imageUrl: null,
    bggData: {
      communityRating: 5,
      bayesAverage: 5,
      weight: null,
      numWeightVotes: 0,
      description,
      mechanics: [],
      categories: [],
      families: [],
      subdomains: [],
      bestPlayerCount: null,
      fetchedAt: "2026-01-01T00:00:00Z",
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
    entityMetadata: createInitialEntityMetadata(null),
    latestPlayCountCheck: null,
    ownership: "owned",
    boxDimensions: null,
    manualShelfId: null,
    ratings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ownerNote: { state: "present", version: 1, updatedAt: "2026-01-01T00:00:00Z", text: noteText },
  };
}

function setup(games = [game("a"), game("b")]) {
  const initial = createInitialSemanticRedundancyStateV10();
  const collection = {
    id: "collection",
    name: "test",
    schemaVersion: 10,
    revision: 1,
    axes: [],
    games,
    intentions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    attentionDispositions: [],
    semanticRedundancy: {
      ...initial,
      settings: {
        enabled: true,
        weights: { factual: 0, description: 1, ownerNote: 1 },
        cachedOwnerNoteUse: true,
      },
      consentEpoch: 7,
    },
  } as unknown as Collection;
  const sources = new Map(
    games.map((g) => [
      g.id,
      {
        gameId: g.id,
        nameFingerprint: hash(g.name),
        descriptionPresent: typeof g.bggData?.description === "string",
        descriptionFingerprint:
          typeof g.bggData?.description === "string" ? hash(g.bggData.description) : null,
        ownerNotePresent:
          g.ownerNote.state === "present" &&
          Number.isSafeInteger(g.ownerNote.version) &&
          g.ownerNote.version > 0 &&
          g.ownerNote.text.trim().length > 0,
        ownerNoteFingerprint:
          g.ownerNote.state === "present" && g.ownerNote.text.trim().length > 0
            ? hash(g.ownerNote.text)
            : null,
        ownerNoteVersion:
          g.ownerNote.state === "present" && g.ownerNote.text.trim().length > 0
            ? g.ownerNote.version
            : null,
      },
    ]),
  );
  const scope: JevRunScope = {
    eligibleGameIds: games.map((g) => g.id),
    totalEligiblePairs: 1,
    descriptionBearingPairCount: 1,
    ownerNoteBearingPairCount: 1,
    ownerNoteSignalBlocked: false,
    cachedOwnerNoteUse: true,
    sourceForGame: (id) => sources.get(id),
    pairs: function* () {},
  };
  return { collection, scope, games };
}

function pair(descriptionSignalRequired = true, ownerNoteSignalRequired = true) {
  return {
    gameAId: "a",
    gameBId: "b",
    descriptionSignalRequired,
    ownerNoteSignalRequired,
    ownerNoteSignalBlocked: false,
  } as const;
}

function requiredGame(games: readonly DurableGame[], id: string): DurableGame {
  const found = games.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing fixture game ${id}`);
  return found;
}

function judgment(
  kind: "C_ONLY" | "D_ONLY" | "SHARED_CD",
  signal: JevSignal,
  a: DurableGame,
  b: DurableGame,
): JevPairJudgment {
  const includeDescription = kind !== "D_ONLY";
  const includeNote = kind !== "C_ONLY";
  const source = (g: DurableGame) => ({
    gameId: g.id,
    name: g.name,
    ...(includeDescription ? { description: g.bggData?.description ?? "" } : {}),
    ...(includeNote && g.ownerNote.state === "present"
      ? { note: { text: g.ownerNote.text, version: String(g.ownerNote.version) } }
      : {}),
  });
  return {
    collectionId: "collection",
    ...(includeNote ? { consentEpoch: "7" } : {}),
    gameAId: "a",
    gameBId: "b",
    signal,
    dependencyKind: kind,
    value: 0.4,
    modelId: JEV_JUDGMENT_CONTRACT.modelId,
    rubricVersion: JEV_JUDGMENT_CONTRACT.rubricVersion,
    questionVersion: JEV_JUDGMENT_CONTRACT.questionVersion,
    requestSchemaVersion: JEV_JUDGMENT_CONTRACT.requestSchemaVersion,
    scoreMappingVersion: JEV_JUDGMENT_CONTRACT.scoreMappingVersion,
    semanticPolicyId: JEV_JUDGMENT_CONTRACT.semanticPolicyId,
    completedAt: "2026-01-01T00:00:00Z",
    dependencies: buildJevPairDependencies(kind, source(a), source(b)),
  };
}

describe("prepareJevRunPair", () => {
  test("builds description-only requests without transmitting notes", () => {
    const { collection, scope } = setup();
    const result = prepareJevRunPair({
      plannedPair: pair(true, false),
      scope,
      collection,
      cache: { lookup: () => null },
      noteTransmissionAuthorized: false,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.dependencyKind).toBe("C_ONLY");
    expect(result.request).toEqual({
      mode: "description-only",
      gameA: { name: "Game a", bggDescription: "description-a" },
      gameB: { name: "Game b", bggDescription: "description-b" },
    });
    expect(JSON.stringify(result.request)).not.toContain("private-note");
  });

  test("requests only missing signals and omits unrelated source text", () => {
    const { collection, scope, games } = setup();
    const hit = judgment("C_ONLY", "C", requiredGame(games, "a"), requiredGame(games, "b"));
    const result = prepareJevRunPair({
      plannedPair: pair(),
      scope,
      collection,
      cache: { lookup: () => hit },
      noteTransmissionAuthorized: true,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.request).toEqual({
      mode: "owner-notes-only",
      gameA: { name: "Game a", ownerNote: "private-note-a" },
      gameB: { name: "Game b", ownerNote: "private-note-b" },
    });
    expect(result.signals).toEqual(["D"]);
    expect(JSON.stringify(result.request)).not.toContain("description-a");
    expect(JSON.stringify(result.dependencies)).not.toContain("private-note");
  });

  test("skips on two valid cache hits and rejects stale planned source", () => {
    const { collection, scope, games } = setup();
    const rows = [
      judgment("SHARED_CD", "C", requiredGame(games, "a"), requiredGame(games, "b")),
      judgment("SHARED_CD", "D", requiredGame(games, "a"), requiredGame(games, "b")),
    ];
    expect(
      prepareJevRunPair({
        plannedPair: pair(),
        scope,
        collection,
        cache: { lookup: ({ signal }) => rows.find((row) => row.signal === signal) ?? null },
        noteTransmissionAuthorized: true,
      }),
    ).toEqual({ status: "skip", reason: "both-cached" });
    expect(
      prepareJevRunPair({
        plannedPair: pair(),
        scope,
        collection,
        cache: { lookup: ({ signal }) => rows.find((row) => row.signal === signal) ?? null },
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: "skip", reason: "both-cached" });
    const changed = setup([game("a", "new description"), requiredGame(games, "b")]);
    expect(
      prepareJevRunPair({
        plannedPair: pair(true, false),
        scope,
        collection: changed.collection,
        cache: { lookup: () => null },
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: "skip", reason: "stale-source" });
  });

  test("blocks unauthorized note use; missing note source is unavailable", () => {
    const { collection, scope } = setup();
    expect(
      prepareJevRunPair({
        plannedPair: pair(false, true),
        scope,
        collection,
        cache: { lookup: () => null },
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: "blocked", reason: "note-use-not-permitted" });
    const missing = setup([game("a", null), game("b", null)]);
    expect(
      prepareJevRunPair({
        plannedPair: pair(true, false),
        scope: missing.scope,
        collection: missing.collection,
        cache: { lookup: () => null },
        noteTransmissionAuthorized: false,
      }),
    ).toEqual({ status: "unavailable", reason: "missing-source" });
    const missingNotes = setup([game("a", "description-a", ""), game("b", "description-b", "")]);
    expect(
      prepareJevRunPair({
        plannedPair: pair(false, true),
        scope: missingNotes.scope,
        collection: missingNotes.collection,
        cache: { lookup: () => null },
        noteTransmissionAuthorized: true,
      }),
    ).toEqual({ status: "unavailable", reason: "missing-source" });
  });

  test("rechecks current note permission, while a C-only miss ignores note edits and carries no consent epoch", async () => {
    const original = setup();
    const currentGames = [
      game("a", "description-a", "edited-private-note-a"),
      game("b", "description-b", "edited-private-note-b"),
    ];
    const changedCollection = { ...original.collection, games: currentGames };
    const cachedNoteRow = judgment(
      "D_ONLY",
      "D",
      requiredGame(currentGames, "a"),
      requiredGame(currentGames, "b"),
    );
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "jev-run-pair-"));
    const persistentCache = await createJevPairCache(temporaryDirectory);
    try {
      persistentCache.upsert(cachedNoteRow);
      const admission = prepareJevRunPair({
        plannedPair: pair(),
        scope: original.scope,
        collection: changedCollection,
        cache: { lookup: (key) => persistentCache.lookup(key) },
        noteTransmissionAuthorized: false,
      });
      expect(admission.status).toBe("ready");
      if (admission.status !== "ready") return;
      expect(admission.dependencyKind).toBe("C_ONLY");
      expect(admission.consentEpoch).toBeUndefined();
      expect(
        admission.dependencies.every((dependency) => dependency.noteFingerprint === undefined),
      ).toBe(true);

      const descriptionScore = {
        score: 0.5,
        confidence: null,
        modelId: JEV_JUDGMENT_CONTRACT.modelId,
        rubricVersion: 2 as const,
        questionVersion: 2 as const,
      };
      const [descriptionRow] =
        mapJevPairResult(
          admission,
          {
            description: descriptionScore,
            ownerNote: null,
            usage: { inputTokens: 1, outputTokens: 1 },
          },
          "2026-01-01T00:00:00Z",
        ) ?? [];
      expect(descriptionRow).toBeDefined();
      if (!descriptionRow) return;
      expect(
        validateJevCachedRow(
          descriptionRow,
          changedCollection,
          currentGames[0],
          currentGames[1],
          "C",
        ).valid,
      ).toBe(true);
      persistentCache.upsert(descriptionRow);
      expect(persistentCache.lookup({ gameAId: "a", gameBId: "b", signal: "C" })).toEqual(
        descriptionRow,
      );

      const revokedCollection = {
        ...changedCollection,
        semanticRedundancy: {
          ...changedCollection.semanticRedundancy,
          settings: { ...changedCollection.semanticRedundancy.settings, cachedOwnerNoteUse: false },
        },
      };
      expect(
        prepareJevRunPair({
          plannedPair: pair(false, true),
          scope: original.scope,
          collection: revokedCollection,
          cache: { lookup: () => null },
          noteTransmissionAuthorized: true,
        }),
      ).toEqual({ status: "blocked", reason: "note-use-not-permitted" });
      expect(
        prepareJevRunPair({
          plannedPair: pair(true, false),
          scope: original.scope,
          collection: revokedCollection,
          cache: { lookup: () => null },
          noteTransmissionAuthorized: false,
        }).status,
      ).toBe("ready");
    } finally {
      persistentCache.close();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("maps combined result to shared dependencies without storing source text; rejects partial or malformed results", () => {
    const { collection, scope } = setup();
    const admission = prepareJevRunPair({
      plannedPair: pair(),
      scope,
      collection,
      cache: { lookup: () => null },
      noteTransmissionAuthorized: true,
    });
    expect(admission.status).toBe("ready");
    if (admission.status !== "ready") return;
    const score = {
      score: 0.6,
      confidence: 0.2,
      modelId: JEV_JUDGMENT_CONTRACT.modelId,
      rubricVersion: 2 as const,
      questionVersion: 2 as const,
    };
    const complete = {
      description: score,
      ownerNote: score,
      usage: { inputTokens: 10, outputTokens: 3 },
    };
    const rows = mapJevPairResult(admission, complete, "2026-01-01T00:00:00Z");
    expect(rows).toHaveLength(2);
    expect(rows?.map((row) => row.dependencyKind)).toEqual(["SHARED_CD", "SHARED_CD"]);
    expect(JSON.stringify(rows)).not.toContain("private-note");
    expect(
      mapJevPairResult(admission, { ...complete, ownerNote: null }, "2026-01-01T00:00:00Z"),
    ).toBeNull();
    expect(
      mapJevPairResult(
        admission,
        { ...complete, description: { ...score, score: Number.NaN } },
        "2026-01-01T00:00:00Z",
      ),
    ).toBeNull();
  });
});
