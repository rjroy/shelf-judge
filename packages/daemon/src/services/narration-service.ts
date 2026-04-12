import type { CollectionProfile, GameWithScore, ProfileNarration } from "@shelf-judge/shared";
import type { GameService } from "./game-service.js";

export interface NarrationService {
  generateNarration(profile: CollectionProfile): Promise<ProfileNarration>;
}

export interface NarrationServiceDeps {
  gameService: GameService;
}

const NARRATION_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string" as const,
      description: "2-4 paragraph overview of collection identity",
    },
    surprises: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Unexpected patterns in the collection",
    },
    tensions: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Disagreements between stated and revealed preferences",
    },
    blindSpots: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Absent or underrepresented attribute categories",
    },
    curveInsights: {
      type: "array" as const,
      items: { type: "string" as const },
      description:
        "Utility curve observations relating configured preferences to actual distributions",
    },
  },
  required: ["summary", "surprises", "tensions", "blindSpots", "curveInsights"],
  additionalProperties: false,
};

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

Respond ONLY with the structured JSON output. Do not include any other text.`;
}

export function createNarrationService(deps: NarrationServiceDeps): NarrationService {
  const { gameService } = deps;

  async function generateNarration(profile: CollectionProfile): Promise<ProfileNarration> {
    // Dynamic import to avoid loading the SDK (and its subprocess machinery)
    // when narration is never requested. This keeps daemon startup fast.
    const { query, tool, createSdkMcpServer } = await import("@anthropic-ai/claude-agent-sdk");
    const { z } = await import("zod/v4");

    // MCP tools: read-only access to collection data
    const getCollectionGames = tool(
      "get_collection_games",
      "Returns the list of games in the collection with their BGG data, ratings, and fitness scores. Use to drill into specific games when tracing patterns.",
      {
        mechanic: z.string().optional().describe("Filter by mechanic name"),
        category: z.string().optional().describe("Filter by category name"),
      },
      async (args) => {
        const games = await gameService.listGames();
        let filtered: GameWithScore[] = games;
        if (args.mechanic) {
          const m = args.mechanic.toLowerCase();
          filtered = filtered.filter((g) =>
            g.game.bggData?.mechanics.some((mech) => mech.name.toLowerCase().includes(m)),
          );
        }
        if (args.category) {
          const c = args.category.toLowerCase();
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
        };
      },
    );

    const getProfileDetail = tool(
      "get_profile_detail",
      "Returns a specific section of the algorithmic profile in full detail.",
      {
        section: z
          .enum(["divergence", "outliers", "suggestions", "clustering", "distributions", "curves"])
          .describe("Which section to retrieve"),
      },
      // eslint-disable-next-line @typescript-eslint/require-await -- SDK tool() requires async callback
      async (args) => {
        let data: unknown;
        switch (args.section) {
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
        };
      },
    );

    const mcpServer = createSdkMcpServer({
      name: "shelf-judge-profile",
      tools: [getCollectionGames, getProfileDetail],
    });

    // Strip narration fields from the profile to avoid self-referential data
    const profileData = { ...profile } as Record<string, unknown>;
    delete profileData.narration;
    delete profileData.narrationState;

    const systemPrompt = buildSystemPrompt(profile);
    const userPrompt = `Here is the full collection profile to interpret:\n\n${JSON.stringify(profileData, null, 2)}`;

    const queryResult = query({
      prompt: userPrompt,
      options: {
        model: "claude-sonnet-4-6",
        maxBudgetUsd: 0.05,
        maxTurns: 10,
        systemPrompt,
        outputFormat: { type: "json_schema", schema: NARRATION_JSON_SCHEMA },
        mcpServers: { "shelf-judge-profile": mcpServer },
        tools: [],
        permissionMode: "plan",
        persistSession: false,
      },
    });

    // Iterate the async generator to completion
    let result: ProfileNarration | null = null;
    for await (const message of queryResult) {
      if (message.type === "result") {
        if (message.subtype === "success") {
          if (message.structured_output) {
            result = message.structured_output as ProfileNarration;
          } else {
            // Try parsing the result text
            result = JSON.parse(message.result) as ProfileNarration;
          }
        } else {
          const errors = (message as { errors?: string[] }).errors ?? [];
          throw new Error(
            `Narration generation failed: ${message.subtype}${errors.length > 0 ? ` - ${errors.join(", ")}` : ""}`,
          );
        }
      }
    }

    if (!result) {
      throw new Error("Narration generation produced no result");
    }

    // Validate the required fields exist
    if (
      typeof result.summary !== "string" ||
      !Array.isArray(result.surprises) ||
      !Array.isArray(result.tensions) ||
      !Array.isArray(result.blindSpots) ||
      !Array.isArray(result.curveInsights)
    ) {
      throw new Error("Narration output missing required fields");
    }

    return result;
  }

  return { generateNarration };
}
