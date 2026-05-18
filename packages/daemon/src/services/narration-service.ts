import type { CollectionProfile, GameWithScore, ProfileNarration } from "@shelf-judge/shared";
import type { GameService } from "./game-service.js";
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

export interface NarrationServiceDeps {
  gameService: GameService;
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

function buildSystemPrompt(profile: CollectionProfile): string {
  const axisInfo = profile.axisDistributions
    .map(
      (d) =>
        `- ${d.axisName} (mean: ${d.mean.toFixed(1)}, σ: ${d.standardDeviation.toFixed(2)}, ${d.ratedGameCount} rated)`,
    )
    .join("\n");

  const weightInfo = profile.axisWeights
    .map((w) => `- ${w.axisName}: weight ${w.weight} (${w.percentage.toFixed(1)}%)`)
    .join("\n");

  let curveInfo = "No utility curves configured.";
  if (profile.utilityCurves.length > 0) {
    curveInfo = profile.utilityCurves
      .map((c) => {
        let desc = `- ${c.axisName}: shape=${c.shape}`;
        if (c.idealValue !== null) desc += `, ideal=${c.idealValue}`;
        if (c.tolerance !== null) desc += `, tolerance=${c.tolerance}`;
        if (c.leanDirection !== null) desc += `, lean=${c.leanDirection}`;
        if (c.vetoThreshold !== null)
          desc += `, veto ${c.vetoThreshold.direction} ${c.vetoThreshold.threshold}`;
        return desc;
      })
      .join("\n");
  }

  return `You are interpreting a board game collection profile for a single user. Your role:

1. You narrate what the data shows. You do NOT determine scores, recommend purchases, or prescribe actions.
2. Every claim must trace to specific data in the profile or collection. Do not fabricate patterns.
3. Use the provided tools to drill into specific games when naming examples. Never invent game names.

The user's rating axes and weights:
${axisInfo}

Axis weights (how the user values each dimension):
${weightInfo}

Utility curve configurations:
${curveInfo}

${profile.utilityCurves.length > 0 ? "Compare the utility curve configurations above against the actual rating distributions. Name specific games that fall outside configured sweet spots or veto thresholds. Relate the curve shapes to what you observe in the collection data." : ""}

Collection summary: ${profile.gameCount} games, ${profile.ratedGameCount} rated.

When you are ready, call \`submit_narration\` exactly once as your final action with the structured output. Do not produce any other final text.`;
}

export function createNarrationService(deps: NarrationServiceDeps): NarrationService {
  const { gameService } = deps;

  async function generateNarration(profile: CollectionProfile): Promise<ProfileNarration> {
    logger.log(
      `starting narration: ${profile.gameCount} games, ${profile.ratedGameCount} rated${DEBUG ? " (DEBUG)" : ""}`,
    );

    const NarrationSchema = Type.Object(
      {
        summary: Type.String({ description: "2-4 paragraph overview of collection identity" }),
        surprises: Type.Array(Type.String(), {
          description: "Unexpected patterns in the collection",
        }),
        tensions: Type.Array(Type.String(), {
          description: "Disagreements between stated and revealed preferences",
        }),
        blindSpots: Type.Array(Type.String(), {
          description: "Absent or underrepresented attribute categories",
        }),
        curveInsights: Type.Array(Type.String(), {
          description:
            "Utility curve observations relating configured preferences to actual distributions",
        }),
      },
      { additionalProperties: false },
    );

    const CollectionFilterSchema = Type.Object({
      mechanic: Type.Optional(Type.String({ description: "Filter by mechanic name" })),
      category: Type.Optional(Type.String({ description: "Filter by category name" })),
    });

    const ProfileSectionSchema = Type.Object({
      section: Type.Union(
        [
          Type.Literal("divergence"),
          Type.Literal("outliers"),
          Type.Literal("suggestions"),
          Type.Literal("clustering"),
          Type.Literal("distributions"),
          Type.Literal("curves"),
        ],
        { description: "Which section to retrieve" },
      ),
    });

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
        captured.value = params;
        return {
          content: [{ type: "text" as const, text: "Narration accepted." }],
          details: undefined,
          terminate: true,
        };
      },
    });

    const getCollectionGames = defineTool({
      name: "get_collection_games",
      label: "Get collection games",
      description:
        "Returns the list of games in the collection with their BGG data, ratings, and fitness scores. Use to drill into specific games when tracing patterns.",
      parameters: CollectionFilterSchema,
      async execute(_id, params) {
        const games = await gameService.listGames();
        let filtered: GameWithScore[] = games;
        if (params.mechanic) {
          const m = params.mechanic.toLowerCase();
          filtered = filtered.filter((g) =>
            g.game.bggData?.mechanics.some((mech) => mech.name.toLowerCase().includes(m)),
          );
        }
        if (params.category) {
          const c = params.category.toLowerCase();
          filtered = filtered.filter((g) =>
            g.game.bggData?.categories.some((cat) => cat.name.toLowerCase().includes(c)),
          );
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                filtered.map((g) => ({
                  name: g.game.name,
                  id: g.game.id,
                  bggId: g.game.bggId,
                  ratings: g.game.ratings,
                  fitnessScore: g.score?.score ?? null,
                  vetoed: g.score?.vetoed ?? false,
                  mechanics: g.game.bggData?.mechanics.map((m) => m.name) ?? [],
                  categories: g.game.bggData?.categories.map((c) => c.name) ?? [],
                  weight: g.game.bggData?.weight ?? null,
                  communityRating: g.game.bggData?.communityRating ?? null,
                })),
              ),
            },
          ],
          details: undefined,
        };
      },
    });

    const getProfileDetail = defineTool({
      name: "get_profile_detail",
      label: "Get profile detail",
      description: "Returns a specific section of the algorithmic profile in full detail.",
      parameters: ProfileSectionSchema,
      // eslint-disable-next-line @typescript-eslint/require-await -- defineTool requires async
      async execute(_id, params) {
        let data: unknown;
        switch (params.section) {
          case "divergence":
            data = profile.divergence;
            break;
          case "outliers":
            data = profile.outliers;
            break;
          case "suggestions":
            data = profile.suggestions;
            break;
          case "clustering":
            data = profile.bggClustering;
            break;
          case "distributions":
            data = profile.axisDistributions;
            break;
          case "curves":
            data = profile.utilityCurves;
            break;
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data) }],
          details: undefined,
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
      customTools: [submitNarration, getCollectionGames, getProfileDetail],
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
      // Strip narration fields from the profile to avoid self-referential data
      const profileData = { ...profile } as Record<string, unknown>;
      delete profileData.narration;
      delete profileData.narrationState;

      const systemPrompt = buildSystemPrompt(profile);
      const userPrompt = `${systemPrompt}

Here is the full collection profile to interpret:

${JSON.stringify(profileData, null, 2)}`;

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
      typeof result.summary !== "string" ||
      !Array.isArray(result.surprises) ||
      !Array.isArray(result.tensions) ||
      !Array.isArray(result.blindSpots) ||
      !Array.isArray(result.curveInsights)
    ) {
      logger.error("narration output missing required fields:", Object.keys(result));
      throw new Error("Narration output missing required fields");
    }

    logger.log("narration generation complete");
    return result;
  }

  return { generateNarration };
}
