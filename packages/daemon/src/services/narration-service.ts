import type {
  CollectionProfile,
  NarratedClaim,
  ProfileNarration,
  ReportedInsight,
} from "@shelf-judge/shared";
import { PROFILE_NARRATION_ABSTENTION } from "@shelf-judge/shared";
import { createLogger } from "./logger.js";
import {
  createAgentSession,
  defineTool,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const logger = createLogger("narration");

const DEFAULT_NARRATION_MODEL = "openrouter:openrouter/free";

/**
 * Verbose diagnostics. Enables: full registered-model enumeration,
 * per-message body dumps, raw event payloads. Off by default; turn on
 * with SHELF_JUDGE_NARRATION_DEBUG=1 to debug agent loop or model issues.
 */
const DEBUG =
  process.env.SHELF_JUDGE_NARRATION_DEBUG === "1" ||
  process.env.SHELF_JUDGE_NARRATION_DEBUG === "true";

export interface NarrationService {
  generateNarration(profile: CollectionProfile): Promise<ProfileNarration>;
}

function parseModelSpec(spec: string): { provider: string; modelId: string } {
  const sep = spec.indexOf(":");
  if (sep < 1 || sep === spec.length - 1) {
    throw new Error(
      `Invalid SHELF_JUDGE_NARRATION_MODEL: "${spec}" (expected "provider:model-id")`,
    );
  }
  return { provider: spec.slice(0, sep), modelId: spec.slice(sep + 1) };
}

type AnyReportedInsight = ReportedInsight<unknown>;

interface NarrationEvidenceInput {
  collection: { gameCount: number; ratedGameCount: number };
  insights: Array<{ family: "divergence" | "outlier" | "suggestion"; insight: AnyReportedInsight }>;
}

interface NarrationSelection {
  summary: Array<Pick<NarratedClaim, "evidenceReferences">>;
  surprises: Array<Pick<NarratedClaim, "evidenceReferences">>;
  tensions: Array<Pick<NarratedClaim, "evidenceReferences">>;
}

export function buildNarrationEvidence(profile: CollectionProfile): NarrationEvidenceInput {
  const insights: NarrationEvidenceInput["insights"] = [];
  for (const insight of profile.divergence ?? []) {
    if (insight.status === "reported") insights.push({ family: "divergence", insight });
  }
  for (const insight of profile.outliers) {
    if (insight.status === "reported") insights.push({ family: "outlier", insight });
  }
  for (const insight of profile.suggestions) {
    if (insight.status === "reported") insights.push({ family: "suggestion", insight });
  }
  return {
    collection: { gameCount: profile.gameCount, ratedGameCount: profile.ratedGameCount },
    insights,
  };
}

function allClaims(narration: ProfileNarration): NarratedClaim[] {
  return [...narration.summary, ...narration.surprises, ...narration.tensions];
}

function canonicalClaim(
  references: NarratedClaim["evidenceReferences"],
  reported: Map<string, { family: string; insight: AnyReportedInsight }>,
): NarratedClaim {
  const sources = references.map(({ insightId }) => reported.get(insightId)?.insight);
  if (sources.some((source) => source === undefined)) {
    const missing = references.find(({ insightId }) => !reported.has(insightId));
    throw new Error(`Narration references unavailable insight: ${missing?.insightId ?? "unknown"}`);
  }
  const grounded = sources.filter((source): source is AnyReportedInsight => source !== undefined);
  const interpretations = grounded
    .map(({ interpretation }) => interpretation)
    .filter((interpretation): interpretation is string => interpretation !== null);
  return {
    observation: grounded.map(({ observation }) => observation).join(" "),
    interpretation: interpretations.length > 0 ? interpretations.join(" ") : null,
    evidenceReferences: references,
  };
}

function groundNarrationSelection(
  selection: NarrationSelection,
  profile: CollectionProfile,
): ProfileNarration {
  const evidence = buildNarrationEvidence(profile);
  const reported = new Map(
    evidence.insights.map(({ family, insight }) => [insight.id, { family, insight }]),
  );
  const hydrate = ({ evidenceReferences }: Pick<NarratedClaim, "evidenceReferences">) =>
    canonicalClaim(evidenceReferences, reported);
  return validateNarrationEvidence(
    {
      summary: selection.summary.map(hydrate),
      surprises: selection.surprises.map(hydrate),
      tensions: selection.tensions.map(hydrate),
      abstention: null,
    },
    profile,
  );
}

export function validateNarrationEvidence(
  narration: ProfileNarration,
  profile: CollectionProfile,
): ProfileNarration {
  const evidence = buildNarrationEvidence(profile);
  const reported = new Map(
    evidence.insights.map(({ family, insight }) => [insight.id, { family, insight }]),
  );
  const claims = allClaims(narration);

  if (claims.length === 0) {
    if (narration.abstention === null) throw new Error("Narration contains no grounded claims");
    if (reported.size > 0)
      throw new Error("Narration abstained despite available trusted evidence");
    return narration;
  }
  if (narration.abstention !== null) {
    throw new Error("Narration cannot combine claims with an abstention");
  }

  for (const claim of claims) {
    if (
      new Set(claim.evidenceReferences.map(({ insightId }) => insightId)).size !==
      claim.evidenceReferences.length
    ) {
      throw new Error("Narration claim repeats an insight reference");
    }
    for (const reference of claim.evidenceReferences) {
      const source = reported.get(reference.insightId);
      if (!source) {
        throw new Error(`Narration references unavailable insight: ${reference.insightId}`);
      }
      const evidenceGameIds = new Set(source.insight.evidence.map(({ gameId }) => gameId));
      if (reference.gameIds.some((gameId) => !evidenceGameIds.has(gameId))) {
        throw new Error(`Narration references a game outside insight ${reference.insightId}`);
      }
    }
    const canonical = canonicalClaim(claim.evidenceReferences, reported);
    if (
      claim.observation !== canonical.observation ||
      claim.interpretation !== canonical.interpretation
    ) {
      throw new Error("Narration claim text does not match its trusted evidence");
    }
  }

  for (const tension of narration.tensions) {
    if (
      tension.evidenceReferences.some(
        ({ insightId }) => reported.get(insightId)?.family !== "divergence",
      )
    ) {
      throw new Error("Narrated tensions require reported divergence evidence");
    }
  }
  return narration;
}

function buildSystemPrompt(): string {
  return `You narrate trusted board game collection insights for one user.

Rules:
1. Use only the supplied reported insights. Suppressed, retired, and insufficient claims are deliberately absent.
2. Select insight references only. The server copies each insight's canonical observation and interpretation into separate fields.
3. Every claim must reference one or more supplied insight IDs and at least one game from each insight's evidence.
4. A tension is allowed only when it references reported divergence evidence. Do not infer tensions from outliers or suggestions.
5. Do not recommend purchases, prescribe actions, invent games, or claim causation.

Call \`submit_narration\` exactly once as your final action. Do not produce any other final text.`;
}

export function createNarrationService(): NarrationService {
  async function generateNarration(profile: CollectionProfile): Promise<ProfileNarration> {
    const evidence = buildNarrationEvidence(profile);
    logger.log(
      `starting narration: ${profile.gameCount} games, ${profile.ratedGameCount} rated, ${evidence.insights.length} reported insights${DEBUG ? " (DEBUG)" : ""}`,
    );
    if (evidence.insights.length === 0) {
      logger.log("narration abstained: no reported trusted insights");
      return {
        summary: [],
        surprises: [],
        tensions: [],
        abstention: PROFILE_NARRATION_ABSTENTION,
      };
    }

    const EvidenceReferenceSchema = Type.Object(
      {
        insightId: Type.String({ description: "ID of a supplied reported insight" }),
        gameIds: Type.Array(Type.String(), {
          minItems: 1,
          description: "Only game IDs present in that insight's evidence",
        }),
      },
      { additionalProperties: false },
    );
    const ClaimSchema = Type.Object(
      {
        evidenceReferences: Type.Array(EvidenceReferenceSchema, {
          minItems: 1,
          description: "Reported insights to narrate; the server supplies their canonical text",
        }),
      },
      { additionalProperties: false },
    );
    const NarrationSchema = Type.Object(
      {
        summary: Type.Array(ClaimSchema, { description: "Core collection identity claims" }),
        surprises: Type.Array(ClaimSchema, { description: "Evidence-backed unexpected findings" }),
        tensions: Type.Array(ClaimSchema, {
          description: "Only disagreements supported by reported divergence insights",
        }),
      },
      { additionalProperties: false },
    );

    // Wrap in an object so TS doesn't narrow it to `null` based on the initializer;
    // the actual assignment happens inside a tool callback (closure) which TS
    // doesn't track for control-flow narrowing of the outer variable.
    const captured: { value: ProfileNarration | null } = { value: null };

    const submitNarration = defineTool({
      name: "submit_narration",
      label: "Submit narration",
      description:
        "Submit the final structured narration. Call this exactly once as your last action.",
      parameters: NarrationSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- defineTool requires async
      async execute(_id, params) {
        if (captured.value) {
          return {
            content: [
              {
                type: "text" as const,
                text: "submit_narration was already called; ignoring duplicate.",
              },
            ],
            details: undefined,
          };
        }
        captured.value = groundNarrationSelection(params as NarrationSelection, profile);
        return {
          content: [{ type: "text" as const, text: "Narration accepted." }],
          details: undefined,
          terminate: true,
        };
      },
    });

    const cwd = process.cwd();
    const agentDir = getAgentDir();
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
    await resourceLoader.reload();
    const sessionManager = SessionManager.inMemory();

    // Create the session WITHOUT a model so extensions get a chance to load
    // and register their providers. The model is resolved and set below
    // after bindExtensions fires session_start. Skipping bindExtensions or
    // resolving via pi-ai's static getModel breaks user-registered providers
    // (e.g. fallback chains from ~/.pi/agent/extensions/).
    const { session, modelFallbackMessage } = await createAgentSession({
      cwd,
      thinkingLevel: "off",
      sessionManager,
      resourceLoader,
      noTools: "builtin",
      customTools: [submitNarration],
    });
    if (modelFallbackMessage) logger.warn(`pi modelFallbackMessage: ${modelFallbackMessage}`);

    if (DEBUG) {
      logger.log(`pi agent dir: ${agentDir}`);
      const all = session.modelRegistry.getAll();
      logger.log(`modelRegistry has ${all.length} model(s):`);
      for (const m of all) {
        logger.log(`  - ${m.provider}:${m.id}${m.name ? ` (${m.name})` : ""}`);
      }
    }

    const { provider, modelId } = parseModelSpec(
      process.env.SHELF_JUDGE_NARRATION_MODEL ?? DEFAULT_NARRATION_MODEL,
    );
    const model = session.modelRegistry.find(provider, modelId);
    if (!model) {
      const msg = `Model "${provider}:${modelId}" not found in session.modelRegistry. Check ~/.pi/agent/models.json and any extensions in ~/.pi/agent/extensions/. Set SHELF_JUDGE_NARRATION_DEBUG=1 to list registered models.`;
      logger.error(msg);
      throw new Error(msg);
    }

    // bindExtensions fires session_start, which is the only event some
    // extensions use to capture references (e.g. modelRegistry). Calling
    // setModel before this leaves those extensions in a half-initialized
    // state and prompt() will fail with extension-specific errors.
    await session.bindExtensions({});
    await session.setModel(model);
    logger.log(`session ready: model=${model.provider}:${model.id}, thinking=off`);

    const unsubscribe = session.subscribe((event) => {
      switch (event.type) {
        case "tool_execution_start": {
          const args = JSON.stringify(event.args);
          logger.log(
            `tool start: ${event.toolName} args=${args.length > 200 ? args.slice(0, 200) + "..." : args}`,
          );
          break;
        }
        case "tool_execution_end": {
          if (event.isError) {
            const result = JSON.stringify(event.result);
            logger.error(
              `tool failed: ${event.toolName} result=${result.length > 400 ? result.slice(0, 400) + "..." : result}`,
            );
          } else if (DEBUG) {
            const result = JSON.stringify(event.result);
            logger.log(
              `tool end: ${event.toolName} result=${result.length > 200 ? result.slice(0, 200) + "..." : result}`,
            );
          }
          break;
        }
        case "auto_retry_start":
          logger.warn(`auto-retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`);
          break;
        case "auto_retry_end":
          if (event.success) {
            logger.log(`auto-retry recovered on attempt ${event.attempt}`);
          } else {
            logger.error(
              `auto-retry exhausted at attempt ${event.attempt}: ${event.finalError ?? "unknown"}`,
            );
          }
          break;
        default:
          if (DEBUG) {
            const raw = JSON.stringify(event);
            logger.log(
              `event ${event.type}: ${raw.length > 300 ? raw.slice(0, 300) + "..." : raw}`,
            );
          }
      }
    });

    try {
      const systemPrompt = buildSystemPrompt();
      const userPrompt = `${systemPrompt}

Here is the complete and exclusive trusted evidence to interpret:

${JSON.stringify(evidence, null, 2)}`;

      logger.log(`sending prompt (${userPrompt.length} chars)`);
      try {
        await session.prompt(userPrompt);
      } catch (err) {
        logger.error("session.prompt() threw:", err);
        throw err;
      }

      const stats = session.getSessionStats();
      logger.log(
        `agent loop done: assistant turns=${stats.assistantMessages}, tool calls=${stats.toolCalls}, tokens in/out=${stats.tokens.input}/${stats.tokens.output}, cost=$${stats.cost.toFixed(4)}`,
      );

      if (DEBUG) {
        logger.log(`session.messages (${session.messages.length}):`);
        for (const [i, msg] of session.messages.entries()) {
          const m = msg as unknown as Record<string, unknown>;
          const head = JSON.stringify({ role: m.role, type: m.type });
          const body = JSON.stringify(msg);
          logger.log(`  [${i}] ${head}`);
          logger.log(`      body=${body.length > 800 ? body.slice(0, 800) + "..." : body}`);
        }
      }
    } finally {
      unsubscribe();
      session.dispose();
    }

    const result = captured.value;
    if (!result) {
      logger.error(
        "agent finished without calling submit_narration. Set SHELF_JUDGE_NARRATION_DEBUG=1 to inspect the message stream.",
      );
      throw new Error("Narration generation produced no result");
    }

    if (
      !Array.isArray(result.summary) ||
      !Array.isArray(result.surprises) ||
      !Array.isArray(result.tensions)
    ) {
      logger.error("narration output missing required fields:", Object.keys(result));
      throw new Error("Narration output missing required fields");
    }

    logger.log("narration generation complete");
    return validateNarrationEvidence(result, profile);
  }

  return { generateNarration };
}
