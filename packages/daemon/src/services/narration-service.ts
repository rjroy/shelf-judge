import type { CollectionProfile, GameWithScore, ProfileNarration } from "@shelf-judge/shared";
import type { GameService } from "./game-service.js";
import { createLogger } from "./logger.js";

const logger = createLogger("narration");

const DEFAULT_NARRATION_MODEL = "anthropic:claude-haiku-4-5-20251001";

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
    logger.log("starting narration generation...");

    // Dynamic import keeps pi-agent (which transitively pulls pi-tui) off the
    // daemon's startup path. The narration code path is rarely exercised.
    logger.log("loading pi-coding-agent...");
    const { createAgentSession, defineTool, DefaultResourceLoader, getAgentDir, SessionManager } =
      await import("@mariozechner/pi-coding-agent");
    const { getModel, Type } = await import("@mariozechner/pi-ai");
    logger.log("pi-coding-agent loaded");

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
        captured.value = params as ProfileNarration;
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

    const { provider, modelId } = parseModelSpec(
      process.env.SHELF_JUDGE_NARRATION_MODEL ?? DEFAULT_NARRATION_MODEL,
    );
    logger.log(`using model ${provider}:${modelId}`);

    // pi-ai's getModel is strongly typed against its static MODELS map.
    // We pass through env-driven strings; the runtime lookup is what matters.
    const model = getModel(provider as never, modelId as never);

    const cwd = process.cwd();
    const sessionManager = SessionManager.inMemory(cwd);
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
    await resourceLoader.reload();

    const { session, modelFallbackMessage } = await createAgentSession({
      cwd,
      model,
      thinkingLevel: "off",
      sessionManager,
      resourceLoader,
      noTools: "builtin",
      customTools: [submitNarration, getCollectionGames, getProfileDetail],
    });
    if (modelFallbackMessage) logger.warn(modelFallbackMessage);

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        logger.log(`tool: ${event.toolName}`);
      } else if (event.type === "tool_execution_end" && event.isError) {
        logger.error(`tool failed: ${event.toolName}`);
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

      logger.log("sending prompt to pi-agent...");
      await session.prompt(userPrompt);
    } finally {
      unsubscribe();
      session.dispose();
    }

    const result = captured.value;
    if (!result) {
      logger.error("agent finished without calling submit_narration");
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
