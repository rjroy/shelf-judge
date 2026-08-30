import { describe, expect, test } from "bun:test";
import {
  CollectionProfileResultSchema,
  DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
  type CollectionProfile,
  type CollectionProfileResult,
} from "@shelf-judge/shared";
import {
  canonicalUsefulProfileFixtures,
  usefulProfileFixture,
} from "../../../shared/tests/fixtures/useful-profile.js";
import { createProfileRoutes } from "../../src/routes/profile.js";
import { createTestApp, jsonRequest } from "../helpers/test-app.js";

const malformedProfileCases: ReadonlyArray<
  readonly [string, (profile: CollectionProfile) => void]
> = [
  [
    "legacy rating ordering",
    (profile) => {
      const orderings = profile.identity.classes.mechanic.orderings;
      Reflect.set(orderings, "rating", orderings.bestFit);
      Reflect.deleteProperty(orderings, "bestFit");
    },
  ],
  [
    "missing adjusted value",
    (profile) => {
      Reflect.deleteProperty(
        profile.identity.classes.mechanic.entities[0],
        "adjustedMeanCurrentFitness",
      );
    },
  ],
  [
    "forged adjusted value",
    (profile) => {
      profile.identity.classes.mechanic.entities[0].adjustedMeanCurrentFitness += 1;
    },
  ],
  [
    "wrong best-fit order",
    (profile) => {
      profile.identity.classes.mechanic.orderings.bestFit.reverse();
    },
  ],
  [
    "unsupported overview entity",
    (profile) => {
      profile.identity.classes.mechanic.overviewEntityIds = [102];
    },
  ],
];

function expectHttp500ErrorEnvelope(body: unknown): void {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Expected an HTTP 500 error envelope");
  }

  expect(Object.keys(body)).toEqual(["error"]);
  if (!("error" in body)) throw new Error("Expected an error field");
  expect(typeof body.error).toBe("string");
}

describe("profile routes", () => {
  test.each(canonicalUsefulProfileFixtures)(
    "passes through and contract-validates the canonical %s fixture",
    async (_label, fixture) => {
      const { routes } = createProfileRoutes({
        profileService: { getProfile: () => Promise.resolve(structuredClone(fixture)) },
      });
      const response = await routes.request("/profile");
      const parsed: CollectionProfileResult = CollectionProfileResultSchema.parse(
        await response.json(),
      );

      expect(response.status).toBe(200);
      expect(parsed).toEqual(fixture);
    },
  );

  test("GET /api/profile passes through the complete useful profile", async () => {
    const ctx = createTestApp();
    const response = await jsonRequest(ctx.app, "GET", "/api/profile");
    const profile = CollectionProfileResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(profile.status).toBe("available");
    if (profile.status !== "available") throw new Error("Expected available profile");
    expect(Object.keys(profile.identity.classes)).toEqual(["mechanic", "designer", "artist"]);
    for (const result of Object.values(profile.identity.classes)) {
      expect(result.orderings).toEqual({ bestFit: [], support: [], name: [] });
    }
  });

  test("validates an available result with its embedded entity policy", async () => {
    const profile = structuredClone(usefulProfileFixture);
    profile.identity.classes.mechanic.result = "limited";
    profile.identity.classes.mechanic.entities[0].support = "limited";
    profile.identity.classes.mechanic.entities[1].adjustedMeanCurrentFitness = 16 / 3;
    profile.identity.classes.mechanic.overviewEntityIds = [];
    profile.entityPolicy = {
      ...DEFAULT_COLLECTION_PROFILE_ENTITY_POLICY,
      mechanic: { overviewLimit: 3, minimumSupportedGames: 4 },
    };
    const { routes } = createProfileRoutes({
      profileService: { getProfile: () => Promise.resolve(profile) },
    });

    const response = await routes.request("/profile");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(profile);
  });

  test("returns an exact cached response on a second read", async () => {
    const ctx = createTestApp();
    const first: unknown = await (await jsonRequest(ctx.app, "GET", "/api/profile")).json();
    const second: unknown = await (await jsonRequest(ctx.app, "GET", "/api/profile")).json();
    expect(second).toEqual(first);
  });

  test.each(malformedProfileCases)(
    "returns the HTTP 500 envelope for a mocked service result with %s",
    async (_label, mutate) => {
      const profile = structuredClone(usefulProfileFixture);
      mutate(profile);
      const { routes } = createProfileRoutes({
        profileService: {
          getProfile: () => Promise.resolve(profile as CollectionProfileResult),
        },
      });

      const response = await routes.request("/profile");
      const body: unknown = await response.json();

      expect(response.status).toBe(500);
      expectHttp500ErrorEnvelope(body);
    },
  );

  test("returns the HTTP 500 envelope for an invalid embedded entity policy", async () => {
    const profile = {
      ...structuredClone(usefulProfileFixture),
      entityPolicy: {
        ...usefulProfileFixture.entityPolicy,
        mechanic: {
          ...usefulProfileFixture.entityPolicy.mechanic,
          minimumSupportedGames: 0,
        },
      },
    };
    const { routes } = createProfileRoutes({
      profileService: {
        getProfile: () => Promise.resolve(profile),
      },
    });

    const response = await routes.request("/profile");
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expectHttp500ErrorEnvelope(body);
  });
});
