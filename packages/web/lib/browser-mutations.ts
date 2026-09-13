import {
  IntentionMutationErrorSchema,
  IntentionMutationResultSchema,
  intentionMutationResultMatchesCommand,
  ManualPlayCorrectionResponseSchema,
  OwnershipMutationResultSchema,
  PlayEvidenceMutationResultSchema,
  GameSchema,
  OwnerGameNoteMutationResultSchema,
  OwnerGameNoteReadResultSchema,
  OwnerGameNoteSetRequestSchema,
  OwnerGameNoteClearRequestSchema,
  type IntentionMutationError,
  type IntentionCommand,
  type IntentionMutationResult,
  type ManualPlayCorrectionResponse,
  type OwnershipMutationResult,
  type PlayEvidenceMutationResult,
  type PlayIntentionKind,
  type Game,
  type OwnerGameNoteClearRequest,
  type OwnerGameNoteMutationResult,
  type OwnerGameNoteReadResult,
  type OwnerGameNoteSetRequest,
} from "@shelf-judge/shared";
import { generateBrowserUuid } from "@/lib/browser-uuid";

export type BrowserFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`Daemon returned a non-JSON response (${response.status}).`);
  }
}

function incoherentResponse(operation: string): never {
  throw new Error(`Daemon returned a response for a different ${operation}.`);
}

function ownerNoteResultStatus(result: OwnerGameNoteMutationResult): number {
  if (result.ok) return 200;
  switch (result.error.code) {
    case "validation":
      return 400;
    case "game-not-found":
      return 404;
    case "stale-version":
    case "command-reuse":
      return 409;
    case "version-overflow":
      return 422;
    case "persistence-failure":
      return 500;
  }
}

function ownerNoteResultMatchesRequest(
  operation: "set" | "clear",
  gameId: string,
  request: OwnerGameNoteSetRequest | OwnerGameNoteClearRequest,
  result: OwnerGameNoteMutationResult,
): boolean {
  if (result.ok) {
    const expectedResultVersion = result.accepted.alreadyClear
      ? request.expectedVersion
      : request.expectedVersion + 1;
    return (
      Number.isSafeInteger(expectedResultVersion) &&
      result.accepted.operation === operation &&
      result.accepted.gameId === gameId &&
      result.accepted.commandId === request.commandId &&
      result.accepted.version === expectedResultVersion
    );
  }
  if (result.commandId !== request.commandId) return false;
  if (result.error.code === "game-not-found") return result.error.gameId === gameId;
  if (result.error.code === "stale-version") {
    return (
      result.error.gameId === gameId && result.error.expectedVersion === request.expectedVersion
    );
  }
  if (result.error.code === "command-reuse") {
    return result.error.commandId === request.commandId;
  }
  if (result.error.code === "persistence-failure") {
    return result.error.operation === `shelf.game.note.${operation}`;
  }
  return true;
}

export async function getOwnerGameNote(
  gameId: string,
  fetcher: BrowserFetch = fetch,
): Promise<OwnerGameNoteReadResult> {
  const response = await fetcher(`/api/daemon/games/${gameId}/note`);
  if (!response.ok) throw new Error(`Owner note read failed (${response.status}).`);
  const result = OwnerGameNoteReadResultSchema.parse(await responseJson(response));
  if (result.gameId !== gameId) incoherentResponse("owner note read");
  return result;
}

async function mutateOwnerGameNote(
  operation: "set" | "clear",
  gameId: string,
  request: OwnerGameNoteSetRequest | OwnerGameNoteClearRequest,
  fetcher: BrowserFetch,
): Promise<OwnerGameNoteMutationResult> {
  const parsedRequest =
    operation === "set"
      ? OwnerGameNoteSetRequestSchema.parse(request)
      : OwnerGameNoteClearRequestSchema.parse(request);
  const response = await fetcher(`/api/daemon/games/${gameId}/note`, {
    method: operation === "set" ? "PUT" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsedRequest),
  });
  const result = OwnerGameNoteMutationResultSchema.parse(await responseJson(response));
  if (response.status !== ownerNoteResultStatus(result)) {
    throw new Error("Daemon returned an incoherent owner note status.");
  }
  if (!ownerNoteResultMatchesRequest(operation, gameId, parsedRequest, result)) {
    incoherentResponse("owner note request");
  }
  return result;
}

export function setOwnerGameNote(
  gameId: string,
  request: OwnerGameNoteSetRequest,
  fetcher: BrowserFetch = fetch,
): Promise<OwnerGameNoteMutationResult> {
  return mutateOwnerGameNote("set", gameId, request, fetcher);
}

export function clearOwnerGameNote(
  gameId: string,
  request: OwnerGameNoteClearRequest,
  fetcher: BrowserFetch = fetch,
): Promise<OwnerGameNoteMutationResult> {
  return mutateOwnerGameNote("clear", gameId, request, fetcher);
}

