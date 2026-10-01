import type { Collection, DurableGame } from "@shelf-judge/shared";
import type { JevPairJudgment, JevPairKey } from "./jev-pair-cache-service.js";
import type { JevDependencyKind, JevSignal } from "./jev-pair-cache-service.js";
import { buildJevPairDependencies, type JevPairSource } from "./jev-pair-identity.js";
import { jevRunPairSourcesChanged, type JevRunPair, type JevRunScope } from "./jev-run-scope.js";
import { validateJevCachedRow } from "./jev-pair-read-proof.js";
import { JEV_JUDGMENT_CONTRACT } from "./jev/jev-judgment-contract.js";
import type { JevPairRequest, JevPairResult, JevScoreResult } from "./jev/jev-gateway.js";

export interface JevRunPairCacheReader {
  lookup(key: JevPairKey): JevPairJudgment | null;
}

export type JevPairPreparation =
  | {
      status: "skip";
      reason: "invalid-pair" | "stale-source" | "no-required-signal" | "both-cached";
    }
  | { status: "blocked"; reason: "note-use-not-permitted" }
  | { status: "unavailable"; reason: "missing-source" }
  | {
      status: "ready";
      request: JevPairRequest;
      dependencyKind: JevDependencyKind;
      signals: readonly JevSignal[];
      gameAId: string;
      gameBId: string;
      collectionId: string;
      consentEpoch?: string;
      dependencies: JevPairJudgment["dependencies"];
      contract: typeof JEV_JUDGMENT_CONTRACT;
    };

export interface JevPairRunOptions {
  plannedPair: JevRunPair;
  scope: JevRunScope;
  collection: Collection;
  cache: JevRunPairCacheReader;
  noteTransmissionAuthorized: boolean;
  contract?: typeof JEV_JUDGMENT_CONTRACT;
}

function hasDescription(
  game: DurableGame,
): game is DurableGame & { bggData: NonNullable<DurableGame["bggData"]> } {
  return (
    typeof game.bggData?.description === "string" && game.bggData.description.trim().length > 0
  );
}

function hasNote(
  game: DurableGame,
): game is DurableGame & { ownerNote: Extract<DurableGame["ownerNote"], { state: "present" }> } {
  return (
    game.ownerNote.state === "present" &&
    Number.isSafeInteger(game.ownerNote.version) &&
    game.ownerNote.version > 0 &&
    game.ownerNote.text.trim().length > 0
  );
}

function pairGames(collection: Collection, pair: JevRunPair): [DurableGame, DurableGame] | null {
  const byId = new Map(collection.games.map((game) => [game.id, game]));
  const a = byId.get(pair.gameAId);
  const b = byId.get(pair.gameBId);
  return a && b ? [a, b] : null;
}

