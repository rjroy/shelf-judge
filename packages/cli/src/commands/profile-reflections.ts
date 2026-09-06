import {
  REFLECTION_QUESTION_IDS,
  ReflectionCancelRequestSchema,
  ReflectionGetResultSchema,
  ReflectionOperationResultSchema,
  ReflectionStreamEventSchema,
  type ReflectionGetResult,
  type ReflectionQuestionId,
  type ReflectionStreamEvent,
} from "@shelf-judge/shared";
import { createInterface } from "node:readline/promises";
import type { DaemonClient, SSEEvent } from "../client.js";
import { StructuredCliError } from "../errors.js";
import type { OutputOptions } from "../output.js";

const QUESTION_IDS = new Set<string>(REFLECTION_QUESTION_IDS);
const REFLECTION_PATH = "/api/profile/reflections";

class ReflectionCliError extends StructuredCliError {
  constructor(code: string, message: string) {
    super({ error: { code, message } });
    this.name = "ReflectionCliError";
  }
}

function usage(message: string): never {
  throw new ReflectionCliError("usage", message);
}

function requestId(): string {
  return crypto.randomUUID();
}

function cancellationCapability(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function questionId(value: string | undefined): ReflectionQuestionId {
  if (value === undefined || !QUESTION_IDS.has(value)) {
    usage(`Question ID must be one of: ${REFLECTION_QUESTION_IDS.join(", ")}`);
  }
  return value as ReflectionQuestionId;
}

function operationResult(value: unknown, expectedRequestId: string) {
  const parsed = ReflectionOperationResultSchema.safeParse(value);
  if (!parsed.success)
    throw new ReflectionCliError(
      "invalid-daemon-response",
      "Invalid Reflection operation response",
    );
  if (parsed.data.requestId !== expectedRequestId) {
    throw new ReflectionCliError(
      "invalid-daemon-response",
      "Reflection operation response did not match the request identity",
    );
  }
  return parsed.data;
}

function requireAccepted(value: unknown, expectedRequestId: string) {
  const result = operationResult(value, expectedRequestId);
  if (result.outcome !== "accepted") {
    throw new ReflectionCliError(
      "operation-rejected",
      `Reflection operation was not accepted: ${result.outcome}`,
    );
  }
  return result;
}

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await readline.question(`${prompt} [y/N] `)).trim().toLowerCase() === "y";
  } finally {
    readline.close();
  }
}

function formatQuestion(state: ReflectionGetResult["questions"][number]): string[] {
  const lines = [`${state.questionId}: ${state.enabled ? "enabled" : "disabled"}`];
  lines.push(`  Cache: ${state.cache.state}`);
  if (state.cache.state === "stale")
    lines.push(`  Changed: ${state.cache.changedCategories.join(", ")}`);
  if (state.cache.state !== "none") {
    const result = state.cache.result;
    lines.push(`  Outcome: ${result.outcome}`);
    if (result.outcome === "answered") lines.push(`  ${result.centralSynthesis.text}`);
    else lines.push(`  ${result.reason}: ${result.explanation}`);
    for (const citation of result.citations) {
      lines.push(
        `  [${citation.citationId}] ${citation.testimony ? "Owner testimony" : "Deterministic evidence"}: ${citation.canonicalSummary} (${citation.destination.operationId} ${JSON.stringify(citation.destination.parameters)})`,
      );
    }
  }
  lines.push(`  Attempt: ${state.attempt.state}`);
  if (state.attempt.state === "refreshing") lines.push(`  Refresh batch: ${state.attempt.batchId}`);
  if (state.attempt.state === "unavailable") lines.push(`  Unavailable: ${state.attempt.reason}`);
  if (state.attempt.state === "purged") lines.push(`  Purged: ${state.attempt.reason}`);
  return lines;
}

function formatRead(result: ReflectionGetResult): string {
  const lines = ["Optional profile reflections"];
  if (result.configuration.status === "configured") {
    lines.push(
      `Provider: ${result.configuration.identity.providerId} / ${result.configuration.identity.modelId}`,
    );
  } else {
    lines.push(`Provider unavailable: ${result.configuration.reason}`);
  }
  for (const state of result.questions) lines.push(...formatQuestion(state));
  return lines.join("\n");
}

function parseEvent(event: SSEEvent): ReflectionStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(event.data);
  } catch {
    throw new ReflectionCliError(
      "invalid-daemon-response",
      "Reflection stream emitted invalid JSON",
    );
  }
  const parsed = ReflectionStreamEventSchema.safeParse(value);
  if (!parsed.success || parsed.data.type !== event.event) {
    throw new ReflectionCliError(
      "invalid-daemon-response",
      `Reflection stream emitted an invalid ${event.event} event`,
    );
  }
  return parsed.data;
}

