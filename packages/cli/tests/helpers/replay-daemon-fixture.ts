import { readFile, writeFile } from "node:fs/promises";
import {
  IntentionCommandSchema,
  IntentionMutationResultSchema,
  type AcceptedIntentionMutation,
  type IntentionCommandReceipt,
  type PlayIntention,
} from "@shelf-judge/shared";

interface PersistedState {
  intentions: PlayIntention[];
  resolutions: PlayIntention[];
  receipts: IntentionCommandReceipt[];
  mutationCount: number;
  requestCount: number;
  commandIdOnStderrBeforeRequest: boolean;
  acceptedAfterCommandIdObserved: boolean;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

const socketPath = requiredEnvironment("REPLAY_SOCKET_PATH");
const statePath = requiredEnvironment("REPLAY_STATE_PATH");
const cliStderrPath = requiredEnvironment("REPLAY_CLI_STDERR_PATH");
const dropAcceptedResponse = process.env.REPLAY_DROP_RESPONSE === "1";
const requireCommandIdBeforeRequest = process.env.REPLAY_REQUIRE_COMMAND_ID_BEFORE_REQUEST === "1";

async function loadState(): Promise<PersistedState> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as PersistedState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      intentions: [],
      resolutions: [],
      receipts: [],
      mutationCount: 0,
      requestCount: 0,
      commandIdOnStderrBeforeRequest: false,
      acceptedAfterCommandIdObserved: false,
    };
  }
}

async function commandIdOnCliStderr(): Promise<string | null> {
  const stderr = await readFile(cliStderrPath, "utf8");
  return stderr.match(/Command ID: ([0-9a-f-]{36})/i)?.[1] ?? null;
}

Bun.serve({
  unix: socketPath,
  async fetch(request) {
    // This must be the first request-handler operation: inspect bytes emitted by the real CLI process
    // before reading any request metadata or body.
    const commandIdAtRequestEntry = requireCommandIdBeforeRequest
      ? await commandIdOnCliStderr()
      : null;

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/help") {
      return Response.json({ name: "shelf", children: {} });
    }
    if (request.method !== "POST" || url.pathname !== "/api/games/game-1/intention") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      return Response.json({ error: "Invalid body" }, { status: 400 });
    }
    const command = IntentionCommandSchema.parse({ type: "create", gameId: "game-1", ...body });
    if (command.type !== "create")
      return Response.json({ error: "Wrong command" }, { status: 400 });

    const state = await loadState();
    state.requestCount += 1;
    const existing = state.receipts.find((receipt) => receipt.commandId === command.commandId);
    if (existing !== undefined) {
      await writeFile(statePath, JSON.stringify(state));
      return Response.json(existing.result);
    }

    state.commandIdOnStderrBeforeRequest =
      !requireCommandIdBeforeRequest || commandIdAtRequestEntry === command.commandId;
    state.acceptedAfterCommandIdObserved = state.commandIdOnStderrBeforeRequest;
    if (!state.acceptedAfterCommandIdObserved) {
      await writeFile(statePath, JSON.stringify(state));
      if (dropAcceptedResponse) setTimeout(() => process.exit(1), 10);
      return Response.json(
        { error: "Command ID was not on CLI stderr before request arrival" },
        { status: 500 },
      );
    }

    const intention: PlayIntention = {
      intentionId: "process-intention-1",
      gameId: command.gameId,
      kind: command.kind,
      baseline: {
        playCount: 0,
        evidenceSource: "manual",
        observedAt: "2026-08-28T10:00:00.000Z",
      },
      createdAt: "2026-08-28T10:01:00.000Z",
      version: 1,
      resolution: null,
    };
    const result: AcceptedIntentionMutation = {
      ok: true,
      commandId: command.commandId,
      intention,
      linkedOwnershipTransition: null,
    };
    IntentionMutationResultSchema.parse(result);
    state.intentions.push(intention);
    state.receipts.push({ commandId: command.commandId, request: command, result });
    state.mutationCount += 1;
    await writeFile(statePath, JSON.stringify(state));

    if (dropAcceptedResponse) {
      setTimeout(() => process.exit(0), 0);
      return new Promise<Response>(() => undefined);
    }
    return Response.json(result);
  },
});
