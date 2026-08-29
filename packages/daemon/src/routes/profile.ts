import { Hono } from "hono";
import { toErrorMessage } from "@shelf-judge/shared";
import type { ProfileService } from "../services/profile-service.js";
import type { RouteModule, OperationDefinition } from "../operations.js";

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

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.profile.get",
      name: "get",
      description: "Get the collection profile (recomputes if stale)",
      invocation: { method: "GET", path: "/api/profile" },
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: true,
    },
  ];

  return { routes, operations };
}
