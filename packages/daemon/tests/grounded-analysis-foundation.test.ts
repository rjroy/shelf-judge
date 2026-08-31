import { describe, expect, test } from "bun:test";
import { createGroundedEvidenceSchemas, createGroundedStreamSchemas } from "@shelf-judge/shared";
import { z } from "zod";
import { createActiveGroundedOperationRegistry } from "../src/services/grounded-analysis/active-operation-registry.js";
import { createGroundedCitationRegistry } from "../src/services/grounded-analysis/citation-registry.js";
import { createGroundedDestinationRegistry } from "../src/services/grounded-analysis/destination-registry.js";
import { createGroundedEvidenceRegistry } from "../src/services/grounded-analysis/evidence-registry.js";
import { createGroundedModelLogger } from "../src/services/grounded-analysis/model-logger.js";
import { GroundedAuthorizationConfigurationError } from "../src/services/grounded-analysis/immutable-schema.js";
import { createGroundedStreamWriter } from "../src/services/grounded-analysis/stream-writer.js";

const featureA = createGroundedEvidenceSchemas({
  evidenceClasses: ["feature-a"] as const,
  dependencyCategories: ["profile"] as const,
  destinations: { "shelf.feature-a.get": z.object({ itemId: z.string() }).strict() },
});
const featureB = createGroundedEvidenceSchemas({
  evidenceClasses: ["feature-b"] as const,
  dependencyCategories: ["profile"] as const,
  destinations: { "shelf.feature-b.get": z.object({ itemId: z.string() }).strict() },
});
const sourceA = { sourceId: "item-1", sourceVersion: "v1", evidenceClass: "feature-a" };

function evidenceRegistry() {
  return createGroundedEvidenceRegistry({
    manifest: {
      manifestId: "feature-a-manifest",
      manifestVersion: "v1",
      evidence: {
        "feature-a": z.object({ nested: z.object({ score: z.number() }).strict() }).strict(),
      },
    },
    evidenceIdentitySchema: featureA.EvidenceIdentitySchema,
    expectedSources: [sourceA],
  });
}

