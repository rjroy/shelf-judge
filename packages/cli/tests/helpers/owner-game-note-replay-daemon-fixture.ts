import { readFile, writeFile } from "node:fs/promises";
import {
  OwnerGameNoteMutationResultSchema,
  OwnerGameNoteSetRequestSchema,
  canonicalizeOwnerGameNoteRequest,
  type OwnerGameNote,
  type OwnerGameNoteAcceptedMetadata,
  type OwnerGameNoteSetRequest,
} from "@shelf-judge/shared";

interface PersistedState {
  note: OwnerGameNote;
  collectionRevision: number;
  receipt: {
    commandId: string;
    canonicalRequest: string;
    accepted: Omit<OwnerGameNoteAcceptedMetadata, "replayed">;
  } | null;
  mutationCount: number;
  requestCount: number;
  commandIdOnStderrBeforeRequest: boolean;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

const socketPath = requiredEnvironment("NOTE_REPLAY_SOCKET_PATH");
const statePath = requiredEnvironment("NOTE_REPLAY_STATE_PATH");
const cliStderrPath = requiredEnvironment("NOTE_REPLAY_CLI_STDERR_PATH");
const dropAcceptedResponse = process.env.NOTE_REPLAY_DROP_RESPONSE === "1";
const requireCommandIdBeforeRequest =
  process.env.NOTE_REPLAY_REQUIRE_COMMAND_ID_BEFORE_REQUEST === "1";

async function loadState(): Promise<PersistedState> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as PersistedState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      note: { state: "missing", version: 0, updatedAt: null },
      collectionRevision: 0,
      receipt: null,
      mutationCount: 0,
      requestCount: 0,
      commandIdOnStderrBeforeRequest: false,
    };
  }
}

async function commandIdOnCliStderr(): Promise<string | null> {
  const stderr = await readFile(cliStderrPath, "utf8");
  return stderr.match(/Command ID: ([0-9a-f-]{36})/i)?.[1] ?? null;
}

function canonicalRequest(request: OwnerGameNoteSetRequest): string {
  return canonicalizeOwnerGameNoteRequest({ operation: "set", gameId: "game-1", ...request });
}

Bun.serve({
  unix: socketPath,
  async fetch(request) {
    const commandIdAtRequestEntry = requireCommandIdBeforeRequest
      ? await commandIdOnCliStderr()
      : null;
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/help") {
      return Response.json({ name: "shelf", children: {} });
    }
    if (request.method !== "PUT" || url.pathname !== "/api/games/game-1/note") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const noteRequest = OwnerGameNoteSetRequestSchema.parse(await request.json());
    const state = await loadState();
    state.requestCount += 1;
    const canonical = canonicalRequest(noteRequest);
    if (state.receipt !== null) {
      if (
        state.receipt.commandId !== noteRequest.commandId ||
        state.receipt.canonicalRequest !== canonical
      ) {
        return Response.json(
          {
            ok: false,
            commandId: noteRequest.commandId,
            error: { code: "command-reuse", commandId: noteRequest.commandId },
          },
          { status: 409 },
        );
      }
      await writeFile(statePath, JSON.stringify(state));
      return Response.json(
        OwnerGameNoteMutationResultSchema.parse({
          ok: true,
          accepted: { ...state.receipt.accepted, replayed: true },
        }),
      );
    }

    state.commandIdOnStderrBeforeRequest =
      !requireCommandIdBeforeRequest || commandIdAtRequestEntry === noteRequest.commandId;
    if (!state.commandIdOnStderrBeforeRequest) {
      await writeFile(statePath, JSON.stringify(state));
      return Response.json({ error: "Command ID was not printed before request" }, { status: 500 });
    }

    const updatedAt = "2026-08-30T12:00:00.000Z";
    state.note = { state: "present", version: 1, updatedAt, text: noteRequest.text };
    state.collectionRevision = 1;
    state.mutationCount += 1;
    state.receipt = {
      commandId: noteRequest.commandId,
      canonicalRequest: canonical,
      accepted: {
        commandId: noteRequest.commandId,
        gameId: "game-1",
        operation: "set",
        state: "present",
        version: 1,
        updatedAt,
        collectionRevision: 1,
        alreadyClear: false,
      },
    };
    await writeFile(statePath, JSON.stringify(state));

    const result = OwnerGameNoteMutationResultSchema.parse({
      ok: true,
      accepted: { ...state.receipt.accepted, replayed: false },
    });
    if (dropAcceptedResponse) {
      setTimeout(() => process.exit(0), 0);
      return new Promise<Response>(() => undefined);
    }
    return Response.json(result);
  },
});
