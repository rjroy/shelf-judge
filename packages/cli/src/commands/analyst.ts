import {
  AnalystConfigurationSchema,
  AnalystFinalSchema,
  AnalystStreamEventSchema,
  type AnalystTurnRequest,
} from "@shelf-judge/shared";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { DaemonClient, SSEEvent } from "../client.js";

type AnalystMessage = AnalystTurnRequest["messages"][number];

interface AnalystConfiguration {
  readonly providerId: string;
  readonly modelId: string;
  readonly localRetention: string;
  readonly cancellation: string;
  readonly evidenceClasses: readonly string[];
  readonly relevantOwnerNotesMayBeTransmitted: boolean;
  readonly maximumTranscriptMessages: number;
  readonly maximumTranscriptCharacters: number;
}

export interface AnalystIo {
  write(message: string): void;
  prompt(message: string): Promise<string>;
}

function terminal(event: SSEEvent): boolean {
  const parsed = AnalystStreamEventSchema.parse(JSON.parse(event.data));
  return parsed.terminal;
}

async function configuration(client: DaemonClient): Promise<AnalystConfiguration> {
  const response = await client.get<unknown>("/api/analyst/configuration");
  if (!response.ok) throw new Error("The Analyst configuration is unavailable.");
  const parsed = AnalystConfigurationSchema.parse(response.data);
  if (parsed.configuration.status !== "configured")
    throw new Error("The Analyst provider is not configured.");
  return {
    providerId: parsed.configuration.identity.providerId,
    modelId: parsed.configuration.identity.modelId,
    localRetention: parsed.disclosure.localRetention,
    cancellation: parsed.disclosure.cancellation,
    evidenceClasses: parsed.disclosure.evidenceClasses,
    relevantOwnerNotesMayBeTransmitted: parsed.disclosure.relevantOwnerNotesMayBeTransmitted,
    maximumTranscriptMessages: parsed.disclosure.maximumTranscriptMessages,
    maximumTranscriptCharacters: parsed.disclosure.maximumTranscriptCharacters,
  };
}

function createConsoleIo(): AnalystIo {
  return {
    write: (message) => stdout.write(`${message}\n`),
    async prompt(message) {
      const input = readline.createInterface({ input: stdin, output: stdout });
      try {
        return await input.question(message);
      } finally {
        input.close();
      }
    },
  };
}

function capability(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function acknowledge(configuration: AnalystConfiguration, io: AnalystIo): Promise<boolean> {
  io.write(`Your question and relevant collection evidence are sent to ${configuration.providerId} / ${configuration.modelId}.`);
  io.write(`Evidence classes sent when relevant: ${configuration.evidenceClasses.join(", ")}.`);
  io.write(`Relevant owner notes may be transmitted: ${configuration.relevantOwnerNotesMayBeTransmitted ? "yes" : "no"}.`);
  io.write(`${configuration.localRetention} Provider processing and retention follow its policy.`);
  io.write(`This application has no token or monetary cap. ${configuration.cancellation}`);
  return (await io.prompt("Type yes to acknowledge and continue: ")).trim().toLowerCase() === "yes";
}

function exceedsTranscriptLimits(
  messages: readonly AnalystMessage[],
  configuration: AnalystConfiguration,
): boolean {
  return (
    messages.length > configuration.maximumTranscriptMessages ||
    messages.reduce((characters, message) => characters + message.content.length, 0) >
      configuration.maximumTranscriptCharacters
  );
}

async function streamTurn(
  client: DaemonClient,
  config: AnalystConfiguration,
  conversation: { readonly conversationId: string; readonly capability: string },
  messages: [AnalystMessage, ...AnalystMessage[]],
  io: AnalystIo,
): Promise<AnalystMessage | undefined> {
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const request: AnalystTurnRequest = {
    conversationId: conversation.conversationId,
    conversationCapability: conversation.capability,
    requestId,
    turnIndex: messages.filter((message) => message.role === "analyst").length,
    disclosure: { providerId: config.providerId, modelId: config.modelId, acknowledged: true },
    messages,
  };
  let completed: AnalystMessage | undefined;
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    cancellation ??= client
      .post("/api/analyst/turns/cancel", {
        conversationId: request.conversationId,
        conversationCapability: request.conversationCapability,
        requestId: request.requestId,
      })
      .then((response) => {
        if (!response.ok) throw new Error(`Cancellation request failed with status ${response.status}`);
      })
      .catch(() => {
        io.write(
          "Cancellation could not be confirmed. The local stream was stopped, but provider work may continue.",
        );
      });
    controller.abort();
  };
  process.once("SIGINT", cancel);
  try {
    await client.postSSE(
      "/api/analyst/turns/stream",
      request,
      (raw) => {
        const event = AnalystStreamEventSchema.parse(JSON.parse(raw.data));
        if (event.requestId !== requestId) return;
        if (event.type === "validated-block") io.write(event.block.text);
        if (event.type === "completed") {
          const result = AnalystFinalSchema.parse(event.result);
          completed = {
            role: "analyst",
            content: result.blocks.map((block) => block.text).join("\n\n"),
            outcome: result.outcome,
            noteDependencies: event.noteDependencies,
            validationAttestation: event.validationAttestation,
          };
        }
        if (event.type === "cancelled") io.write("The Analyst request was cancelled.");
        if (event.type === "failed") io.write(`The Analyst is unavailable: ${event.reason}.`);
      },
      {
        signal: controller.signal,
        validateEvent: (event) => AnalystStreamEventSchema.parse(JSON.parse(event.data)),
        isTerminal: terminal,
        missingTerminalMessage: "The Analyst stream ended without a terminal event.",
      },
    );
  } catch (error) {
    if (controller.signal.aborted) return undefined;
    throw error;
  } finally {
    process.removeListener("SIGINT", cancel);
    await cancellation;
  }
  return completed;
}

