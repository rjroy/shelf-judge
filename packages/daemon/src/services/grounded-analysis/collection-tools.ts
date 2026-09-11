import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import {
  COLLECTION_GREP_TOOL_NAME,
  COLLECTION_READ_GAMES_TOOL_NAME,
  COLLECTION_SUMMARIZE_TOOL_NAME,
  COLLECTION_TOP_TOOL_NAME,
} from "./structured-submission.js";

const cursorParameters = Type.Object(
  { token: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);

const toolParameters = {
  top: Type.Object(
    {
      rankBy: Type.Literal("fitness"),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      cursor: Type.Optional(Type.Union([Type.Null(), cursorParameters])),
    },
    { additionalProperties: false },
  ),
  grep: Type.Object(
    {
      pattern: Type.String({ minLength: 1, maxLength: 128 }),
      allowedFields: Type.Array(
        Type.Union([
          Type.Literal("notes"),
          Type.Literal("metadata.mechanics"),
          Type.Literal("metadata.categories"),
          Type.Literal("metadata.description"),
        ]),
        { minItems: 1, maxItems: 4 },
      ),
      gameIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 }),
      cursor: Type.Optional(Type.Union([Type.Null(), cursorParameters])),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    },
    { additionalProperties: false },
  ),
  readGames: Type.Object(
    {
      gameIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 10 }),
      fields: Type.Array(
        Type.Union([
          Type.Literal("game-identity-ownership"),
          Type.Literal("current-scoring"),
          Type.Literal("imported-metadata"),
          Type.Literal("play-acquisition"),
          Type.Literal("collection-structure"),
          Type.Literal("owner-game-note"),
        ]),
        { minItems: 1, maxItems: 6 },
      ),
    },
    { additionalProperties: false },
  ),
  summarize: Type.Object(
    {
      groupBy: Type.Union([
        Type.Literal("metadata.mechanics"),
        Type.Literal("metadata.categories"),
      ]),
      measures: Type.Array(
        Type.Union([Type.Literal("gameCount"), Type.Literal("averageFitness")]),
        {
          minItems: 1,
          maxItems: 2,
        },
      ),
      cursor: Type.Optional(Type.Union([Type.Null(), cursorParameters])),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    },
    { additionalProperties: false },
  ),
};

const toolArguments = {
  top: z
    .object({
      rankBy: z.literal("fitness"),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.object({ token: z.string().uuid() }).nullable().optional(),
    })
    .strict(),
  grep: z
    .object({
      pattern: z.string().min(1).max(128),
      allowedFields: z
        .array(
          z.enum(["notes", "metadata.mechanics", "metadata.categories", "metadata.description"]),
        )
        .min(1)
        .max(4),
      gameIds: z.array(z.string().min(1)).min(1).max(100),
      cursor: z.object({ token: z.string().uuid() }).nullable().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  readGames: z
    .object({
      gameIds: z.array(z.string().min(1)).min(1).max(10),
      fields: z
        .array(
          z.enum([
            "game-identity-ownership",
            "current-scoring",
            "imported-metadata",
            "play-acquisition",
            "collection-structure",
            "owner-game-note",
          ]),
        )
        .min(1)
        .max(6),
    })
    .strict(),
  summarize: z
    .object({
      groupBy: z.enum(["metadata.mechanics", "metadata.categories"]),
      measures: z
        .array(z.enum(["gameCount", "averageFitness"]))
        .min(1)
        .max(2),
      cursor: z.object({ token: z.string().uuid() }).nullable().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
};

type ToolName = keyof typeof toolArguments;
type ToolArguments<Name extends ToolName> = z.infer<(typeof toolArguments)[Name]>;

export interface CollectionToolStage {
  readonly name: string;
  readonly outcome: "attempt" | "success" | "failed" | "rejected";
  readonly callIndex: number;
  readonly durationMs: number;
  readonly bytes?: number;
  readonly rejection?: "context-limit";
  readonly failure?: "cancelled" | "evidence-operation-failed";
}

export interface CollectionToolFactoryOptions {
  readonly signal: AbortSignal;
  readonly contextLimitMessage: string;
  readonly resultMaxBytes: number;
  readonly turnMaxBytes: number;
  readonly redact: (value: unknown) => unknown;
  readonly onStage?: (stage: CollectionToolStage) => void;
  readonly operations: {
    readonly top: (parameters: ToolArguments<"top">) => Promise<unknown>;
    readonly grep: (parameters: ToolArguments<"grep">) => Promise<unknown>;
    readonly readGames: (parameters: ToolArguments<"readGames">) => Promise<unknown>;
    readonly summarize: (parameters: ToolArguments<"summarize">) => Promise<unknown>;
  };
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function abortable<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error instanceof Error ? error : new Error("Collection evidence operation failed"));
      },
    );
  });
}

