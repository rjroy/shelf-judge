import { describe, expect, test } from "bun:test";
import { createAnalystEvidenceService } from "../../src/services/analyst-evidence-service.js";
import type { AnalystProjectionSnapshot } from "../../src/services/analyst-evidence-projections.js";

const fingerprint = "fixed-revision";
const alphaPayload = {
  gameId: "a",
  displayName: "Alpha",
  bggId: 1,
  ownershipState: "owned" as const,
};
const snapshot: AnalystProjectionSnapshot = Object.freeze({
  collectionId: "collection-1",
  collectionRevision: 7,
  snapshotFingerprint: fingerprint,
  sources: Object.freeze([
    Object.freeze({
      evidenceClass: "game-identity-ownership" as const,
      sourceId: "game:a:identity",
      sourceVersion: "one",
      citationId: "a",
      payload: alphaPayload,
      canonicalSummary: "Current game identity and ownership state",
      destination: { operationId: "shelf.game.get" as const, parameters: { gameId: "a" } },
    }),
    Object.freeze({
      evidenceClass: "game-identity-ownership" as const,
      sourceId: "game:b:identity",
      sourceVersion: "two",
      citationId: "b",
      payload: { gameId: "b", displayName: "Beta", bggId: 2, ownershipState: "owned" as const },
      canonicalSummary: "Current game identity and ownership state",
      destination: { operationId: "shelf.game.get" as const, parameters: { gameId: "b" } },
    }),
  ]),
  page: () => {
    throw new Error("not used by retrieval");
  },
});

describe("Analyst evidence retrieval", () => {
  test("registers only returned evidence and binds pages to the captured revision", () => {
    const service = createAnalystEvidenceService({
      storageService: {},
      projectionSnapshotService: { capture: () => Promise.resolve(snapshot) },
    });
    const first = service.retrieve(snapshot, {
      snapshotFingerprint: fingerprint,
      evidenceClasses: ["game-identity-ownership"],
      limit: 1,
    });
    expect(first.evidence.entries.map(({ citationId }) => citationId)).toEqual(["a"]);
    expect(first.scope).toEqual({
      totalSourceCount: 2,
      matchingSourceCount: 2,
      examinedSourceCount: 1,
      exhaustive: false,
    });
    const second = service.retrieve(snapshot, {
      snapshotFingerprint: fingerprint,
      evidenceClasses: ["game-identity-ownership"],
      cursor: first.nextCursor,
    });
    expect(second.evidence.entries.map(({ citationId }) => citationId)).toEqual(["b"]);
    expect(second.scope.examinedSourceCount).toBe(2);
    expect(second.scope.exhaustive).toBe(true);
    expect(() =>
      service.retrieve(snapshot, {
        snapshotFingerprint: fingerprint,
        evidenceClasses: ["game-identity-ownership"],
        cursor: { ...first.nextCursor, snapshotFingerprint: "other" },
      }),
    ).toThrow("different snapshot");
  });

  test("rejects forged, cross-scope and cross-turn continuations without claiming coverage", () => {
    const service = createAnalystEvidenceService({
      storageService: {},
      projectionSnapshotService: { capture: () => Promise.resolve(snapshot) },
    });
    const request = {
      snapshotFingerprint: fingerprint,
      evidenceClasses: ["game-identity-ownership"],
      limit: 1,
    };
    expect(() =>
      service.retrieve(snapshot, {
        ...request,
        cursor: { snapshotFingerprint: fingerprint, token: crypto.randomUUID() },
      }),
    ).toThrow("invalid for this scope");
    expect(() =>
      service.retrieve(snapshot, {
        ...request,
        cursor: { snapshotFingerprint: fingerprint, offset: 1 },
      }),
    ).toThrow();
    const first = service.retrieve(snapshot, request);
    expect(() =>
      service.retrieve(snapshot, { ...request, gameIds: ["b"], cursor: first.nextCursor }),
    ).toThrow("invalid for this scope");
    expect(() =>
      service.retrieve({ ...snapshot }, { ...request, cursor: first.nextCursor }),
    ).toThrow("invalid for this scope");
    expect(service.retrieve(snapshot, request).scope).toMatchObject({
      examinedSourceCount: 1,
      exhaustive: false,
    });
    expect(
      service.retrieve(snapshot, { ...request, cursor: first.nextCursor }).scope,
    ).toMatchObject({ examinedSourceCount: 2, exhaustive: true });
    expect(
      service.retrieve(snapshot, { ...request, cursor: first.nextCursor }).scope
        .examinedSourceCount,
    ).toBe(2);
  });

  test("matches game IDs exactly and rejects field selection and unbounded pages", () => {
    const service = createAnalystEvidenceService({
      storageService: {},
      projectionSnapshotService: { capture: () => Promise.resolve(snapshot) },
    });
    const request = {
      snapshotFingerprint: fingerprint,
      evidenceClasses: ["game-identity-ownership"],
    };
    expect(
      service
        .retrieve(snapshot, { ...request, gameIds: ["b"] })
        .citations.map(({ citationId }) => citationId),
    ).toEqual(["b"]);
    expect(service.retrieve(snapshot, { ...request, gameIds: ["missing"] }).scope).toMatchObject({
      matchingSourceCount: 0,
      examinedSourceCount: 0,
      exhaustive: true,
    });
    for (const extra of [
      { fields: ["wishlist"] },
      { limit: 101 },
      { limit: 0 },
      { evidenceClasses: ["owner-game-note"] },
      { gameIds: ["a", "a"] },
      { evidenceClasses: ["profile-evidence"], gameIds: ["a"] },
      { evidenceClasses: ["profile-evidence"], gameIds: [] },
    ]) {
      expect(() => service.retrieve(snapshot, { ...request, ...extra })).toThrow();
    }
  });

  test("rejects unauthorized fields rather than serializing a broad game object", () => {
    const service = createAnalystEvidenceService({
      storageService: {},
      projectionSnapshotService: { capture: () => Promise.resolve(snapshot) },
    });
    const unsafe = {
      ...snapshot,
      sources: [{ ...snapshot.sources[0], payload: { ...alphaPayload, wishlist: true } }],
    } as AnalystProjectionSnapshot;
    expect(() =>
      service.retrieve(unsafe, {
        snapshotFingerprint: fingerprint,
        evidenceClasses: ["game-identity-ownership"],
      }),
    ).toThrow();
  });
});
