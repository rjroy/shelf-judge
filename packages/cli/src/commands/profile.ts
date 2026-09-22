// Profile command: outputs the collection profile as JSON.
import {
  AttentionDispositionCommandResultSchema,
  AttentionDispositionCommandSchema,
  AttentionDispositionCommandTemplateSchema,
  CollectionProfileAttentionCardSchema,
} from "@shelf-judge/shared";
import type { DaemonClient } from "../client.js";
import type { OutputOptions } from "../output.js";
import { printOutput } from "../output.js";
import { StructuredCliError } from "../errors.js";

export interface ProfileAttentionDependencies {
  createCommandId?: () => string;
  writeStderr?: (message: string) => void;
}

export async function profileCommand(
  client: DaemonClient,
  args: string[],
  opts: OutputOptions,
): Promise<string> {
  if (args.length > 0) throw new Error("Usage: shelf-judge profile");
  const profile = await client.getProfile();
  // Profile is complex nested data; always render as JSON regardless of opts.json.
  return printOutput(profile, { ...opts, json: true });
}

function usage(operation: "not-now" | "intentional"): never {
  throw new Error(
    `Usage: shelf-judge profile attention ${operation} <template-json> [--command-id <uuid>] [--json]`,
  );
}

function parseTemplate(
  operation: "not-now" | "intentional",
  value: string,
): Record<string, unknown> {
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error(`Invalid Profile attention ${operation} template JSON`);
  }

  const direct = AttentionDispositionCommandTemplateSchema.safeParse(input);
  if (direct.success) {
    if (direct.data.operation !== operation) {
      throw new Error(`Profile attention template operation must be ${operation}`);
    }
    return direct.data;
  }

  // Accepting a complete daemon card is only a convenience for callers that
  // copied the action directly from `profile`; the command fields still come
  // exclusively from that daemon-supplied action template.
  const card = CollectionProfileAttentionCardSchema.safeParse(input);
  if (card.success) {
    const action = card.data.actions.find((candidate) => candidate.action === operation);
    const command = action?.command;
    if (command === null || command === undefined) {
      throw new Error(`Profile attention card has no ${operation} command template`);
    }
    const parsedCommand = AttentionDispositionCommandTemplateSchema.safeParse(command);
    if (parsedCommand.success && parsedCommand.data.operation === operation) {
      return parsedCommand.data;
    }
  }

  throw new Error(`Invalid Profile attention ${operation} command template`);
}

function parseActionArgs(
  operation: "not-now" | "intentional",
  args: string[],
): { template: string; commandId?: string } {
  let template: string | undefined;
  let commandId: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--template") {
      if (template !== undefined || index + 1 >= args.length) usage(operation);
      template = args[++index];
    } else if (arg === "--command-id") {
      if (commandId !== undefined || index + 1 >= args.length) usage(operation);
      commandId = args[++index];
    } else if (arg.startsWith("--")) {
      usage(operation);
    } else {
      positional.push(arg);
    }
  }
  if (template === undefined) {
    if (positional.length !== 1) usage(operation);
    template = positional[0];
  } else if (positional.length > 0) {
    usage(operation);
  }
  return { template, commandId };
}

export async function profileAttentionCommand(
  client: DaemonClient,
  operation: "not-now" | "intentional",
  args: string[],
  opts: OutputOptions,
  dependencies: ProfileAttentionDependencies = {},
): Promise<string> {
  const parsedArgs = parseActionArgs(operation, args);
  const template = parseTemplate(operation, parsedArgs.template);
  const commandId =
    parsedArgs.commandId ?? (dependencies.createCommandId ?? (() => crypto.randomUUID()))();
  if (parsedArgs.commandId === undefined) {
    (dependencies.writeStderr ?? console.error)(`Command ID: ${commandId}`);
  }

  const request = AttentionDispositionCommandSchema.safeParse({ ...template, commandId });
  if (!request.success) {
    throw new Error(`Invalid Profile attention ${operation} command: ${request.error.message}`);
  }

  const response = await client.post(`/api/profile/attention/${operation}`, request.data);
  const result = AttentionDispositionCommandResultSchema.safeParse(response.data);
  if (!result.success) {
    throw new Error(`Invalid Profile attention response: ${result.error.message}`);
  }
  if (result.data.outcome === "rejected") {
    throw new StructuredCliError(result.data);
  }
  if (!response.ok) {
    throw new Error(`Profile attention ${operation} request failed: ${response.status}`);
  }

  // Receipts are daemon authority. Do not replace them with a local summary,
  // even in human-readable mode.
  return printOutput(response.data, { ...opts, json: true });
}
