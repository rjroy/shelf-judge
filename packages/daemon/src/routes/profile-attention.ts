import { Hono } from "hono";
import {
  IntentionalAttentionCommandSchema,
  NotNowAttentionCommandSchema,
} from "@shelf-judge/shared";
import type { AttentionDispositionCommandResult } from "@shelf-judge/shared";
import type { OperationDefinition, RouteModule } from "../operations.js";

export interface ProfileAttentionRouteDeps {
  readonly attentionDispositionService: {
    execute(input: unknown): Promise<AttentionDispositionCommandResult>;
  };
}

function statusFor(result: AttentionDispositionCommandResult): 200 | 400 | 404 | 409 | 422 | 503 {
  if (result.outcome !== "rejected") return 200;
  switch (result.error.code) {
    case "validation":
      return 400;
    case "game-not-found":
      return 404;
    case "stale-version":
    case "candidate-mismatch":
    case "command-reuse":
      return 409;
    case "ineligible-game":
      return 422;
    case "persistence-failure":
      return 503;
  }
}

/**
 * Owner responses live beside the Profile read surface, but intentionally do
 * not alter its published card contract before the Phase 5 cutover.
 */
export function createProfileAttentionRoutes(deps: ProfileAttentionRouteDeps): RouteModule {
  const routes = new Hono();
  const execute = async (request: Request, operation: "not-now" | "intentional") => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return { outcome: "rejected", error: { code: "validation" } } as const;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return { outcome: "rejected", error: { code: "validation" } } as const;
    if (!("operation" in body) || body.operation !== operation)
      return { outcome: "rejected", error: { code: "validation" } } as const;
    return deps.attentionDispositionService.execute(body);
  };

  routes.post("/profile/attention/not-now", async (context) => {
    const result = await execute(context.req.raw, "not-now");
    return context.json(result, statusFor(result));
  });
  routes.post("/profile/attention/intentional", async (context) => {
    const result = await execute(context.req.raw, "intentional");
    return context.json(result, statusFor(result));
  });

  const operations: OperationDefinition[] = [
    {
      operationId: "shelf.profile.attention.not-now",
      name: "not-now",
      description: "Snooze the current attention candidate for 720 hours",
      invocation: { method: "POST", path: "/api/profile/attention/not-now" },
      requestSchema: NotNowAttentionCommandSchema,
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: true,
    },
    {
      operationId: "shelf.profile.attention.intentional",
      name: "intentional",
      description: "Mark the current attention candidate as intentional",
      invocation: { method: "POST", path: "/api/profile/attention/intentional" },
      requestSchema: IntentionalAttentionCommandSchema,
      hierarchy: { root: "shelf", feature: "profile" },
      idempotent: true,
    },
  ];
  return { routes, operations };
}
