import { JEV_JUDGMENT_CONTRACT } from "./jev/jev-judgment-contract.js";
import { buildJevPairDependencies, type JevPairSource } from "./jev-pair-identity.js";
import { canonicalSha256 } from "./profile-source-coordinator.js";
import type {
  JevDependencyKind,
  JevPairDependency,
  JevPairJudgment,
  JevSignal,
} from "./jev-pair-cache-service.js";

export interface JevRowValidationCollection {
  id: string;
  semanticRedundancy: {
    settings: { cachedOwnerNoteUse: boolean };
    consentEpoch: number;
    ownerNoteConsentEpoch?: number;
  };
}

export interface JevRowValidationGame {
  id: string;
  name: string;
  bggData: { description: string | null } | null;
  ownerNote:
    | { state: "missing"; version: number }
    | { state: "cleared"; version: number }
    | { state: "present"; version: number; text: string };
}

export interface JevValidatedCachedRow {
  value: number;
  identity: string;
}

export type JevCachedRowValidation =
  | { valid: true; value: number; identity: string }
  | { valid: false; reason: "missing-row" | "missing-source" | "invalid-row" };

type JudgmentContract = typeof JEV_JUDGMENT_CONTRACT;

const DESCRIPTION_ONLY = "C_ONLY";
const NOTE_ONLY = "D_ONLY";
const SHARED = "SHARED_CD";
const MAX_NAME_CHARS = 200;
const MAX_SOURCE_CHARS = 12_000;

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function validSentText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim().length > 0
  );
}

function validGame(game: JevRowValidationGame, kind: JevDependencyKind): boolean {
  if (
    typeof game.id !== "string" ||
    game.id.length === 0 ||
    !validSentText(game.name, MAX_NAME_CHARS)
  ) {
    return false;
  }
  if (kind !== NOTE_ONLY) {
    if (
      game.bggData === null ||
      typeof game.bggData !== "object" ||
      !validSentText(game.bggData.description, MAX_SOURCE_CHARS)
    ) {
      return false;
    }
  }
  if (kind !== DESCRIPTION_ONLY) {
    return (
      game.ownerNote !== null &&
      typeof game.ownerNote === "object" &&
      game.ownerNote.state === "present" &&
      Number.isSafeInteger(game.ownerNote.version) &&
      game.ownerNote.version > 0 &&
      validSentText(game.ownerNote.text, MAX_SOURCE_CHARS)
    );
  }
  return true;
}