describe("grounded evidence, citation, and destination registries", () => {
  test("keeps feature manifests isolated and requires complete examination", () => {
    const registry = evidenceRegistry();
    expect(() =>
      registry.recordExamined({
        sourceId: "item-2",
        sourceVersion: "v1",
        evidenceClass: "feature-b",
      }),
    ).toThrow();
    expect(() => registry.complete()).toThrow("Every expected evidence source must be examined");

    registry.recordExamined(sourceA);
    expect(() =>
      registry.add({
        citationId: "wrong-feature",
        sourceId: "item-1",
        sourceVersion: "v1",
        evidenceClass: "feature-b",
        payload: { nested: { score: 1 } },
      }),
    ).toThrow();
  });

  test("returns immutable exact-version evidence and citations", () => {
    const registry = evidenceRegistry();
    registry.recordExamined(sourceA);
    registry.add({ ...sourceA, citationId: "citation-1", payload: { nested: { score: 7 } } });
    const evidence = registry.complete();
    expect(evidence.resolve("citation-1")?.payload).toEqual({ nested: { score: 7 } });
    expect(Object.isFrozen(evidence.entries)).toBe(true);
    expect(Object.isFrozen((evidence.entries[0]?.payload as { nested: object }).nested)).toBe(true);

    const citations = createGroundedCitationRegistry({
      citationSchema: featureA.CitationSchema,
      evidence,
    });
    expect(() =>
      citations.add({
        ...sourceA,
        citationId: "citation-1",
        sourceVersion: "v2",
        canonicalSummary: "summary",
        destination: { operationId: "shelf.feature-a.get", parameters: { itemId: "item-1" } },
      }),
    ).toThrow("exact registered evidence version");
    const citation = citations.add({
      ...sourceA,
      citationId: "citation-1",
      canonicalSummary: "summary",
      destination: { operationId: "shelf.feature-a.get", parameters: { itemId: "item-1" } },
    });
    expect(Object.isFrozen(citation.destination)).toBe(true);
    expect(citations.complete(["citation-1"])).toEqual([citation]);
  });

  test("only accepts destinations from its feature schema", () => {
    const destinations = createGroundedDestinationRegistry({
      destinationSchema: featureA.DestinationSchema,
    });
    expect(
      destinations.validate({
        operationId: "shelf.feature-a.get",
        parameters: { itemId: "item-1" },
      }),
    ).toEqual({ operationId: "shelf.feature-a.get", parameters: { itemId: "item-1" } });
    expect(() =>
      destinations.validate({
        operationId: "shelf.feature-b.get",
        parameters: { itemId: "item-1" },
      }),
    ).toThrow();
    expect(
      featureB.DestinationSchema.safeParse({
        operationId: "shelf.feature-a.get",
        parameters: { itemId: "item-1" },
      }).success,
    ).toBe(false);
  });

  test("snapshots authorization and rejects unknown registry entry fields", () => {
    const payloadSchema = z.object({ value: z.number() }).strict();
    const evidence: Record<string, z.ZodType<unknown>> = { "feature-a": payloadSchema };
    const manifest = { manifestId: "feature-a", manifestVersion: "v1", evidence };
    const registry = createGroundedEvidenceRegistry({
      manifest,
      evidenceIdentitySchema: featureA.EvidenceIdentitySchema,
      expectedSources: [sourceA],
    });
    manifest.manifestId = "feature-b";
    manifest.manifestVersion = "v2";
    evidence["feature-b"] = z.object({ value: z.number() }).strict();
    expect(Object.isFrozen(payloadSchema)).toBe(true);
    registry.recordExamined(sourceA);
    expect(() =>
      registry.add({
        ...sourceA,
        citationId: "citation-extra",
        payload: { value: 1 },
        leaked: "must-not-be-dropped",
      }),
    ).toThrow();
    expect(() =>
      registry.add({
        sourceId: "item-1",
        sourceVersion: "v1",
        evidenceClass: "feature-b",
        citationId: "citation-b",
        payload: { value: 1 },
      }),
    ).toThrow();
    const destinationSchema = createGroundedEvidenceSchemas({
      evidenceClasses: ["mutable"] as const,
      dependencyCategories: ["profile"] as const,
      destinations: { "shelf.mutable.get": z.object({ itemId: z.string() }).strict() },
    }).DestinationSchema;
    const destinationOptions: { destinationSchema: z.ZodType<unknown> } = { destinationSchema };
    const destinations = createGroundedDestinationRegistry(destinationOptions);
    destinationOptions.destinationSchema = featureB.DestinationSchema;
    expect(Object.isFrozen(destinationSchema)).toBe(true);
    expect(
      destinations.validate({
        operationId: "shelf.mutable.get",
        parameters: { itemId: "item-1" },
      }),
    ).toEqual({ operationId: "shelf.mutable.get", parameters: { itemId: "item-1" } });
    expect(() =>
      destinations.validate({
        operationId: "shelf.feature-b.get",
        parameters: { itemId: "item-1" },
      }),
    ).toThrow();
    expect(() =>
      destinations.validate({
        operationId: "shelf.mutable.get",
        parameters: { itemId: "item-1" },
        leaked: true,
      }),
    ).toThrow();

    registry.add({ ...sourceA, citationId: "citation-1", payload: { value: 1 } });
    const evidenceSnapshot = registry.complete();
    expect(evidenceSnapshot).toMatchObject({
      manifestId: "feature-a",
      manifestVersion: "v1",
      evidenceClasses: ["feature-a"],
    });
    const citationSchema = featureA.CitationSchema;
    const citationOptions = {
      citationSchema,
      evidence: evidenceSnapshot,
    };
    const citations = createGroundedCitationRegistry(citationOptions);
    Object.defineProperty(citationOptions, "citationSchema", {
      value: featureB.CitationSchema,
    });
    expect(Object.isFrozen(citationSchema)).toBe(true);
    expect(() =>
      citations.add({
        ...sourceA,
        citationId: "citation-1",
        canonicalSummary: "summary",
        destination: { operationId: "shelf.feature-a.get", parameters: { itemId: "item-1" } },
        leaked: true,
      }),
    ).toThrow();
    expect(
      citations.add({
        ...sourceA,
        citationId: "citation-1",
        canonicalSummary: "summary",
        destination: { operationId: "shelf.feature-a.get", parameters: { itemId: "item-1" } },
      }),
    ).toMatchObject({ evidenceClass: "feature-a" });
  });

  test("rejects mutable refinement closures and nested executable evidence schemas", () => {
    let authorized = false;
    const mutableRefinement = z.string().refine(() => authorized);
    let configurationFailure: unknown;
    try {
      createGroundedEvidenceRegistry({
        manifest: {
          manifestId: "effectful",
          manifestVersion: "v1",
          evidence: { "feature-a": z.object({ value: mutableRefinement }).strict() },
        },
        evidenceIdentitySchema: featureA.EvidenceIdentitySchema,
        expectedSources: [sourceA],
      });
    } catch (error) {
      configurationFailure = error;
    }
    expect(configurationFailure).toBeInstanceOf(GroundedAuthorizationConfigurationError);
    expect(configurationFailure).toMatchObject({
      code: "unsupported-authorization-schema",
      safeDetail: "unsupported-schema-kind",
    });
    authorized = true;
    expect(authorized).toBe(true);

    expect(() =>
      createGroundedEvidenceRegistry({
        manifest: {
          manifestId: "nested-transform",
          manifestVersion: "v1",
          evidence: {
            "feature-a": z
              .object({
                nested: z.object({ value: z.string().transform((value) => value) }).strict(),
              })
              .strict(),
          },
        },
        evidenceIdentitySchema: featureA.EvidenceIdentitySchema,
        expectedSources: [sourceA],
      }),
    ).toThrow(GroundedAuthorizationConfigurationError);
  });

  test.each([
    ["preprocess", z.preprocess((value) => value, z.string())],
    ["lazy", z.lazy(() => z.string())],
    ["custom", z.custom<string>(() => true)],
    ["coerce", z.coerce.string()],
    ["default", z.string().default(() => "mutable")],
    ["catch", z.string().catch(() => "mutable")],
    ["pipeline", z.string().pipe(z.string().transform((value) => value))],
  ] as const)("rejects nested executable %s authorization schemas", (_kind, executable) => {
    expect(() =>
      createGroundedEvidenceRegistry({
        manifest: {
          manifestId: "unsupported",
          manifestVersion: "v1",
          evidence: {
            "feature-a": z.object({ nested: z.object({ value: executable }).strict() }).strict(),
          },
        },
        evidenceIdentitySchema: featureA.EvidenceIdentitySchema,
        expectedSources: [sourceA],
      }),
    ).toThrow(GroundedAuthorizationConfigurationError);
  });

  test("rejects non-strict nested structural object schemas", () => {
    expect(() =>
      createGroundedEvidenceRegistry({
        manifest: {
          manifestId: "non-strict",
          manifestVersion: "v1",
          evidence: { "feature-a": z.object({ nested: z.object({ value: z.string() }) }).strict() },
        },
        evidenceIdentitySchema: featureA.EvidenceIdentitySchema,
        expectedSources: [sourceA],
      }),
    ).toThrow("non-strict-object");
  });

  test("rejects nested executable citation and destination parameter schemas", () => {
    let authorized = false;
    const effectfulSchemas = createGroundedEvidenceSchemas({
      evidenceClasses: ["feature-a"] as const,
      dependencyCategories: ["profile"] as const,
      destinations: {
        "shelf.effectful.get": z.object({ itemId: z.string().refine(() => authorized) }).strict(),
      },
    });
    const registry = evidenceRegistry();
    registry.recordExamined(sourceA);
    registry.add({ ...sourceA, citationId: "citation-1", payload: { nested: { score: 1 } } });
    const evidence = registry.complete();

    expect(() =>
      createGroundedDestinationRegistry({
        destinationSchema: effectfulSchemas.DestinationSchema,
      }),
    ).toThrow(GroundedAuthorizationConfigurationError);
    expect(() =>
      createGroundedCitationRegistry({
        citationSchema: effectfulSchemas.CitationSchema,
        evidence,
      }),
    ).toThrow(GroundedAuthorizationConfigurationError);
    authorized = true;
    expect(authorized).toBe(true);
  });

  test("captures citation evidence identities before options or entries can change", () => {
    const originalEntry = {
      ...sourceA,
      citationId: "citation-1",
      payload: { value: 1 },
    };
    const originalEvidence = {
      manifestId: "feature-a-manifest",
      manifestVersion: "v1",
      evidenceClasses: ["feature-a"],
      examinedSources: [sourceA],
      entries: [originalEntry],
      hasSource: () => true,
      resolve: () => originalEntry,
    };
    const replacementEntry = {
      ...originalEntry,
      sourceVersion: "replacement-version",
    };
    const replacementEvidence = {
      manifestId: "feature-a-manifest",
      manifestVersion: "replacement-version",
      evidenceClasses: ["feature-a"],
      examinedSources: [sourceA],
      entries: [replacementEntry],
      hasSource: () => true,
      resolve: () => replacementEntry,
    };
    const options = {
      citationSchema: featureA.CitationSchema,
      evidence: originalEvidence,
    };
    const citations = createGroundedCitationRegistry(options);
    options.evidence = replacementEvidence;
    originalEntry.sourceVersion = "mutated-version";
    originalEvidence.resolve = () => replacementEntry;

    expect(() =>
      citations.add({
        ...sourceA,
        sourceVersion: "replacement-version",
        citationId: "citation-1",
        canonicalSummary: "replacement",
        destination: { operationId: "shelf.feature-a.get", parameters: { itemId: "item-1" } },
      }),
    ).toThrow("exact registered evidence version");
    expect(
      citations.add({
        ...sourceA,
        citationId: "citation-1",
        canonicalSummary: "original",
        destination: { operationId: "shelf.feature-a.get", parameters: { itemId: "item-1" } },
      }),
    ).toMatchObject({ sourceVersion: "v1" });
  });
});

