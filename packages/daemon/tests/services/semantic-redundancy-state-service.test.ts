import { describe, expect, test } from "bun:test";
import {
  createInitialSemanticRedundancyState,
  SemanticRedundancyStateSchema,
  semanticDisclosureManifestDigest,
  type Collection,
  type SemanticDisclosureManifest,
  type SemanticSignalScope,
} from "@shelf-judge/shared";
import {
  createCollectionMutationService,
  type CollectionMutationService,
} from "../../src/services/collection-mutation-service.js";
import {
  createSemanticRedundancyStateService,
  type SemanticDisclosureCapture,
} from "../../src/services/semantic-redundancy-state-service.js";
import type {
  CollectionPersistence,
  CollectionReader,
} from "../../src/services/storage-service.js";
import { semanticSourceIdentityFixture } from "../helpers/semantic-redundancy-fixtures.js";

const now = Date.parse("2026-01-01T00:00:00.000Z");
const at = "2026-01-01T00:00:00.000Z";

function collection(): Collection {
  const semanticRedundancy = createInitialSemanticRedundancyState();
  semanticRedundancy.settings = {
    enabled: true,
    weights: { factual: 7, description: 5, ownerNote: 3 },
    cachedOwnerNoteUse: false,
  };
  return {
    schemaVersion: 9,
    revision: 0,
    id: "collection-1",
    name: "Collection",
    axes: [],
    games: [],
    intentions: [],
    attentionDispositions: [],
    commandReceipts: [],
    entertainmentBenchmark: null,
    semanticRedundancy,
    createdAt: at,
    updatedAt: at,
  };
}

function harness(options: { validateSourceIdentity?: () => boolean | Promise<boolean> } = {}) {
  let stored = collection();
  let sourceValid = true;
  let clock = now;
  const storage: CollectionReader & CollectionPersistence = {
    loadCollection: () => Promise.resolve(structuredClone(stored)),
    saveCollection: (next) => {
      stored = structuredClone(next);
      return Promise.resolve();
    },
  };
  const mutations = createCollectionMutationService({ storageService: storage });
  const service = () =>
    createSemanticRedundancyStateService({
      collectionMutationService: mutations,
      now: () => clock,
      validateSourceIdentity: options.validateSourceIdentity ?? (() => sourceValid),
    });
  return {
    mutations,
    service,
    read: () => structuredClone(stored),
    setSourceValid(value: boolean) {
      sourceValid = value;
    },
    setTime(value: number) {
      clock = value;
    },
  };
}

function capture(
  source: Collection,
  options: { eligibleCount?: number; scope?: SemanticSignalScope; expiresAt?: string } = {},
): SemanticDisclosureCapture {
  const eligibleGameIds = Array.from(
    { length: options.eligibleCount ?? 25 },
    (_, index) => `game-${String(index + 1).padStart(2, "0")}`,
  );
  const pairs: SemanticDisclosureManifest["pairs"] = [];
  for (let left = 0; left < eligibleGameIds.length; left += 1) {
    for (let right = left + 1; right < eligibleGameIds.length; right += 1) {
      pairs.push({
        gameA: eligibleGameIds[left],
        gameB: eligibleGameIds[right],
        hasDescriptionA: true,
        hasDescriptionB: true,
        hasOwnerNoteA: options.scope !== "description-only",
        hasOwnerNoteB: options.scope !== "description-only",
        descriptionFingerprintA: "a".repeat(64),
        descriptionFingerprintB: "b".repeat(64),
        noteVersionA: options.scope === "description-only" ? null : 1,
        noteVersionB: options.scope === "description-only" ? null : 1,
      });
    }
  }
  const sourceIdentity = semanticSourceIdentityFixture({
    collectionId: source.id,
    collectionSchemaVersion: source.schemaVersion,
    collectionRevision: source.revision,
    evidenceEpoch: source.semanticRedundancy.evidenceEpoch,
    consentEpoch: source.semanticRedundancy.consentEpoch,
    factualWeightsEpoch: source.semanticRedundancy.factualWeightsEpoch,
    factualWeightsFingerprint: source.semanticRedundancy.factualWeightsFingerprint,
  });
  const unsigned = {
    sourceIdentity,
    scoringVersion: 1,
    signalScope: options.scope ?? "description-only",
    providerId: "test-provider",
    modelId: "pinned-test-model",
    rubricVersion: 1,
    budget: { maxRequests: pairs.length, maxTokens: 1000, maxDurationMs: 60_000 },
    expiresAt: options.expiresAt ?? "2026-01-02T00:00:00.000Z",
    eligibleGameIds,
    pairs,
  };
  return {
    sourceIdentity,
    manifest: {
      id: "disclosure-1",
      digest: semanticDisclosureManifestDigest(unsigned),
      ...unsigned,
    },
  };
}