/** Creates the four bounded model-facing collection tools for one captured evidence turn. */
export function createCollectionTools(
  options: CollectionToolFactoryOptions,
): readonly ToolDefinition[] {
  let serializedBytes = 0;
  let toolIndex = 0;
  const createTool = <Name extends ToolName>(
    name: Name,
    label: string,
    description: string,
  ): ToolDefinition =>
    defineTool({
      name,
      label,
      description,
      parameters: toolParameters[name],
      async execute(_toolCallId, parameters) {
        const started = Date.now();
        const callIndex = toolIndex++;
        options.onStage?.({ name, outcome: "attempt", callIndex, durationMs: 0 });
        try {
          const result = await (() => {
            switch (name) {
              case "top":
                return abortable(
                  options.operations.top(toolArguments.top.parse(parameters)),
                  options.signal,
                );
              case "grep":
                return abortable(
                  options.operations.grep(toolArguments.grep.parse(parameters)),
                  options.signal,
                );
              case "readGames":
                return abortable(
                  options.operations.readGames(toolArguments.readGames.parse(parameters)),
                  options.signal,
                );
              case "summarize":
                return abortable(
                  options.operations.summarize(toolArguments.summarize.parse(parameters)),
                  options.signal,
                );
            }
          })();
          options.signal.throwIfAborted();
          const serialized = JSON.stringify(options.redact(result));
          const bytes = new TextEncoder().encode(serialized).byteLength;
          if (bytes > options.resultMaxBytes || serializedBytes + bytes > options.turnMaxBytes) {
            options.onStage?.({
              name,
              outcome: "rejected",
              callIndex,
              durationMs: Date.now() - started,
              bytes,
              rejection: "context-limit",
            });
            return {
              content: [{ type: "text", text: options.contextLimitMessage }],
              details: undefined,
            };
          }
          serializedBytes += bytes;
          options.onStage?.({
            name,
            outcome: "success",
            callIndex,
            durationMs: Date.now() - started,
            bytes,
          });
          return { content: [{ type: "text", text: serialized }], details: undefined };
        } catch (error) {
          options.onStage?.({
            name,
            outcome: "failed",
            callIndex,
            durationMs: Date.now() - started,
            failure: options.signal.aborted ? "cancelled" : "evidence-operation-failed",
          });
          throw error;
        }
      },
    });
  return Object.freeze([
    createTool(
      COLLECTION_TOP_TOOL_NAME,
      "Rank collection games",
      "Rank owned games by fitness. Each returned entry includes compact identity and scoring evidence that may be cited directly.",
    ),
    createTool(
      COLLECTION_GREP_TOOL_NAME,
      "Search collection evidence",
      "Search selected game fields. Matches are discovery-only and are not authorized evidence: call readGames for the matching field before citing its content.",
    ),
    createTool(
      COLLECTION_READ_GAMES_TOOL_NAME,
      "Read selected games",
      "Read bounded evidence fields for explicitly named games.",
    ),
    createTool(
      COLLECTION_SUMMARIZE_TOOL_NAME,
      "Summarize collection",
      "Emit a deterministic aggregate over collection metadata.",
    ),
  ]);
}
