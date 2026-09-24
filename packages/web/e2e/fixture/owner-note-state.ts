import {
  OwnerGameNoteAcceptedMetadataSchema,
  OwnerGameNoteSchema,
  canonicalizeOwnerGameNoteRequest,
  type OwnerGameNote,
  type OwnerGameNoteAcceptedMetadata,
} from "@shelf-judge/shared";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export type NoteOperation = "set" | "clear";

interface NoteReceipt {
  operation: NoteOperation;
  gameId: string;
  expectedVersion: number;
  requestFingerprint: string;
  accepted: Omit<OwnerGameNoteAcceptedMetadata, "replayed">;
}

export interface OwnerNoteFixtureState {
  notes: Map<string, OwnerGameNote>;
  receipts: Map<string, NoteReceipt>;
  collectionRevision: number;
  failNextMutation: boolean;
  dropNextAcceptedResponse: boolean;
  delayNextMutation: boolean;
  releaseMutation: (() => void) | null;
  mutationBodies: Array<{
    method: string;
    gameId: string;
    body: Record<string, unknown>;
  }>;
  restartCount: number;
  deletionBlockers: Map<string, string[]>;
}

export function createOwnerNoteState(): OwnerNoteFixtureState {
  return {
    notes: new Map(),
    receipts: new Map(),
    collectionRevision: 1,
    failNextMutation: false,
    dropNextAcceptedResponse: false,
    delayNextMutation: false,
    releaseMutation: null,
    mutationBodies: [],
    restartCount: 0,
    deletionBlockers: new Map(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Invalid persisted ${label} keys`);
  }
}

export function persistOwnerNoteState(state: OwnerNoteFixtureState, path: string): void {
  writeFileSync(
    path,
    JSON.stringify({
      formatVersion: 1,
      notes: Array.from(state.notes),
      receipts: Array.from(state.receipts),
      collectionRevision: state.collectionRevision,
    }),
  );
}

export function reconstructOwnerNoteState(path: string): OwnerNoteFixtureState {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error("Invalid persisted owner note state");
  assertExactKeys(
    value,
    ["formatVersion", "notes", "receipts", "collectionRevision"],
    "owner note state",
  );
  if (value.formatVersion !== 1 || !Number.isSafeInteger(value.collectionRevision)) {
    throw new Error("Invalid persisted owner note state metadata");
  }
  if (!Array.isArray(value.notes) || !Array.isArray(value.receipts)) {
    throw new Error("Invalid persisted owner note state entries");
  }

  const reconstructed = createOwnerNoteState();
  reconstructed.collectionRevision = value.collectionRevision as number;
  for (const entry of value.notes) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
      throw new Error("Invalid persisted owner note entry");
    }
    const noteValue: unknown = entry[1];
    reconstructed.notes.set(entry[0], OwnerGameNoteSchema.parse(noteValue));
  }
  for (const entry of value.receipts) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
      throw new Error("Invalid persisted owner note receipt entry");
    }
    const receiptValue: unknown = entry[1];
    if (!isRecord(receiptValue)) throw new Error("Invalid persisted owner note receipt");
    assertExactKeys(
      receiptValue,
      ["operation", "gameId", "expectedVersion", "requestFingerprint", "accepted"],
      "owner note receipt",
    );
    if (
      (receiptValue.operation !== "set" && receiptValue.operation !== "clear") ||
      typeof receiptValue.gameId !== "string" ||
      !Number.isSafeInteger(receiptValue.expectedVersion) ||
      typeof receiptValue.requestFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(receiptValue.requestFingerprint)
    ) {
      throw new Error("Invalid persisted owner note receipt identity");
    }
    if (!isRecord(receiptValue.accepted)) throw new Error("Invalid persisted acceptance metadata");
    const accepted = OwnerGameNoteAcceptedMetadataSchema.parse({
      ...receiptValue.accepted,
      replayed: false,
    });
    reconstructed.receipts.set(entry[0], {
      operation: receiptValue.operation,
      gameId: receiptValue.gameId,
      expectedVersion: receiptValue.expectedVersion as number,
      requestFingerprint: receiptValue.requestFingerprint,
      accepted: {
        commandId: accepted.commandId,
        gameId: accepted.gameId,
        operation: accepted.operation,
        state: accepted.state,
        version: accepted.version,
        updatedAt: accepted.updatedAt,
        collectionRevision: accepted.collectionRevision,
        alreadyClear: accepted.alreadyClear,
      },
    });
  }
  return reconstructed;
}

export function ownerNote(state: OwnerNoteFixtureState, gameId: string): OwnerGameNote {
  return state.notes.get(gameId) ?? { state: "missing", version: 0, updatedAt: null };
}

export function noteRequestMatches(
  receipt: NoteReceipt,
  operation: NoteOperation,
  gameId: string,
  expectedVersion: number,
  text?: string,
): boolean {
  return (
    receipt.operation === operation &&
    receipt.gameId === gameId &&
    receipt.expectedVersion === expectedVersion &&
    receipt.requestFingerprint ===
      ownerNoteRequestFingerprint(operation, gameId, expectedVersion, text)
  );
}

export function ownerNoteRequestFingerprint(
  operation: NoteOperation,
  gameId: string,
  expectedVersion: number,
  text?: string,
): string {
  return createHash("sha256")
    .update(
      canonicalizeOwnerGameNoteRequest(
        operation === "set"
          ? {
              operation,
              commandId: "00000000-0000-4000-8000-000000000000",
              gameId,
              expectedVersion,
              text: text ?? "",
            }
          : {
              operation,
              commandId: "00000000-0000-4000-8000-000000000000",
              gameId,
              expectedVersion,
            },
      ),
    )
    .digest("hex");
}