export async function createIntention(
  gameId: string,
  kind: PlayIntentionKind,
  fetcher: BrowserFetch = fetch,
  createCommandId: () => string = generateBrowserUuid,
): Promise<IntentionMutationResult> {
  const command = {
    type: "create",
    commandId: createCommandId(),
    gameId,
    kind,
    expectedActiveIntention: "absent",
  } satisfies IntentionCommand;
  const response = await fetcher(`/api/daemon/games/${gameId}/intention`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commandId: command.commandId,
      kind,
      expectedActiveIntention: "absent",
    }),
  });
  const result = IntentionMutationResultSchema.parse(await responseJson(response));
  if (!intentionMutationResultMatchesCommand(command, result))
    incoherentResponse("intention request");
  return result;
}

export async function resolveIntention(
  gameId: string,
  intentionId: string,
  expectedVersion: number,
  resolution: "complete" | "retire",
  fetcher: BrowserFetch = fetch,
  createCommandId: () => string = generateBrowserUuid,
): Promise<IntentionMutationResult> {
  const command = {
    type: resolution,
    commandId: createCommandId(),
    gameId,
    intentionId,
    expectedVersion,
  } satisfies IntentionCommand;
  const response = await fetcher(
    `/api/daemon/games/${gameId}/intention/${intentionId}/${resolution}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: command.commandId, expectedVersion }),
    },
  );
  const result = IntentionMutationResultSchema.parse(await responseJson(response));
  if (!intentionMutationResultMatchesCommand(command, result))
    incoherentResponse("intention request");
  return result;
}

export async function correctPlayCount(
  gameId: string,
  playCount: number,
  fetcher: BrowserFetch = fetch,
): Promise<ManualPlayCorrectionResponse> {
  const response = await fetcher(`/api/daemon/games/${gameId}/plays`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playCount }),
  });
  const result = ManualPlayCorrectionResponseSchema.parse(await responseJson(response));
  if ("ok" in result) {
    if (result.ok ? result.game.id !== gameId : result.error.gameId !== gameId) {
      incoherentResponse("play-count request");
    }
  }
  return result;
}

export async function changeOwnership(
  gameId: string,
  ownership: "owned" | "previously-owned",
  fetcher: BrowserFetch = fetch,
): Promise<OwnershipMutationResult> {
  const response = await fetcher(`/api/daemon/games/${gameId}/ownership`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownership }),
  });
  if (!response.ok) throw new Error(`Ownership update failed (${response.status}).`);
  const result = OwnershipMutationResultSchema.parse(await responseJson(response));
  if (result.game.id !== gameId || result.game.ownership !== ownership) {
    incoherentResponse("ownership request");
  }
  return result;
}

export async function refreshGameBgg(
  gameId: string,
  fetcher: BrowserFetch = fetch,
): Promise<PlayEvidenceMutationResult> {
  const response = await fetcher(`/api/daemon/games/${gameId}/refresh`, { method: "POST" });
  if (!response.ok) throw new Error(`BGG refresh failed (${response.status}).`);
  const result = PlayEvidenceMutationResultSchema.parse(await responseJson(response));
  if (result.game.id !== gameId) incoherentResponse("BGG refresh request");
  return result;
}

export async function setAdditionalBggIds(
  gameId: string,
  bggIds: number[],
  fetcher: BrowserFetch = fetch,
): Promise<Game> {
  const response = await fetcher(`/api/daemon/games/${gameId}/additional-bgg-ids`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bggIds }),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Additional BGG ID update failed (${response.status}).`;
    throw new Error(message);
  }
  if (typeof body !== "object" || body === null || !("game" in body)) {
    throw new Error("Daemon returned an invalid additional BGG ID response.");
  }
  const game = GameSchema.parse(body.game);
  if (
    game.id !== gameId ||
    JSON.stringify(game.additionalBggIds ?? []) !== JSON.stringify(bggIds)
  ) {
    incoherentResponse("additional BGG ID request");
  }
  return game;
}

export type RemoveGameResult = { ok: true } | { ok: false; error: IntentionMutationError };

export async function removeGameFromCollection(
  gameId: string,
  fetcher: BrowserFetch = fetch,
): Promise<RemoveGameResult> {
  const response = await fetcher(`/api/daemon/games/${gameId}`, { method: "DELETE" });
  if (response.status === 204) return { ok: true };
  const body = await responseJson(response);
  const conflict = IntentionMutationErrorSchema.safeParse(body);
  if (response.status === 409 && conflict.success && conflict.data.code === "history-conflict") {
    if (conflict.data.gameId !== gameId) incoherentResponse("game removal request");
    return { ok: false, error: conflict.data };
  }
  throw new Error(`Game removal failed (${response.status}).`);
}
