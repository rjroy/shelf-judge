import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { GameService } from "../services/game-service";
import type { BggClient } from "../services/bgg-client";
import type { RouteModule, OperationDefinition } from "../operations";
import { createLogger } from "../services/logger";

export interface ImportRoutesDeps {
  gameService: GameService;
  bggClient?: BggClient;
}

const ImportBodySchema = z.object({
  username: z.string().min(1, "Username is required"),
});

export function createImportRoutes(deps: ImportRoutesDeps): RouteModule {
  const { gameService, bggClient } = deps;
  const logger = createLogger("route");
  const routes = new Hono();

  // POST /import/bgg
  routes.post("/import/bgg", async (c) => {
    if (!bggClient || !bggClient.isConfigured()) {
      return c.json(
        {
          error:
            "BGG integration is not configured. Register at https://boardgamegeek.com/using_the_xml_api and run `shelf-judge config set bgg-token YOUR_TOKEN`.",
        },
        503,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = ImportBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
    }

    const { username } = parsed.data;
    logger.log(`POST /import/bgg for "${username}"`);

    return streamSSE(
      c,
      async (stream) => {
        const summary = await gameService.importBggCollection(async (event) => {
          await stream.writeSSE({
            event: "progress",
            data: JSON.stringify({
              imported: event.importedSoFar,
              total: event.total,
              current: event.gameName ?? "",
            }),
          });
        });

        logger.log(
          `import complete: ${summary.imported} imported, ${summary.skipped} skipped, ${summary.errors.length} errors`,
        );
        await stream.writeSSE({
          event: "complete",
          data: JSON.stringify({
            imported: summary.imported,
            skipped: summary.skipped,
            errors: summary.errors,
          }),
        });
      },
      async (err, stream) => {
        logger.error(`import error: ${err.message}`);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            error: err.message,
          }),
        });
      },
    );
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.import.bgg-collection",
      name: "bgg-collection",
      description: "Import owned games from a BGG user's collection",
      invocation: { method: "POST", path: "/api/import/bgg" },
      hierarchy: { root: "shelf", feature: "import" },
      idempotent: false,
    },
  ];

  return { routes, operations };
}
