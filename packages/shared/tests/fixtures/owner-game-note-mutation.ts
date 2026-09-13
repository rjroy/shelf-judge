import type { Game, OwnerGameNote, OwnerGameNoteCommandReceipt } from "../../src/index";

export const canonicalOwnerNoteCommandId = "44000000-0000-4000-8000-000000000001";
export const canonicalOwnerNoteFingerprint = "a".repeat(64);
export const canonicalOwnerNoteUpdatedAt = "2026-08-30T12:00:00.000Z";

export const missingOwnerNote: OwnerGameNote = {
  state: "missing",
  version: 0,
  updatedAt: null,
};

export const presentOwnerNote: OwnerGameNote = {
  state: "present",
  version: 1,
  updatedAt: canonicalOwnerNoteUpdatedAt,
  text: "Keep for larger groups.\nNeeds the right table.",
};

export const clearedOwnerNote: OwnerGameNote = {
  state: "cleared",
  version: 2,
  updatedAt: "2026-08-30T12:05:00.000Z",
};

export const canonicalOwnerNoteReceipt: OwnerGameNoteCommandReceipt = {
  receiptType: "owner-game-note",
  commandId: canonicalOwnerNoteCommandId,
  operation: "set",
  gameId: "game-1",
  expectedVersion: 0,
  requestFingerprint: canonicalOwnerNoteFingerprint,
  accepted: {
    commandId: canonicalOwnerNoteCommandId,
    gameId: "game-1",
    operation: "set",
    state: "present",
    version: 1,
    updatedAt: canonicalOwnerNoteUpdatedAt,
    collectionRevision: 2,
    alreadyClear: false,
  },
};

const unrefreshable = {
  state: "unrefreshable" as const,
  entities: [] as [],
  observedAt: null,
  refreshFailure: null,
  correctionDestination: null,
  explanation: "This game has no BGG ID, so Shelf Judge cannot refresh entity metadata." as const,
};

export const canonicalPublicGame: Game = {
  id: "game-1",
  bggId: null,
  additionalBggIds: [],
  name: "A Game",
  yearPublished: null,
  minPlayers: null,
  maxPlayers: null,
  bestPlayers: null,
  playingTime: null,
  imageUrl: null,
  bggData: null,
  numPlays: null,
  acquisition: { state: "unknown" },
  playCountEvidence: { status: "missing", source: "legacy-unknown", observedAt: null },
  durationEvidence: { status: "missing", source: "legacy-unknown", observedAt: null },
  playerRangeEvidence: { status: "missing", source: "legacy-unknown", observedAt: null },
  suggestedPlayerPoll: {
    status: "valid",
    state: "legacy-unknown",
    buckets: [],
    source: "legacy-unknown",
    observedAt: null,
  },
  bestPlayersInvalidEvidence: null,
  manualValues: { playingTime: null, playerCount: null },
  entityMetadata: {
    mechanic: structuredClone(unrefreshable),
    designer: structuredClone(unrefreshable),
    artist: structuredClone(unrefreshable),
  },
  latestPlayCountCheck: null,
  ownership: "owned",
  boxDimensions: null,
  manualShelfId: null,
  ratings: {},
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
};
