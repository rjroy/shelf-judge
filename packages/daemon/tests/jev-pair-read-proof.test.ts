import { describe, expect, test } from "bun:test";
import { JEV_JUDGMENT_CONTRACT } from "../src/services/jev/jev-judgment-contract.js";
import { buildJevPairDependencies } from "../src/services/jev-pair-identity.js";
import type {
  JevDependencyKind,
  JevPairJudgment,
  JevSignal,
} from "../src/services/jev-pair-cache-service.js";
import {
  validateJevCachedRow,
  type JevRowValidationCollection,
  type JevRowValidationGame,
} from "../src/services/jev-pair-read-proof.js";

const collection: JevRowValidationCollection = {
  id: "collection-1",
  semanticRedundancy: { settings: { cachedOwnerNoteUse: true }, consentEpoch: 7 },
};

function game(id: string): JevRowValidationGame {
  return {
    id,
    name: `${id} game`,
    bggData: { description: `${id} description` },
    ownerNote: { state: "present", version: 3, text: `${id} note` },
  };
}

const a = game("game-a");
const b = game("game-b");

function judgment(kind: JevDependencyKind = "SHARED_CD", signal: JevSignal = "C"): JevPairJudgment {
  const sourceFor = (item: JevRowValidationGame) => ({
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
  return {
    collectionId: collection.id,
    ...(kind === "C_ONLY"
      ? {}
      : { consentEpoch: String(collection.semanticRedundancy.consentEpoch) }),
    gameAId: a.id,
    gameBId: b.id,
    signal,
    dependencyKind: kind,
    value: 0.65,
    confidence: 0.8,
    ...JEV_JUDGMENT_CONTRACT,
    completedAt: "2026-09-30T00:00:00.000Z",
    dependencies: buildJevPairDependencies(kind, sourceFor(a), sourceFor(b)),
  };
}

const verify = (
  row: JevPairJudgment,
  currentCollection = collection,
  gameA = a,
  gameB = b,
  signal: JevSignal = row.signal,
) => validateJevCachedRow(row, currentCollection, gameA, gameB, signal);

describe("validateJevCachedRow", () => {
  test("accepts a current row and gives an identity bound to value and dependencies", () => {
    const row = judgment();
    const accepted = verify(row);
    expect(accepted).toMatchObject({ valid: true, value: 0.65 });
    expect(verify({ ...row, value: 0.66 })).not.toEqual(accepted);
    expect(
      verify({
        ...row,
        dependencies: judgment("SHARED_CD").dependencies.map((dep) => ({
          ...dep,
          noteVersion: "4",
        })),
      }),
    ).toMatchObject({ valid: false, reason: "invalid-row" });
  });

  test("rejects changed name, description, note text, note version, and all shared sources", () => {
    const row = judgment();
    expect(verify(row, collection, { ...a, name: "Renamed" })).toMatchObject({
      valid: false,
      reason: "invalid-row",
    });
    expect(
      verify(row, collection, { ...a, bggData: { description: "Changed description" } }),
    ).toMatchObject({ valid: false, reason: "invalid-row" });
    expect(
      verify(row, collection, {
        ...a,
        ownerNote: { state: "present", version: a.ownerNote.version, text: "Changed note" },
      }),
    ).toMatchObject({ valid: false, reason: "invalid-row" });
    expect(
      verify(row, collection, {
        ...a,
        ownerNote: {
          state: "present",
          version: 4,
          text: a.ownerNote.state === "present" ? a.ownerNote.text : "",
        },
      }),
    ).toMatchObject({ valid: false, reason: "invalid-row" });
  });

  test("enforces owner-note permission and exact consent epoch, but does not gate C-only rows", () => {
    const noteRow = judgment("D_ONLY", "D");
    expect(
      verify(noteRow, {
        ...collection,
        semanticRedundancy: {
          ...collection.semanticRedundancy,
          settings: { cachedOwnerNoteUse: false },
        },
      }),
    ).toMatchObject({ valid: false, reason: "invalid-row" });
    expect(
      verify(noteRow, {
        ...collection,
        semanticRedundancy: { ...collection.semanticRedundancy, consentEpoch: 8 },
      }),
    ).toMatchObject({ valid: false, reason: "invalid-row" });
    expect(verify(noteRow)).toMatchObject({ valid: true });

    const cRow = judgment("C_ONLY", "C");
    const revoked = {
      ...collection,
      semanticRedundancy: { settings: { cachedOwnerNoteUse: false }, consentEpoch: 8 },
    };
    expect(verify(cRow, revoked)).toMatchObject({ valid: true });
  });

  test("rejects missing required source separately from a missing row", () => {
    expect(validateJevCachedRow(null, collection, a, b, "C")).toEqual({
      valid: false,
      reason: "missing-row",
    });
    expect(
      verify(judgment(), collection, { ...a, ownerNote: { state: "missing", version: 0 } }),
    ).toMatchObject({ valid: false, reason: "missing-source" });
    expect(verify(judgment("C_ONLY", "C"), collection, { ...a, bggData: null })).toMatchObject({
      valid: false,
      reason: "missing-source",
    });
  });

  test("ignores malformed independent sources but requires every source for shared rows", () => {
    const cRow = judgment("C_ONLY", "C");
    const noOwnerNote = { ...a, ownerNote: { state: "missing" as const, version: 0 } };
    expect(verify(cRow, collection, noOwnerNote)).toMatchObject({ valid: true });
    expect(verify(judgment(), collection, noOwnerNote)).toMatchObject({
      valid: false,
      reason: "missing-source",
    });

    const dRow = judgment("D_ONLY", "D");
    const noDescription = { ...a, bggData: null };
    expect(verify(dRow, collection, noDescription)).toMatchObject({ valid: true });
    expect(verify(judgment("SHARED_CD", "D"), collection, noDescription)).toMatchObject({
      valid: false,
      reason: "missing-source",
    });
  });

  test("rejects wrong collection, pair, signal, malformed numeric values, and each contract mismatch", () => {
    const row = judgment();
    expect(verify({ ...row, collectionId: "other" })).toMatchObject({
      valid: false,
      reason: "invalid-row",
    });
    expect(verify({ ...row, gameAId: "wrong" })).toMatchObject({
      valid: false,
      reason: "invalid-row",
    });
    expect(verify(row, collection, a, b, "D")).toMatchObject({
      valid: false,
      reason: "invalid-row",
    });
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      expect(verify({ ...row, value })).toMatchObject({ valid: false, reason: "invalid-row" });
    }
    expect(verify({ ...row, confidence: Number.NaN })).toMatchObject({
      valid: false,
      reason: "invalid-row",
    });
    for (const field of [
      "modelId",
      "rubricVersion",
      "questionVersion",
      "requestSchemaVersion",
      "scoreMappingVersion",
      "semanticPolicyId",
    ] as const) {
      expect(verify({ ...row, [field]: "stale" })).toMatchObject({
        valid: false,
        reason: "invalid-row",
      });
    }
  });
});