describe("active grounded operation lifecycle", () => {
  const capability = "a".repeat(64);
  const input = {
    operationId: "operation-1",
    batchId: "batch-1",
    requestId: "request-1",
    capability,
    feature: "feature-a",
  };

  test("rejects duplicate operations and transport replacement, and aborts once", () => {
    const registry = createActiveGroundedOperationRegistry({
      now: () => "2026-08-30T00:00:00.000Z",
    });
    const operation = registry.start(input);
    let aborts = 0;
    operation.signal.addEventListener("abort", () => aborts++);
    expect(() => registry.start(input)).toThrow("already registered");
    const transport = registry.claimTransport(input.operationId, "transport-1");
    expect(() => registry.claimTransport(input.operationId, "transport-2")).toThrow(
      "replaced or reattached",
    );
    expect(registry.cancel(input.operationId, "b".repeat(64))).toBe(false);
    expect(registry.cancel(input.operationId, capability)).toBe(true);
    expect(registry.cancel(input.operationId, capability)).toBe(false);
    expect(aborts).toBe(1);
    expect(registry.discover()).toEqual([
      {
        operationId: "operation-1",
        batchId: "batch-1",
        requestId: "request-1",
        feature: "feature-a",
        state: "terminal",
        startedAt: "2026-08-30T00:00:00.000Z",
        terminalAt: "2026-08-30T00:00:00.000Z",
        outcome: "cancelled",
      },
    ]);
    expect(registry.cleanup(input.operationId)).toBe(false);
    transport.release();
    expect(registry.cleanup(input.operationId)).toBe(true);
  });

  test("terminalizes and aborts when the owning transport disconnects", () => {
    const registry = createActiveGroundedOperationRegistry();
    const operation = registry.start(input);
    const transport = registry.claimTransport(input.operationId, "transport-1");
    transport.release();
    expect(operation.signal.aborted).toBe(true);
    expect(registry.discover()[0]?.outcome).toBe("transport-lost");
    expect(() => registry.claimTransport(input.operationId, "transport-2")).toThrow();
  });

  test("binds the owning request disconnect signal to the provider abort", () => {
    const registry = createActiveGroundedOperationRegistry();
    const operation = registry.start(input);
    const request = new AbortController();
    registry.claimTransport(input.operationId, "transport-1", request.signal);

    request.abort();

    expect(operation.signal.aborted).toBe(true);
    expect(registry.discover()[0]).toMatchObject({
      state: "terminal",
      outcome: "transport-lost",
    });
    expect(() => registry.claimTransport(input.operationId, "transport-2")).toThrow();
    expect(registry.cleanup(input.operationId)).toBe(true);
  });

  test("preserves cancellation when provider completion loses the terminal race", () => {
    const registry = createActiveGroundedOperationRegistry();
    const operation = registry.start(input);
    let aborts = 0;
    operation.signal.addEventListener("abort", () => aborts++);
    expect(registry.cancel(input.operationId, capability)).toBe(true);
    expect(registry.terminalize(input.operationId, "completed")).toBe(false);
    expect(registry.discover()[0]?.outcome).toBe("cancelled");
    expect(aborts).toBe(1);
  });

  test("preserves completion when cancellation loses the terminal race", () => {
    const registry = createActiveGroundedOperationRegistry();
    const operation = registry.start(input);
    const transport = registry.claimTransport(input.operationId, "transport-1");
    expect(registry.terminalize(input.operationId, "completed")).toBe(true);
    expect(registry.cancel(input.operationId, capability)).toBe(false);
    expect(operation.signal.aborted).toBe(false);
    expect(registry.discover()[0]?.outcome).toBe("completed");
    expect(registry.terminalize(input.operationId, "failed")).toBe(false);
    transport.release();
    expect(registry.cleanup(input.operationId)).toBe(true);
  });

  test("reserves terminalization across asynchronous work and commits the matching outcome", () => {
    const registry = createActiveGroundedOperationRegistry();
    const operation = registry.start(input);
    const transport = registry.claimTransport(input.operationId, "transport-1");
    let aborts = 0;
    operation.signal.addEventListener("abort", () => aborts++);

    const reservation = registry.reserveTerminal(input.operationId);
    if (!reservation) throw new Error("Expected terminal reservation");
    expect(registry.reserveTerminal(input.operationId)).toBeUndefined();
    expect(registry.cancel(input.operationId, capability)).toBe(false);
    expect(registry.terminalize(input.operationId, "completed")).toBe(false);
    expect(registry.commitTerminal({ operationId: input.operationId }, "completed")).toBe(false);
    expect(registry.commitTerminal(reservation, "completed")).toBe(true);
    expect(registry.commitTerminal(reservation, "failed")).toBe(false);
    expect(operation.signal.aborted).toBe(false);
    expect(aborts).toBe(0);
    expect(registry.discover()[0]?.outcome).toBe("completed");

    transport.release();
    expect(registry.cleanup(input.operationId)).toBe(true);
  });

  test("commits a reserved failure with exactly one abort", () => {
    const registry = createActiveGroundedOperationRegistry();
    const operation = registry.start(input);
    let aborts = 0;
    operation.signal.addEventListener("abort", () => aborts++);
    const reservation = registry.reserveTerminal(input.operationId);
    if (!reservation) throw new Error("Expected terminal reservation");

    expect(registry.cancel(input.operationId, capability)).toBe(false);
    expect(registry.commitTerminal(reservation, "failed")).toBe(true);
    expect(registry.commitTerminal(reservation, "failed")).toBe(false);
    expect(operation.signal.aborted).toBe(true);
    expect(aborts).toBe(1);
    expect(registry.discover()[0]?.outcome).toBe("failed");
  });
});