/** Admits one planned pair and constructs the transient provider request, without invoking a provider. */
export function prepareJevRunPair(options: JevPairRunOptions): JevPairPreparation {
  const { plannedPair: pair, collection, scope, cache } = options;
  if (!pair.gameAId || !pair.gameBId || pair.gameAId >= pair.gameBId) {
    return { status: "skip", reason: "invalid-pair" };
  }
  const useDescription = pair.descriptionSignalRequired;
  const useNote = pair.ownerNoteSignalRequired;
  if (!useDescription && !useNote) {
    return pair.ownerNoteSignalBlocked
      ? { status: "blocked", reason: "note-use-not-permitted" }
      : { status: "skip", reason: "no-required-signal" };
  }
  const games = pairGames(collection, pair);
  if (!games) return { status: "skip", reason: "stale-source" };
  const [gameA, gameB] = games;

  const currentContract = options.contract ?? JEV_JUDGMENT_CONTRACT;
  const signalRows: JevSignal[] = [];
  if (useDescription) signalRows.push("C");
  if (useNote) signalRows.push("D");
  const valid = new Map<JevSignal, boolean>();
  for (const signal of signalRows) {
    valid.set(
      signal,
      validateJevCachedRow(
        cache.lookup({ gameAId: pair.gameAId, gameBId: pair.gameBId, signal }),
        collection,
        gameA,
        gameB,
        signal,
        currentContract,
      ).valid,
    );
  }
  const misses = signalRows.filter((signal) => !valid.get(signal));
  if (misses.length === 0) return { status: "skip", reason: "both-cached" };
  const plannedA = scope.sourceForGame(pair.gameAId);
  const plannedB = scope.sourceForGame(pair.gameBId);
  if (!plannedA || !plannedB) return { status: "skip", reason: "stale-source" };
  const canSendC =
    misses.includes("C") &&
    plannedA.descriptionPresent &&
    plannedB.descriptionPresent &&
    !jevRunPairSourcesChanged(scope, collection, pair.gameAId, pair.gameBId, "C_ONLY");
  const noteUsePermitted =
    options.noteTransmissionAuthorized &&
    collection.semanticRedundancy.settings.cachedOwnerNoteUse === true;
  const canSendD =
    misses.includes("D") &&
    plannedA.ownerNotePresent &&
    plannedB.ownerNotePresent &&
    noteUsePermitted &&
    !jevRunPairSourcesChanged(scope, collection, pair.gameAId, pair.gameBId, "D_ONLY");
  if (!canSendC && !canSendD) {
    if (misses.includes("D") && !noteUsePermitted) {
      return { status: "blocked", reason: "note-use-not-permitted" };
    }
    if (
      misses.includes("C") &&
      (plannedA.descriptionPresent || plannedB.descriptionPresent) &&
      jevRunPairSourcesChanged(scope, collection, pair.gameAId, pair.gameBId, "C_ONLY")
    ) {
      return { status: "skip", reason: "stale-source" };
    }
    if (
      misses.includes("D") &&
      (plannedA.ownerNotePresent || plannedB.ownerNotePresent) &&
      jevRunPairSourcesChanged(scope, collection, pair.gameAId, pair.gameBId, "D_ONLY")
    ) {
      return { status: "skip", reason: "stale-source" };
    }
    return { status: "unavailable", reason: "missing-source" };
  }
  const selectedSignals: JevSignal[] = canSendC && canSendD ? ["C", "D"] : canSendC ? ["C"] : ["D"];
  const dependencyKind: JevDependencyKind =
    selectedSignals.length === 2 ? "SHARED_CD" : selectedSignals[0] === "C" ? "C_ONLY" : "D_ONLY";
  const sendsNotes = selectedSignals.includes("D");
  if (jevRunPairSourcesChanged(scope, collection, pair.gameAId, pair.gameBId, dependencyKind)) {
    return { status: "skip", reason: "stale-source" };
  }
  const sendsDescription = selectedSignals.includes("C");
  if (
    (sendsDescription && (!hasDescription(gameA) || !hasDescription(gameB))) ||
    (sendsNotes && (!hasNote(gameA) || !hasNote(gameB)))
  ) {
    return { status: "unavailable", reason: "missing-source" };
  }

  const sourceFor = (game: DurableGame): JevPairSource => ({
    gameId: game.id,
    name: game.name,
    ...(sendsDescription ? { description: game.bggData?.description ?? undefined } : {}),
    ...(sendsNotes && hasNote(game)
      ? { note: { text: game.ownerNote.text, version: String(game.ownerNote.version) } }
      : {}),
  });
  const sources = [sourceFor(gameA), sourceFor(gameB)] as const;
  const dependencies = buildJevPairDependencies(dependencyKind, sources[0], sources[1]);
  const request: JevPairRequest =
    selectedSignals.includes("C") && selectedSignals.includes("D")
      ? {
          mode: "description-and-owner-notes",
          gameA: {
            name: gameA.name,
            bggDescription: gameA.bggData?.description ?? "",
            ownerNote: hasNote(gameA) ? gameA.ownerNote.text : "",
          },
          gameB: {
            name: gameB.name,
            bggDescription: gameB.bggData?.description ?? "",
            ownerNote: hasNote(gameB) ? gameB.ownerNote.text : "",
          },
        }
      : selectedSignals.includes("C")
        ? {
            mode: "description-only",
            gameA: { name: gameA.name, bggDescription: gameA.bggData?.description ?? "" },
            gameB: { name: gameB.name, bggDescription: gameB.bggData?.description ?? "" },
          }
        : {
            mode: "owner-notes-only",
            gameA: { name: gameA.name, ownerNote: hasNote(gameA) ? gameA.ownerNote.text : "" },
            gameB: { name: gameB.name, ownerNote: hasNote(gameB) ? gameB.ownerNote.text : "" },
          };
  return {
    status: "ready",
    request,
    dependencyKind,
    signals: selectedSignals,
    gameAId: pair.gameAId,
    gameBId: pair.gameBId,
    collectionId: collection.id,
    ...(sendsNotes
      ? {
          consentEpoch: String(
            collection.semanticRedundancy.ownerNoteConsentEpoch ??
              collection.semanticRedundancy.consentEpoch,
          ),
        }
      : {}),
    dependencies,
    contract: currentContract,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function validScore(
  score: unknown,
  contract: typeof JEV_JUDGMENT_CONTRACT,
): score is JevScoreResult {
  if (
    !isRecord(score) ||
    !hasExactKeys(score, ["score", "confidence", "modelId", "rubricVersion", "questionVersion"])
  )
    return false;
  return (
    typeof score.score === "number" &&
    Number.isFinite(score.score) &&
    score.score >= 0 &&
    score.score <= 1 &&
    (score.confidence === null ||
      (typeof score.confidence === "number" &&
        Number.isFinite(score.confidence) &&
        score.confidence >= 0 &&
        score.confidence <= 1)) &&
    typeof score.modelId === "string" &&
    score.modelId === contract.modelId &&
    String(score.rubricVersion) === contract.rubricVersion &&
    String(score.questionVersion) === contract.questionVersion
  );
}

/** Converts a complete provider result to cache-safe rows; malformed or partial results are rejected atomically. */
export function mapJevPairResult(
  admission: Extract<JevPairPreparation, { status: "ready" }>,
  result: JevPairResult,
  completedAt: string,
): JevPairJudgment[] | null {
  const contract = admission.contract;
  const expectsC = admission.signals.includes("C");
  const expectsD = admission.signals.includes("D");
  const resultKeys = ["description", "ownerNote", "usage"];
  if (isRecord(result) && "stopReason" in result) resultKeys.push("stopReason");
  if (
    !isRecord(result) ||
    !hasExactKeys(result, resultKeys) ||
    ("stopReason" in result && result.stopReason !== "application-token-threshold") ||
    !isRecord(result.usage) ||
    !hasExactKeys(result.usage, ["inputTokens", "outputTokens"]) ||
    typeof result.usage.inputTokens !== "number" ||
    !Number.isFinite(result.usage.inputTokens) ||
    result.usage.inputTokens < 0 ||
    typeof result.usage.outputTokens !== "number" ||
    !Number.isFinite(result.usage.outputTokens) ||
    result.usage.outputTokens < 0 ||
    (expectsC ? !validScore(result.description, contract) : result.description !== null) ||
    (expectsD ? !validScore(result.ownerNote, contract) : result.ownerNote !== null) ||
    !completedAt.trim()
  )
    return null;
  const rows: JevPairJudgment[] = [];
  for (const signal of admission.signals) {
    const score = signal === "C" ? result.description : result.ownerNote;
    if (!score) return null;
    rows.push({
      collectionId: admission.collectionId,
      ...(admission.consentEpoch === undefined ? {} : { consentEpoch: admission.consentEpoch }),
      gameAId: admission.gameAId,
      gameBId: admission.gameBId,
      signal,
      dependencyKind: admission.dependencyKind,
      value: score.score,
      ...(score.confidence === null ? {} : { confidence: score.confidence }),
      modelId: contract.modelId,
      rubricVersion: contract.rubricVersion,
      questionVersion: contract.questionVersion,
      requestSchemaVersion: contract.requestSchemaVersion,
      scoreMappingVersion: contract.scoreMappingVersion,
      semanticPolicyId: contract.semanticPolicyId,
      completedAt,
      dependencies: admission.dependencies.map((dependency) => ({ ...dependency })),
    });
  }
  return rows;
}
