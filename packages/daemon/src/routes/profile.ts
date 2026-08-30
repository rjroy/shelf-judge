import { Hono } from "hono";
import {
  CollectionProfileEntityPolicySchema,
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  createCollectionProfileResultSchema,
  toErrorMessage,
} from "@shelf-judge/shared";
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
      const entityPolicy =
        profile.status === "available"
          ? CollectionProfileEntityPolicySchema.parse(profile.entityPolicy)
          : DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY;
      const validatedProfile = createCollectionProfileResultSchema(entityPolicy).parse(profile);
      return c.json(validatedProfile);
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