describe("grounded stream writer", () => {
  const stream = createGroundedStreamSchemas([
    { type: "progress", terminal: false, payload: { count: z.number().int().min(0) } },
    { type: "complete", terminal: true, payload: { resultId: z.string().min(1) } },
  ] as const);

  test("validates, sequences, and terminalizes NDJSON events", async () => {
    const output: string[] = [];
    const writer = createGroundedStreamWriter({
      operationId: "operation-1",
      eventSchema: stream.EventSchema,
      encoding: "ndjson",
      write: (value) => {
        output.push(value);
      },
      now: () => "2026-08-30T00:00:00.000Z",
    });
    await writer.write({ type: "progress", terminal: false, count: 1 });
    await writer.write({ type: "complete", terminal: true, resultId: "result-1" });
    writer.close();
    expect(output.map((value) => JSON.parse(value) as unknown)).toMatchObject([
      { sequence: 0, type: "progress", count: 1 },
      { sequence: 1, type: "complete", resultId: "result-1" },
    ]);
    let terminalError: unknown;
    try {
      await writer.write({ type: "progress", terminal: false, count: 2 });
    } catch (error) {
      terminalError = error;
    }
    expect(terminalError).toBeInstanceOf(Error);
  });

  test.each(["sse", "ndjson"] as const)(
    "requires one terminal event before closing a %s stream",
    async (encoding) => {
      const output: string[] = [];
      const writer = createGroundedStreamWriter({
        operationId: "operation-1",
        eventSchema: stream.EventSchema,
        encoding,
        write: (value) => {
          output.push(value);
        },
      });
      await writer.write({ type: "progress", terminal: false, count: 1 });
      expect(() => writer.close()).toThrow("without one terminal event");
      await writer.write({ type: "complete", terminal: true, resultId: "result-1" });
      writer.close();
      expect(output).toHaveLength(2);
      expect(() => writer.close()).toThrow("already closed");
    },
  );

  test("captures stream ownership and validation options at construction", async () => {
    const originalOutput: string[] = [];
    const replacementOutput: string[] = [];
    const options = {
      operationId: "original-operation",
      eventSchema: stream.EventSchema,
      encoding: "sse" as const,
      write: (value: string) => {
        originalOutput.push(value);
      },
    };
    const writer = createGroundedStreamWriter(options);
    Object.defineProperties(options, {
      operationId: { value: "replacement-operation" },
      encoding: { value: "ndjson" },
      eventSchema: {
        value: z
          .object({
            version: z.literal(1),
            operationId: z.string(),
            sequence: z.number(),
            occurredAt: z.string(),
            type: z.literal("leaked"),
            terminal: z.literal(false),
            payload: z.string(),
          })
          .strict(),
      },
      write: {
        value: (value: string) => {
          replacementOutput.push(value);
        },
      },
    });

    let validationError: unknown;
    try {
      await writer.write({ type: "leaked", terminal: false, payload: "secret" } as never);
    } catch (error) {
      validationError = error;
    }
    expect(validationError).toBeInstanceOf(Error);
    await writer.write({ type: "progress", terminal: false, count: 1 });
    await writer.write({ type: "complete", terminal: true, resultId: "result-1" });
    writer.close();
    expect(originalOutput).toHaveLength(2);
    expect(originalOutput[0]).toStartWith("event: progress\n");
    expect(originalOutput.join("\n")).toContain('"operationId":"original-operation"');
    expect(replacementOutput).toEqual([]);
  });

  test("rejects envelope overrides and non-schema provider data", async () => {
    const writer = createGroundedStreamWriter({
      operationId: "operation-1",
      eventSchema: stream.EventSchema,
      encoding: "sse",
      write: () => undefined,
    });
    let sensitiveError: unknown;
    try {
      await writer.write({
        type: "progress",
        terminal: false,
        count: 1,
        prompt: "owner text",
      } as never);
    } catch (error) {
      sensitiveError = error;
    }
    expect(sensitiveError).toBeInstanceOf(Error);

    let envelopeError: unknown;
    try {
      await writer.write({
        type: "progress",
        terminal: false,
        count: 1,
        sequence: 99,
      } as never);
    } catch (error) {
      envelopeError = error;
    }
    expect(envelopeError).toBeInstanceOf(Error);
    expect((envelopeError as Error).message).toContain("cannot set sequence");
  });
});

