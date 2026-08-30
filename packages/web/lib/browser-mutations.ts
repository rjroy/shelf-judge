import {
  IntentionMutationErrorSchema,
  IntentionMutationResultSchema,
  intentionMutationResultMatchesCommand,
  ManualPlayCorrectionResponseSchema,
  OwnershipMutationResultSchema,
  PlayEvidenceMutationResultSchema,
  GameSchema,
  type IntentionMutationError,
  type IntentionCommand,
  type IntentionMutationResult,
  type ManualPlayCorrectionResponse,
  type OwnershipMutationResult,
  type PlayEvidenceMutationResult,
  type PlayIntentionKind,
  type Game,
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
