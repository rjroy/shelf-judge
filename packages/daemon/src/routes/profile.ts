import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import type { ProfileService } from "../services/profile-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";
import { createLogger } from "../services/logger.js";

const logger = createLogger("profile-route");

export interface ProfileRoutesDeps {
  profileService: ProfileService;
}

export function createProfileRoutes(deps: ProfileRoutesDeps): RouteModule {
  const { profileService } = deps;
  const routes = new Hono();

  routes.get("/profile", async (c) => {
    try {
      const profile = await profileService.getProfile();
      return c.json(profile);
    } catch (err) {
      return c.json({ error: toErrorMessage(err) }, 500);
    }
  });

  routes.post("/profile/narrate", async (c) => {
    logger.log("POST /profile/narrate received");
    try {
      const profile = await profileService.generateNarration();
      logger.log("narration generated successfully");
      return c.json(profile);
    } catch (err) {
      logger.error("narration failed:", toErrorMessage(err));
      return c.json({ error: toErrorMessage(err) }, 502);
    }
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.profile.get",
      name: "get",
      description: "Get the collection profile (recomputes if stale)",
      invocation: { method: "GET", path: "/api/profile" },
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: true,
    },
    {
      operationId: "shelf.profile.narrate",
      name: "narrate",
      description: "Generate LLM narration for the collection profile",
      invocation: { method: "POST", path: "/api/profile/narrate" },
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: false,
    },
  ];

  return { routes, operations };
}