export async function analystAsk(
  client: DaemonClient,
  args: string[],
  io?: AnalystIo,
): Promise<void> {
  const terminal = io ?? createConsoleIo();
  const acknowledged = args.includes("--acknowledge-disclosure");
  const question = args.filter((argument) => argument !== "--acknowledge-disclosure").join(" ").trim();
  if (!question) throw new Error("Usage: shelf-judge analyst ask <question> --acknowledge-disclosure");
  const config = await configuration(client);
  if (!acknowledged && io === undefined && (!stdin.isTTY || !stdout.isTTY)) {
    throw new Error("Disclosure was not acknowledged; use --acknowledge-disclosure for noninteractive use");
  }
  if (!acknowledged && !(await acknowledge(config, terminal))) {
    terminal.write("Analyst request not sent.");
    return;
  }
  const messages: [AnalystMessage, ...AnalystMessage[]] = [{ role: "owner", content: question }];
  if (exceedsTranscriptLimits(messages, config)) {
    throw new Error("Question exceeds the configured transcript limit; shorten it and try again");
  }
  await streamTurn(
    client,
    config,
    { conversationId: crypto.randomUUID(), capability: capability() },
    messages,
    terminal,
  );
}

export async function analystChat(client: DaemonClient, io?: AnalystIo): Promise<void> {
  if (io === undefined && (!stdin.isTTY || !stdout.isTTY)) {
    throw new Error("Analyst chat requires an interactive terminal");
  }
  const terminal = io ?? createConsoleIo();
  const config = await configuration(client);
  if (!(await acknowledge(config, terminal))) {
    terminal.write("Analyst chat not started.");
    return;
  }
  terminal.write("Ephemeral Analyst chat. Type /exit to leave; nothing is saved.");
  const conversation = { conversationId: crypto.randomUUID(), capability: capability() };
  let messages: [AnalystMessage, ...AnalystMessage[]] | undefined;
  while (true) {
    if (messages !== undefined && exceedsTranscriptLimits(messages, config)) {
      terminal.write(
        "This chat reached the configured transcript limit. Start a new chat to continue; nothing was saved.",
      );
      return;
    }
    const question = (await terminal.prompt("You: ")).trim();
    if (question === "/exit" || question === "/quit") return;
    if (!question) continue;
    messages =
      messages === undefined
        ? [{ role: "owner", content: question }]
        : [...messages, { role: "owner", content: question }];
    if (exceedsTranscriptLimits(messages, config)) {
      terminal.write(
        "This question would exceed the configured transcript limit. Start a new chat to continue; nothing was saved.",
      );
      return;
    }
    const answer = await streamTurn(client, config, conversation, messages, terminal);
    if (answer !== undefined) messages = [...messages, answer];
  }
}