function dependenciesEqual(a: JevPairDependency[], b: JevPairDependency[]): boolean {
  const canonical = (items: JevPairDependency[]) =>
    [...items]
      .sort((left, right) => (left.gameId < right.gameId ? -1 : left.gameId > right.gameId ? 1 : 0))
      .map((item) => ({
        gameId: item.gameId,
        nameFingerprint: item.nameFingerprint,
        descriptionFingerprint: item.descriptionFingerprint ?? null,
        noteFingerprint: item.noteFingerprint ?? null,
        noteVersion: item.noteVersion ?? null,
      }));
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function rowIdentity(row: JevPairJudgment): string {
  const dependencies = [...row.dependencies].sort((a, b) =>
    a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0,
  );
  const identity = {
    collectionId: row.collectionId,
    pair: canonicalPair(row.gameAId, row.gameBId),
    signal: row.signal,
    dependencyKind: row.dependencyKind,
    value: row.value,
    confidence: row.confidence ?? null,
    modelId: row.modelId,
    rubricVersion: row.rubricVersion,
    questionVersion: row.questionVersion,
    requestSchemaVersion: row.requestSchemaVersion,
    scoreMappingVersion: row.scoreMappingVersion,
    semanticPolicyId: row.semanticPolicyId,
    consentEpoch: row.consentEpoch ?? null,
    dependencies,
  };
  return canonicalSha256(identity);
}

/** Proves that a cached numeric judgment still matches the exact current request source and contract. */
export function validateJevCachedRow(
  row: JevPairJudgment | null | undefined,
  collection: JevRowValidationCollection,
  gameA: JevRowValidationGame,
  gameB: JevRowValidationGame,
  signal: JevSignal,
  contract: JudgmentContract = JEV_JUDGMENT_CONTRACT,
): JevCachedRowValidation {
  if (row == null) return { valid: false, reason: "missing-row" };
  if (
    ![DESCRIPTION_ONLY, NOTE_ONLY, SHARED].includes(row.dependencyKind) ||
    !validGame(gameA, row.dependencyKind) ||
    !validGame(gameB, row.dependencyKind) ||
    gameA.id === gameB.id
  ) {
    return { valid: false, reason: "missing-source" };
  }
  const noteDependent = row.dependencyKind === NOTE_ONLY || row.dependencyKind === SHARED;
  const hasRequiredDescriptions =
    row.dependencyKind === NOTE_ONLY ||
    (gameA.bggData?.description !== null &&
      gameA.bggData?.description !== undefined &&
      gameB.bggData?.description !== null &&
      gameB.bggData?.description !== undefined);
  const hasRequiredNotes =
    !noteDependent || (gameA.ownerNote.state === "present" && gameB.ownerNote.state === "present");
  if (!hasRequiredDescriptions || !hasRequiredNotes) {
    return { valid: false, reason: "missing-source" };
  }

  if (
    typeof collection.id !== "string" ||
    !collection.id ||
    !collection.semanticRedundancy ||
    !collection.semanticRedundancy.settings ||
    !Number.isSafeInteger(collection.semanticRedundancy.consentEpoch) ||
    collection.semanticRedundancy.consentEpoch < 0 ||
    ![DESCRIPTION_ONLY, NOTE_ONLY, SHARED].includes(row.dependencyKind) ||
    (signal !== "C" && signal !== "D") ||
    (row.dependencyKind === DESCRIPTION_ONLY && signal !== "C") ||
    (row.dependencyKind === NOTE_ONLY && signal !== "D") ||
    (noteDependent && collection.semanticRedundancy.settings.cachedOwnerNoteUse !== true)
  )
    return { valid: false, reason: "invalid-row" };

  if (
    row.collectionId !== collection.id ||
    row.signal !== signal ||
    !(
      (row.gameAId === gameA.id && row.gameBId === gameB.id) ||
      (row.gameAId === gameB.id && row.gameBId === gameA.id)
    ) ||
    !Number.isFinite(row.value) ||
    row.value < 0 ||
    row.value > 1 ||
    (row.confidence !== undefined &&
      (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1)) ||
    row.modelId !== contract.modelId ||
    row.rubricVersion !== contract.rubricVersion ||
    row.questionVersion !== contract.questionVersion ||
    row.requestSchemaVersion !== contract.requestSchemaVersion ||
    row.scoreMappingVersion !== contract.scoreMappingVersion ||
    row.semanticPolicyId !== contract.semanticPolicyId ||
    (noteDependent &&
      row.consentEpoch !==
        String(
          collection.semanticRedundancy.ownerNoteConsentEpoch ??
            collection.semanticRedundancy.consentEpoch,
        ))
  )
    return { valid: false, reason: "invalid-row" };

  let expected: JevPairDependency[];
  try {
    const sourceFor = (game: JevRowValidationGame): JevPairSource => ({
      gameId: game.id,
      name: game.name,
      ...(row.dependencyKind !== NOTE_ONLY ? { description: game.bggData!.description! } : {}),
      ...(noteDependent
        ? {
            note: {
              text: (
                game.ownerNote as Extract<JevRowValidationGame["ownerNote"], { state: "present" }>
              ).text,
              version: String(game.ownerNote.version),
            },
          }
        : {}),
    });
    expected = buildJevPairDependencies(row.dependencyKind, sourceFor(gameA), sourceFor(gameB));
  } catch {
    return { valid: false, reason: "missing-source" };
  }
  if (
    !Array.isArray(row.dependencies) ||
    row.dependencies.length !== 2 ||
    !dependenciesEqual(row.dependencies, expected)
  ) {
    return { valid: false, reason: "invalid-row" };
  }
  return { valid: true, value: row.value, identity: rowIdentity(row) };
}