function page(captureValue: SemanticDisclosureCapture, offset: number, limit = 100) {
  return {
    manifestId: captureValue.manifest.id,
    manifestDigest: captureValue.manifest.digest,
    offset,
    limit,
  };
}

function startInput(captureValue: SemanticDisclosureCapture, commandId = captureValue.manifest.id) {
  return {
    commandId,
    manifestId: captureValue.manifest.id,
    manifestDigest: captureValue.manifest.digest,
    pairCount: captureValue.manifest.pairs.length,
    sourceIdentity: captureValue.sourceIdentity,
    transmissionAuthorized: true,
    noteTransmissionAuthorized: false,
    cachedOwnerNoteUseAuthorized: false,
    deadlineAt: "2026-01-01T00:00:30.000Z",
  };
}

async function disclose(
  harnessValue: ReturnType<typeof harness>,
  value: SemanticDisclosureCapture,
) {
  const result = await harnessValue.service().createDisclosure(value);
  expect(result.outcome).toBe("accepted");
  return harnessValue.service();
}

describe("semantic redundancy disclosure state", () => {
  test("checkpoint and completed finalization reject expiry before and after source validation", async () => {
    let pauseValidation = false;
    let validationStarted!: () => void;
    let finishValidation!: (valid: boolean) => void;
    const validationEntered = new Promise<void>((resolve) => (validationStarted = resolve));
    const validationResult = new Promise<boolean>((resolve) => (finishValidation = resolve));
    const h = harness({
      validateSourceIdentity: () => {
        if (!pauseValidation) return true;
        validationStarted();
        return validationResult;
      },
    });
    const value = capture(h.read(), { eligibleCount: 2 });
    const service = await disclose(h, value);
    await service.deliverDisclosurePage(page(value, 0));
    const started = await service.startExecution(startInput(value));
    expect(started.outcome).toBe("accepted");

    pauseValidation = true;
    const checkpoint = service.checkpointJudgments({
      expected: { evidenceEpoch: 0, consentEpoch: 0 },
      authorizationId: h.read().semanticRedundancy.authorization!.id,
      judgments: [{ gameA: "game-01", gameB: "game-02", description: null, ownerNote: null }],
    });
    await validationEntered;
    h.setTime(Date.parse("2026-01-01T00:00:30.000Z"));
    finishValidation(true);
    expect((await checkpoint).outcome).toBe("not-authorized");
    expect(
      (
        await service.checkpointJudgments({
          expected: { evidenceEpoch: 0, consentEpoch: 0 },
          authorizationId: h.read().semanticRedundancy.authorization!.id,
          judgments: [{ gameA: "game-01", gameB: "game-02", description: null, ownerNote: null }],
        })
      ).outcome,
    ).toBe("not-authorized");

    expect(
      (
        await service.finishExecution({
          commandId: "disclosure-1",
          status: "completed",
          sourceIdentity: value.sourceIdentity,
        })
      ).outcome,
    ).toBe("not-authorized");
    expect(h.read().semanticRedundancy.execution?.status).toBe("running");
  });

  test("completed finalization rechecks the deadline after asynchronous source validation", async () => {
    let pauseValidation = false;
    let validationStarted!: () => void;
    let finishValidation!: (valid: boolean) => void;
    const validationEntered = new Promise<void>((resolve) => (validationStarted = resolve));
    const validationResult = new Promise<boolean>((resolve) => (finishValidation = resolve));
    const h = harness({
      validateSourceIdentity: () => {
        if (!pauseValidation) return true;
        validationStarted();
        return validationResult;
      },
    });
    const value = capture(h.read(), { eligibleCount: 2 });
    const service = await disclose(h, value);
    await service.deliverDisclosurePage(page(value, 0));
    expect((await service.startExecution(startInput(value))).outcome).toBe("accepted");

    pauseValidation = true;
    const finishing = service.finishExecution({
      commandId: "disclosure-1",
      status: "completed",
      sourceIdentity: value.sourceIdentity,
    });
    await validationEntered;
    h.setTime(Date.parse("2026-01-01T00:00:30.000Z"));
    finishValidation(true);
    expect((await finishing).outcome).toBe("not-authorized");
    expect(h.read().semanticRedundancy.execution?.status).toBe("running");
  });

  test("delivers a canonical 3-page manifest with bound receipts and durable exact retry", async () => {
    const h = harness();
    const value = capture(h.read());
    let service = await disclose(h, value);

    const skipped = await service.deliverDisclosurePage(page(value, 100));
    expect(skipped.outcome).toBe("invalid-state");

    const first = await service.deliverDisclosurePage(page(value, 0));
    expect(first.outcome).toBe("accepted");
    if (first.outcome !== "accepted") return;
    expect(first.value.pairs).toHaveLength(100);
    expect(first.value.receipt).toEqual({ pageIndex: 0, nextOffset: 100, complete: false });
    expect(first.value.pairs.map(({ gameA, gameB }) => `${gameA}/${gameB}`)).toEqual(
      value.manifest.pairs.slice(0, 100).map(({ gameA, gameB }) => `${gameA}/${gameB}`),
    );
    const afterFirst = h.read().semanticRedundancy.manifestDelivery;
    expect(afterFirst?.deliveredPageIndexes).toEqual([0]);
    const retry = await service.deliverDisclosurePage(page(value, 0));
    expect(retry.outcome).toBe("accepted");
    expect(h.read().semanticRedundancy.manifestDelivery?.deliveredPageIndexes).toEqual([0]);
    expect((await service.startExecution(startInput(value))).outcome).toBe("not-authorized");
    service = h.service();

    const second = await service.deliverDisclosurePage(page(value, 100));
    expect(second.outcome).toBe("accepted");
    if (second.outcome !== "accepted") return;
    expect(second.value.receipt).toEqual({ pageIndex: 1, nextOffset: 200, complete: false });
    const third = await service.deliverDisclosurePage(page(value, 200));
    expect(third.outcome).toBe("accepted");
    if (third.outcome !== "accepted") return;
    expect(third.value.receipt).toEqual({ pageIndex: 2, nextOffset: 300, complete: true });
    const persisted = h.read().semanticRedundancy;
    expect(persisted.disclosure?.manifestDigest).toBe(value.manifest.digest);
    expect(persisted.disclosure?.pairCount).toBe(300);
    expect(persisted.manifestDelivery?.deliveredPageIndexes).toEqual([0, 1, 2]);
    expect(JSON.stringify(persisted.disclosureManifest)).not.toContain("description text");

    const restartedService = h.service();
    const replayedFirstPage = await restartedService.deliverDisclosurePage(page(value, 0));
    expect(replayedFirstPage).toMatchObject({
      outcome: "accepted",
      value: { offset: 0, nextOffset: 100, complete: false, receipt: { complete: false } },
    });
    const replayedFinalPage = await restartedService.deliverDisclosurePage(page(value, 200));
    expect(replayedFinalPage).toMatchObject({
      outcome: "accepted",
      value: { offset: 200, nextOffset: 300, complete: true, receipt: { complete: true } },
    });
    expect(h.read().semanticRedundancy.manifestDelivery?.deliveredPageIndexes).toEqual([0, 1, 2]);
    const started = await restartedService.startExecution(startInput(value));
    expect(started.outcome).toBe("accepted");
    const replay = await restartedService.startExecution(startInput(value));
    expect(started).toMatchObject({ value: { disposition: "CREATED" } });
    expect(replay).toMatchObject({ value: { disposition: "REPLAYED" } });
    expect(h.read().semanticRedundancy.execution?.attemptCount).toBe(0);
  });

  test("one disclosure permits one acknowledged execution across terminal states", async () => {
    const h = harness();
    const value = capture(h.read(), { eligibleCount: 2 });
    const service = await disclose(h, value);
    await service.deliverDisclosurePage(page(value, 0));
    const created = await service.startExecution(startInput(value));
    expect(created).toMatchObject({ outcome: "accepted", value: { disposition: "CREATED" } });
    const changedAck = await service.startExecution({
      ...startInput(value),
      deadlineAt: "2026-01-01T00:00:20.000Z",
    });
    expect(changedAck.outcome).toBe("not-authorized");
    expect(
      await service.startExecution({
        ...startInput(value),
        pairCount: value.manifest.pairs.length + 1,
      }),
    ).toMatchObject({ outcome: "not-authorized" });
    expect(await service.cancelExecution(value.manifest.id)).toMatchObject({ outcome: "accepted" });
    const replay = await service.startExecution(startInput(value));
    expect(replay).toMatchObject({
      outcome: "accepted",
      value: { status: "cancelled", disposition: "REPLAYED" },
    });
    expect(h.read().semanticRedundancy.execution?.attemptCount).toBe(0);
    expect(await service.startExecution(startInput(value, "another-command"))).toMatchObject({
      outcome: "not-authorized",
    });
  });

  test("simultaneous identical starts create only one run and identify the replay", async () => {
    const h = harness();
    const value = capture(h.read(), { eligibleCount: 2 });
    const service = await disclose(h, value);
    await service.deliverDisclosurePage(page(value, 0));
    const results = await Promise.all([
      service.startExecution(startInput(value)),
      service.startExecution(startInput(value)),
    ]);
    expect(results.map((result) => result.outcome)).toEqual(["accepted", "accepted"]);
    const dispositions = results.map((result) =>
      result.outcome === "accepted" ? result.value.disposition : null,
    );
    expect(dispositions.sort()).toEqual(["CREATED", "REPLAYED"]);
    expect(h.read().semanticRedundancy.execution?.attemptCount).toBe(0);
  });

  test("cannot replace a disclosure while its execution is running", async () => {
    const h = harness();
    const first = capture(h.read(), { eligibleCount: 2 });
    const service = await disclose(h, first);
    await service.deliverDisclosurePage(page(first, 0));
    expect((await service.startExecution(startInput(first))).outcome).toBe("accepted");
    const replacement = capture(h.read(), { eligibleCount: 3 });
    expect(await service.createDisclosure(replacement)).toMatchObject({
      outcome: "not-authorized",
    });
    expect(h.read().semanticRedundancy.disclosureManifest?.id).toBe(first.manifest.id);
  });

  test("rechecks disclosure expiry after asynchronous source validation on start", async () => {
    let pause = false;
    let entered!: () => void;
    let resolve!: (valid: boolean) => void;
    const validationEntered = new Promise<void>((done) => (entered = done));
    const validationResult = new Promise<boolean>((done) => (resolve = done));
    const h = harness({
      validateSourceIdentity: () => {
        if (!pause) return true;
        entered();
        return validationResult;
      },
    });
    const value = capture(h.read(), { eligibleCount: 2, expiresAt: "2026-01-01T00:00:10.000Z" });
    const service = await disclose(h, value);
    await service.deliverDisclosurePage(page(value, 0));
    pause = true;
    const starting = service.startExecution(startInput(value));
    await validationEntered;
    h.setTime(Date.parse(value.manifest.expiresAt));
    resolve(true);
    expect(await starting).toMatchObject({ outcome: "not-authorized" });
    expect(h.read().semanticRedundancy.execution).toBeNull();
  });

  test("rejects an extra empty page after an exact multiple while preserving empty manifests", async () => {
    const h = harness();
    const value = capture(h.read());
    let service = await disclose(h, value);
    expect((await service.deliverDisclosurePage(page(value, 0))).outcome).toBe("accepted");
    expect((await service.deliverDisclosurePage(page(value, 100))).outcome).toBe("accepted");
    expect((await service.deliverDisclosurePage(page(value, 200))).outcome).toBe("accepted");
    expect(await service.deliverDisclosurePage(page(value, 300))).toMatchObject({
      outcome: "invalid-state",
    });

    const zero = capture(h.read(), { eligibleCount: 1 });
    service = await disclose(h, zero);
    expect(await service.deliverDisclosurePage(page(zero, 0))).toMatchObject({
      outcome: "accepted",
      value: { pairs: [], complete: true },
    });
  });

  test("derives and persists the canonical digest rather than trusting a supplied digest", async () => {
    const h = harness();
    const value = capture(h.read());
    value.manifest.digest = "f".repeat(64);

    const result = await h.service().createDisclosure(value);
    expect(result).toMatchObject({
      outcome: "accepted",
      value: { id: value.manifest.id, digest: semanticDisclosureManifestDigest(value.manifest) },
    });
    expect(h.read().semanticRedundancy.disclosure?.manifestDigest).toBe(
      semanticDisclosureManifestDigest(value.manifest),
    );
    expect(h.read().semanticRedundancy.disclosureManifest?.signalScope).toBe("description-only");
  });

  test("rejects mixed disclosure, wrong digest, source changes, and expiry", async () => {
    const h = harness();
    const value = capture(h.read());
    await disclose(h, value);
    const service = h.service();
    expect(
      await service.deliverDisclosurePage({ ...page(value, 0), manifestDigest: "f".repeat(64) }),
    ).toMatchObject({ outcome: "invalid-state" });
    expect(
      await service.deliverDisclosurePage({ ...page(value, 0), manifestId: "other-disclosure" }),
    ).toMatchObject({ outcome: "invalid-state" });

    h.setSourceValid(false);
    expect(await service.deliverDisclosurePage(page(value, 0))).toMatchObject({ outcome: "stale" });
    h.setSourceValid(true);

    const expiring = capture(h.read(), { expiresAt: "2025-12-31T23:59:59.000Z" });
    expect(await service.createDisclosure(expiring)).toMatchObject({ outcome: "invalid-state" });

    const expiresSoon = capture(h.read(), { expiresAt: "2026-01-01T00:00:01.000Z" });
    expect(await service.createDisclosure(expiresSoon)).toMatchObject({ outcome: "accepted" });
    h.setTime(now + 2_000);
    expect(await service.deliverDisclosurePage(page(expiresSoon, 0))).toMatchObject({
      outcome: "invalid-state",
    });
  });

  test("keeps zero-pair execution running until explicit publication", async () => {
    const h = harness();
    const value = capture(h.read(), { eligibleCount: 1 });
    const service = await disclose(h, value);
    expect(await service.startExecution(startInput(value))).toMatchObject({
      outcome: "not-authorized",
    });
    const receipt = await service.deliverDisclosurePage(page(value, 0));
    expect(receipt.outcome).toBe("accepted");
    if (receipt.outcome !== "accepted") return;
    expect(receipt.value).toMatchObject({
      pairs: [],
      complete: true,
      receipt: { pageIndex: 0, nextOffset: 0, complete: true },
    });
    expect(await service.startExecution(startInput(value))).toMatchObject({
      outcome: "accepted",
      value: { status: "running", attemptCount: 0, completedPairCount: 0, failedPairCount: 0 },
    });
    const published = await service.publishGeneration({
      expected: { evidenceEpoch: 0, consentEpoch: 0 },
      authorizationId: value.manifest.id,
      manifest: value.manifest,
      eligibleGameIds: value.manifest.eligibleGameIds,
      sourceIdentity: value.sourceIdentity,
      generation: {
        id: value.manifest.id,
        evidenceEpoch: 0,
        consentEpoch: 0,
        manifestDigest: value.manifest.digest,
        modelId: value.manifest.modelId,
        rubricVersion: value.manifest.rubricVersion,
        scoringVersion: value.manifest.scoringVersion,
        sourceIdentity: value.sourceIdentity,
        signalScope: value.manifest.signalScope,
        publishedAt: at,
        eligibleGameIds: ["caller-supplied-spoof"],
      } as never,
    });
    expect(published.outcome).toBe("accepted");
    expect(h.read().semanticRedundancy.publishedGeneration?.pairOutcomes).toEqual([]);
    expect(h.read().semanticRedundancy.publishedGeneration?.eligibleGameIds).toEqual(
      value.manifest.eligibleGameIds,
    );
    const restartedService = h.service();
    expect(await restartedService.cancelExecution(value.manifest.id)).toMatchObject({
      outcome: "accepted",
    });
    expect(SemanticRedundancyStateSchema.safeParse(h.read().semanticRedundancy).success).toBe(true);
    expect(h.read().semanticRedundancy.execution?.status).toBe("completed");
    expect(h.read().semanticRedundancy.authorization?.state).toBe("consumed");
  });

  test("separates note transmission from cached-note use and preserves generation on cancellation", async () => {
    const h = harness();
    const value = capture(h.read(), { eligibleCount: 2, scope: "owner-notes-only" });
    const service = await disclose(h, value);
    await service.deliverDisclosurePage(page(value, 0));
    expect(await service.startExecution(startInput(value))).toMatchObject({
      outcome: "not-authorized",
    });

    const accepted = await service.startExecution({
      ...startInput(value),
      noteTransmissionAuthorized: true,
      cachedOwnerNoteUseAuthorized: false,
    });
    expect(accepted).toMatchObject({
      outcome: "accepted",
      value: {
        status: "running",
        noteTransmissionAuthorized: true,
        cachedOwnerNoteUseAuthorized: false,
      },
    });
    const generation = {
      id: "independent-generation",
      evidenceEpoch: 0,
      consentEpoch: 0,
      manifestDigest: "e".repeat(64),
      modelId: "older-model",
      rubricVersion: 1,
      scoringVersion: 1,
      sourceIdentity: value.sourceIdentity,
      signalScope: "description-only" as const,
      eligibleGameIds: [],
      weights: { factual: 7, description: 5, ownerNote: 0 },
      pairOutcomes: [],
      publishedAt: at,
    };
    const externalMutations: CollectionMutationService = h.mutations;
    await externalMutations.mutate(
      { operation: "semantic-redundancy.disclosure.create", trigger: "test-fixture" },
      (candidate) => {
        candidate.semanticRedundancy.publishedGeneration = generation;
        return { changed: true, value: undefined };
      },
    );
    expect(await service.cancelExecution("disclosure-1")).toMatchObject({ outcome: "accepted" });
    expect(await service.cancelExecution("disclosure-1")).toMatchObject({ outcome: "accepted" });
    expect(h.read().semanticRedundancy.execution?.status).toBe("cancelled");
    expect(h.read().semanticRedundancy.publishedGeneration?.id).toBe("independent-generation");
    expect(
      await service.startExecution({ ...startInput(value), noteTransmissionAuthorized: true }),
    ).toMatchObject({
      outcome: "accepted",
      value: { status: "cancelled", commandId: "disclosure-1", disposition: "REPLAYED" },
    });
    expect(await service.startExecution(startInput(value, "command-retry"))).toMatchObject({
      outcome: "not-authorized",
    });
  });
});