function formatEvent(event: ReflectionStreamEvent): string {
  switch (event.type) {
    case "accepted":
      return `Accepted batch ${event.batchId} for ${event.questionIds.join(", ")}`;
    case "question-started":
      return `Refreshing ${event.questionId}`;
    case "validated-result":
      return `${event.questionId}: ${event.result.outcome}`;
    case "question-completed":
      return `${event.questionId}: ${event.outcome}`;
    case "cancelled":
      return "Reflection refresh cancelled";
    case "failed":
      return `Reflection refresh failed: ${event.reason}`;
    default:
      return `${event.type}: ${event.questionId}`;
  }
}

export async function profileReflectionsCommand(
  client: DaemonClient,
  commandPath: string,
  args: string[],
  opts: OutputOptions,
): Promise<string | undefined> {
  if (commandPath === "profile reflections") {
    if (args.length > 0) usage("Usage: shelf-judge profile reflections [--json]");
    const response = await client.get<unknown>(REFLECTION_PATH);
    if (!response.ok)
      throw new ReflectionCliError(
        "operation-failed",
        `Reflection read failed with status ${response.status}`,
      );
    const parsed = ReflectionGetResultSchema.safeParse(response.data);
    if (!parsed.success)
      throw new ReflectionCliError("invalid-daemon-response", "Invalid Reflection response");
    return opts.json ? JSON.stringify(parsed.data) : formatRead(parsed.data);
  }

  if (
    commandPath === "profile reflections enable" ||
    commandPath === "profile reflections disable"
  ) {
    if (args.length !== 1) usage(`Usage: shelf-judge ${commandPath} <question-id> [--json]`);
    const id = questionId(args[0]);
    const idempotencyKey = requestId();
    const response = await client.put<unknown>(`${REFLECTION_PATH}/settings`, {
      requestId: idempotencyKey,
      questionId: id,
      enabled: commandPath.endsWith("enable"),
    });
    if (!response.ok)
      throw new ReflectionCliError(
        "operation-failed",
        `Reflection settings update failed with status ${response.status}`,
      );
    const result = requireAccepted(response.data, idempotencyKey);
    return opts.json
      ? JSON.stringify(result)
      : `${id} ${commandPath.endsWith("enable") ? "enabled" : "disabled"}`;
  }

  if (commandPath === "profile reflections cancel") {
    const capabilityIndex = args.indexOf("--capability");
    if (args.length !== 3 || capabilityIndex !== 1) {
      usage(
        "Usage: shelf-judge profile reflections cancel <batch-id> --capability <token> [--json]",
      );
    }
    const parsedRequest = ReflectionCancelRequestSchema.safeParse({
      batchId: args[0],
      capability: args[2],
    });
    if (!parsedRequest.success) {
      usage("Cancellation batch ID and capability must satisfy the Reflection contract");
    }
    const { batchId, capability } = parsedRequest.data;
    const response = await client.post<unknown>(`${REFLECTION_PATH}/cancel`, {
      batchId,
      capability,
    });
    if (!response.ok)
      throw new ReflectionCliError(
        "operation-failed",
        `Reflection cancellation failed with status ${response.status}`,
      );
    const result = requireAccepted(response.data, batchId);
    return opts.json ? JSON.stringify(result) : `Cancellation requested for batch ${batchId}`;
  }

  if (commandPath === "profile reflections delete") {
    const confirmed = args.length === 1 && args[0] === "--confirm";
    if (args.length > 0 && !confirmed)
      usage("Usage: shelf-judge profile reflections delete [--confirm] [--json]");
    if (!confirmed && !(await confirm("Delete all cached reflections?"))) {
      throw new ReflectionCliError(
        "confirmation-required",
        "Reflection deletion was not confirmed; use --confirm for noninteractive use",
      );
    }
    const idempotencyKey = requestId();
    const response = await client.del<unknown>(REFLECTION_PATH, {
      requestId: idempotencyKey,
      confirmed: true,
    });
    if (!response.ok)
      throw new ReflectionCliError(
        "operation-failed",
        `Reflection deletion failed with status ${response.status}`,
      );
    const result = requireAccepted(response.data, idempotencyKey);
    return opts.json ? JSON.stringify(result) : "Deleted all cached reflections";
  }

  if (commandPath !== "profile reflections refresh") usage("Unknown Reflection command");
  let selectedQuestion: ReflectionQuestionId | undefined;
  let acknowledged = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--question") selectedQuestion = questionId(args[++index]);
    else if (arg === "--acknowledge-disclosure") acknowledged = true;
    else
      usage(
        "Usage: shelf-judge profile reflections refresh [--question <id>] [--acknowledge-disclosure] [--json]",
      );
  }

  const read = await client.get<unknown>(REFLECTION_PATH);
  if (!read.ok)
    throw new ReflectionCliError(
      "operation-failed",
      `Reflection read failed with status ${read.status}`,
    );
  const parsedState = ReflectionGetResultSchema.safeParse(read.data);
  if (!parsedState.success)
    throw new ReflectionCliError("invalid-daemon-response", "Invalid Reflection response");
  const state = parsedState.data;
  if (state.configuration.status !== "configured") {
    throw new ReflectionCliError(
      "unavailable",
      `Reflection refresh unavailable: ${state.configuration.reason}`,
    );
  }
  const { providerId, modelId } = state.configuration.identity;
  const targetCount =
    selectedQuestion === undefined ? state.questions.filter(({ enabled }) => enabled).length : 1;
  const disclosure = [
    `Provider: ${providerId}; model: ${modelId}.`,
    "Relevant owner notes and deterministic collection evidence leave this application boundary.",
    "Provider processing and retention follow its configuration and policy. Shelf Judge retains validated local results and citation snapshots.",
    `This refresh can make ${targetCount} model operation(s) and at most ${targetCount * 2} provider inference round trips. Shelf Judge has no fixed token or monetary cap.`,
    "Cancel with Ctrl-C; already transmitted content may have been processed and may have incurred cost.",
  ].join("\n");
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (interactive) {
    console.error(disclosure);
    if (!(await confirm("Transmit this evidence and refresh reflections?"))) {
      throw new ReflectionCliError(
        "disclosure-required",
        "Disclosure was not acknowledged; use --acknowledge-disclosure for noninteractive use",
      );
    }
  } else if (!acknowledged) {
    throw new ReflectionCliError(
      "disclosure-required",
      "Disclosure was not acknowledged; use --acknowledge-disclosure for noninteractive use",
    );
  }

  const batchId = requestId();
  const capability = cancellationCapability();
  if (!opts.json) {
    console.error(`Batch ID: ${batchId}`);
    console.error(`Cancellation capability: ${capability}`);
    console.error(
      "Warning: --capability can expose this token in shell history; use Ctrl-C in this process when possible.",
    );
  }
  const abortController = new AbortController();
  const refreshRequestId = requestId();
  let cancelling = false;
  let terminalSeen = false;
  let accepted = false;
  const onSignal = () => {
    if (cancelling) return;
    cancelling = true;
    abortController.abort();
    void client.post(`${REFLECTION_PATH}/cancel`, { batchId, capability });
  };
  process.once("SIGINT", onSignal);
  const events: ReflectionStreamEvent[] = [];
  try {
    await client.postSSE(
      `${REFLECTION_PATH}/refresh`,
      {
        batchId,
        requestId: refreshRequestId,
        cancellationCapability: capability,
        ...(selectedQuestion === undefined ? {} : { questionId: selectedQuestion }),
        disclosure: { version: 1, providerId, modelId, acknowledged: true },
      },
      (rawEvent) => {
        const event = parseEvent(rawEvent);
        if (terminalSeen || event.batchId !== batchId || event.sequence !== events.length) {
          throw new ReflectionCliError(
            "invalid-daemon-response",
            "Reflection stream event lifecycle is invalid",
          );
        }
        if (!accepted && event.type !== "accepted") {
          throw new ReflectionCliError(
            "invalid-daemon-response",
            "Reflection stream must begin with acceptance",
          );
        }
        if (event.type === "accepted" && accepted) {
          throw new ReflectionCliError(
            "invalid-daemon-response",
            "Reflection stream emitted duplicate acceptance",
          );
        }
        if (
          event.type === "accepted" &&
          (event.requestId !== refreshRequestId || event.cancellationCapability !== capability)
        ) {
          throw new ReflectionCliError(
            "invalid-daemon-response",
            "Reflection stream acceptance identity is invalid",
          );
        }
        accepted ||= event.type === "accepted";
        terminalSeen = event.terminal;
        events.push(event);
        console.log(opts.json ? JSON.stringify(event) : formatEvent(event));
      },
      { signal: abortController.signal },
    );
  } catch (error) {
    if (cancelling) throw new ReflectionCliError("cancelled", "Reflection refresh cancelled");
    throw error;
  } finally {
    process.removeListener("SIGINT", onSignal);
  }
  if (!accepted || events.length === 0)
    throw new ReflectionCliError("incomplete-stream", "Reflection stream ended without an event");
  const terminal = events.at(-1);
  if (terminal?.type === "cancelled")
    throw new ReflectionCliError("cancelled", "Reflection refresh cancelled");
  if (terminal?.type === "failed")
    throw new ReflectionCliError("unavailable", `Reflection refresh failed: ${terminal.reason}`);
  if (terminal?.type !== "question-completed" || !terminal.batchComplete) {
    throw new ReflectionCliError(
      "incomplete-stream",
      "Reflection stream ended without completed results",
    );
  }
  return undefined;
}