describe("grounded model logger", () => {
  const base = {
    occurredAt: "2026-08-30T00:00:00.000Z",
    operationId: "operation-1",
    batchId: "batch-1",
    requestId: "request-1",
    feature: "feature-a",
    trigger: "owner-request",
    configuration: {
      status: "configured" as const,
      identity: {
        providerId: "provider-1",
        modelId: "model-1",
        extensionIds: ["extension-1"],
      },
    },
    evidenceManifestId: "feature-a-manifest",
    evidenceManifestVersion: "v1",
    evidenceClassCounts: [{ evidenceClass: "feature-a", count: 1 }],
    evidenceIdentityHash: "c".repeat(64),
  };

  test("emits immutable allowlisted attempt and outcome records", () => {
    const records: unknown[] = [];
    const logger = createGroundedModelLogger({ write: (record) => records.push(record) });
    const attempt = logger.attempt({ ...base, recordType: "grounded-model-attempt" });
    logger.outcome({
      ...base,
      recordType: "grounded-model-outcome",
      outcome: "completed",
      durationMs: 12,
      usage: { state: "unavailable" },
      validation: "accepted",
      cacheTransition: "written",
    });
    expect(records).toHaveLength(2);
    expect(Object.isFrozen(attempt.configuration)).toBe(true);
  });

  test("rejects prompts, evidence payloads, provider text, and arbitrary errors", () => {
    const logger = createGroundedModelLogger({ write: () => undefined });
    for (const sensitive of [
      { prompt: "owner text" },
      { evidencePayload: { notes: "owner text" } },
      { providerOutput: "raw model response" },
      { rawProviderEvent: { content: "raw model response" } },
      { toolArguments: { notes: "owner text" } },
      { apiKey: "secret" },
      { error: new Error("secret") },
    ]) {
      expect(() =>
        logger.attempt({ ...base, recordType: "grounded-model-attempt", ...sensitive }),
      ).toThrow();
    }
  });

  test("rejects duplicate evidence-class summaries", () => {
    const logger = createGroundedModelLogger({ write: () => undefined });
    expect(() =>
      logger.attempt({
        ...base,
        recordType: "grounded-model-attempt",
        evidenceClassCounts: [
          { evidenceClass: "feature-a", count: 1 },
          { evidenceClass: "feature-a", count: 2 },
        ],
      }),
    ).toThrow("Logged evidence classes must be unique");
  });

  test("enforces attempt then at most one matching outcome", () => {
    const logger = createGroundedModelLogger({ write: () => undefined });
    const attempt = { ...base, recordType: "grounded-model-attempt" };
    const outcome = {
      ...base,
      recordType: "grounded-model-outcome",
      outcome: "completed",
      durationMs: 1,
      usage: { state: "unavailable" },
      validation: "accepted",
      cacheTransition: "none",
    };
    expect(() => logger.outcome(outcome)).toThrow("requires a prior attempt");
    logger.attempt(attempt);
    expect(() => logger.attempt(attempt)).toThrow("already registered");
    expect(() => logger.outcome({ ...outcome, feature: "feature-b" })).toThrow("does not match");
    logger.outcome(outcome);
    expect(() => logger.outcome(outcome)).toThrow("already registered");
  });
});
