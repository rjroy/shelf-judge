import type { GroundedProviderConfigurationStatus } from "@shelf-judge/shared";
import type { z } from "zod";
import {
  snapshotGroundedAllowedToolManifest,
  type GroundedAllowedToolManifest,
} from "./capability-inspection.js";
import { GroundedCapabilityError } from "./capability-inspection.js";
import { snapshotGroundedAuthorizationSchema } from "./immutable-schema.js";
import type { GroundedAnalysisProvider, GroundedAnalysisResult } from "./provider.js";
import { GroundedAnalysisError } from "./failure-mapping.js";
import { createGroundedCitationRegistry, type GroundedCitation } from "./citation-registry.js";
import { createGroundedDestinationRegistry } from "./destination-registry.js";
import { isGroundedEvidenceSnapshot, type GroundedEvidenceSnapshot } from "./evidence-registry.js";
import {
  snapshotGroundedFeaturePublication,
  type GroundedFeaturePublicationPolicy,
  type GroundedTransportEvent,
} from "./publication-policy.js";

const ownedFeatureAnalyzers = new WeakSet<object>();

export interface GroundedFeatureEvidenceManifest {
  readonly manifestId: string;
  readonly manifestVersion: string;
  readonly evidenceClasses: readonly string[];
}

export interface GroundedFeaturePolicy<
  ProviderPayload,
  Submission,
  Citation,
  Destination,
  Event extends GroundedTransportEvent,
> {
  readonly featureId: string;
  readonly featureVersion: string;
  readonly policyPrompt: string;
  readonly policyPromptVersion: string;
  readonly allowedTools: GroundedAllowedToolManifest;
  readonly providerPayloadSchema: z.ZodType<ProviderPayload>;
  readonly providerPayloadFields: readonly string[];
  readonly submissionSchema: z.ZodType<Submission>;
  readonly publicationSchema: z.ZodType<Submission>;
  readonly publicOutputFields: readonly string[];
  readonly evidenceManifest: GroundedFeatureEvidenceManifest;
  readonly citationSchema: z.ZodType<Citation>;
  readonly destinationSchema: z.ZodType<Destination>;
  readonly publication: GroundedFeaturePublicationPolicy<Submission, Event>;
}

export interface GroundedFeatureAnalysisRequest {
  readonly providerPayload: unknown;
  readonly evidence: GroundedEvidenceSnapshot;
  readonly citations: readonly unknown[];
  readonly signal: AbortSignal;
  readonly operationId: string;
  readonly batchId: string;
  readonly requestId: string;
  readonly trigger: string;
  readonly evidenceIdentityHash: string;
}

export interface GroundedFeatureAnalyzer<
  Output,
  Event extends GroundedTransportEvent = GroundedTransportEvent,
> {
  readonly featureId: string;
  readonly featureVersion: string;
  readonly configurationStatus: GroundedProviderConfigurationStatus;
  readonly publication: ReturnType<typeof snapshotGroundedFeaturePublication<Output, Event>>;
  analyze(request: GroundedFeatureAnalysisRequest): Promise<GroundedAnalysisResult<Output>>;
}

export interface GroundedFeatureAnalyzerBinding {
  readonly featureId: string;
  readonly analyzer: GroundedFeatureAnalyzer<unknown, GroundedTransportEvent>;
}

export interface GroundedFeatureAnalyzerRegistry {
  snapshot(): readonly GroundedFeatureAnalyzerBinding[];
  get<Output = unknown, Event extends GroundedTransportEvent = GroundedTransportEvent>(
    featureId: string,
  ): GroundedFeatureAnalyzer<Output, Event>;
}

export class GroundedFeaturePolicyConfigurationError extends Error {
  readonly code = "invalid-grounded-feature-policy";

  constructor(readonly safeDetail: string) {
    super(`Invalid grounded feature policy: ${safeDetail}`);
    this.name = "GroundedFeaturePolicyConfigurationError";
  }
}

function schemaFields(schema: z.ZodTypeAny): readonly string[] {
  const candidate = schema as unknown as { _getCached?: () => { shape: z.ZodRawShape } };
  const shape = candidate._getCached?.().shape;
  if (!shape) throw new GroundedFeaturePolicyConfigurationError("field-manifest-requires-object");
  return Object.freeze(Object.keys(shape).sort());
}

function snapshotFields(input: readonly string[], expected: readonly string[], safeDetail: string) {
  const fields = [...input].sort();
  if (
    fields.length === 0 ||
    new Set(fields).size !== fields.length ||
    fields.length !== expected.length ||
    fields.some((field, index) => field !== expected[index])
  ) {
    throw new GroundedFeaturePolicyConfigurationError(safeDetail);
  }
  return Object.freeze(fields);
}

function snapshotEvidenceManifest(input: GroundedFeatureEvidenceManifest) {
  const evidenceClasses = [...input.evidenceClasses].sort();
  const isSafeIdentifier = (value: string) => /^[A-Za-z0-9._:/@+~-]+$/.test(value);
  if (
    !isSafeIdentifier(input.manifestId) ||
    !isSafeIdentifier(input.manifestVersion) ||
    evidenceClasses.length === 0 ||
    new Set(evidenceClasses).size !== evidenceClasses.length ||
    evidenceClasses.some((evidenceClass) => !isSafeIdentifier(evidenceClass))
  ) {
    throw new GroundedFeaturePolicyConfigurationError("invalid-evidence-manifest");
  }
  return Object.freeze({
    manifestId: input.manifestId,
    manifestVersion: input.manifestVersion,
    evidenceClasses: Object.freeze(evidenceClasses),
  });
}

function cloneAndFreeze<Value>(value: Value): Value {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (typeof candidate !== "object" || candidate === null || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export function createGroundedFeatureAnalyzer<
  ProviderPayload,
  Submission,
  Citation extends GroundedCitation,
  Destination,
  Event extends GroundedTransportEvent,
>(options: {
  provider: GroundedAnalysisProvider;
  policy: GroundedFeaturePolicy<ProviderPayload, Submission, Citation, Destination, Event>;
}): GroundedFeatureAnalyzer<Submission, Event> {
  const input = options.policy;
  if (
    input.featureId.length === 0 ||
    input.featureVersion.length === 0 ||
    input.policyPrompt.length === 0 ||
    input.policyPromptVersion.length === 0
  ) {
    throw new GroundedFeaturePolicyConfigurationError("feature-identity-and-policy-required");
  }
  const allowedTools = snapshotGroundedAllowedToolManifest(input.allowedTools);
  if (allowedTools.feature !== input.featureId) {
    throw new GroundedFeaturePolicyConfigurationError("tool-feature-mismatch");
  }
  const providerPayloadSchema = snapshotGroundedAuthorizationSchema(input.providerPayloadSchema);
  const submissionSchema = snapshotGroundedAuthorizationSchema(input.submissionSchema);
  const publicationSchema = snapshotGroundedAuthorizationSchema(input.publicationSchema);
  const citationSchema = snapshotGroundedAuthorizationSchema(input.citationSchema);
  const destinationSchema = snapshotGroundedAuthorizationSchema(input.destinationSchema);
  const evidenceManifest = snapshotEvidenceManifest(input.evidenceManifest);
  const publication = snapshotGroundedFeaturePublication(input.publication);
  snapshotFields(
    input.providerPayloadFields,
    schemaFields(providerPayloadSchema),
    "provider-payload-field-manifest-mismatch",
  );
  snapshotFields(
    input.publicOutputFields,
    schemaFields(publicationSchema),
    "public-output-field-manifest-mismatch",
  );
  const featureId = input.featureId;
  const featureVersion = input.featureVersion;
  const policyPrompt = input.policyPrompt;
  const policyPromptVersion = input.policyPromptVersion;
  const configurationStatus = cloneAndFreeze(options.provider.configurationStatus);
  const analyze = options.provider.analyze.bind(options.provider);

  const analyzer = Object.freeze({
    featureId,
    featureVersion,
    configurationStatus,
    publication,
    async analyze(request: GroundedFeatureAnalysisRequest) {
      let providerPayload: ProviderPayload;
      let citations: Citation[];
      let destinations: Destination[];
      try {
        if (
          !isGroundedEvidenceSnapshot(request.evidence) ||
          request.evidence.manifestId !== evidenceManifest.manifestId ||
          request.evidence.manifestVersion !== evidenceManifest.manifestVersion ||
          request.evidence.evidenceClasses.length !== evidenceManifest.evidenceClasses.length ||
          request.evidence.evidenceClasses.some(
            (evidenceClass, index) => evidenceClass !== evidenceManifest.evidenceClasses[index],
          ) ||
          request.evidence.examinedSources.some(
            ({ evidenceClass }) => !evidenceManifest.evidenceClasses.includes(evidenceClass),
          ) ||
          request.evidence.entries.some(
            ({ evidenceClass }) => !evidenceManifest.evidenceClasses.includes(evidenceClass),
          )
        ) {
          throw new GroundedCapabilityError("feature-evidence-manifest-mismatch");
        }
        providerPayload = cloneAndFreeze(providerPayloadSchema.parse(request.providerPayload));
        const citationRegistry = createGroundedCitationRegistry({
          citationSchema,
          evidence: request.evidence,
        });
        const citationIds = request.citations.map(
          (citation) => citationRegistry.add(citation).citationId,
        );
        citations = [...citationRegistry.complete(citationIds)];
        const destinationRegistry = createGroundedDestinationRegistry({ destinationSchema });
        destinations = citations.map((citation) =>
          destinationRegistry.validate(citation.destination),
        );
      } catch (error) {
        throw new GroundedAnalysisError("output-validation", "feature-policy-input-rejected", {
          cause: error,
        });
      }
      const evidenceClassCounts = evidenceManifest.evidenceClasses.map((evidenceClass) => ({
        evidenceClass,
        count: request.evidence.examinedSources.filter(
          (source) => source.evidenceClass === evidenceClass,
        ).length,
      }));
      const result = await analyze({
        systemPrompt: policyPrompt,
        prompt: JSON.stringify(
          cloneAndFreeze({
            feature: { id: featureId, version: featureVersion },
            policyPromptVersion,
            evidenceManifest: {
              id: evidenceManifest.manifestId,
              version: evidenceManifest.manifestVersion,
              classes: evidenceManifest.evidenceClasses,
            },
            payload: providerPayload,
            citations,
            destinations,
          }),
        ),
        submissionSchema,
        signal: request.signal,
        audit: {
          operationId: request.operationId,
          batchId: request.batchId,
          requestId: request.requestId,
          feature: featureId,
          trigger: request.trigger,
          evidenceManifestId: evidenceManifest.manifestId,
          evidenceManifestVersion: evidenceManifest.manifestVersion,
          evidenceClassCounts,
          evidenceIdentityHash: request.evidenceIdentityHash,
        },
        allowedTools,
      });
      try {
        return {
          output: cloneAndFreeze(publicationSchema.parse(result.output)),
          usage: result.usage,
        };
      } catch (error) {
        throw new GroundedAnalysisError("output-validation", "publication-policy-rejected", {
          cause: error,
        });
      }
    },
  });
  ownedFeatureAnalyzers.add(analyzer);
  return analyzer;
}

export function createGroundedFeatureAnalyzerRegistry(
  analyzers: readonly GroundedFeatureAnalyzer<unknown, GroundedTransportEvent>[],
): GroundedFeatureAnalyzerRegistry {
  const byFeature = new Map<string, GroundedFeatureAnalyzer<unknown, GroundedTransportEvent>>();
  for (const analyzer of analyzers) {
    if (!ownedFeatureAnalyzers.has(analyzer)) {
      throw new GroundedFeaturePolicyConfigurationError("unowned-feature-analyzer");
    }
    if (byFeature.has(analyzer.featureId)) {
      throw new GroundedFeaturePolicyConfigurationError("duplicate-feature-policy");
    }
    byFeature.set(analyzer.featureId, analyzer);
  }
  const bindings = Object.freeze(
    [...byFeature].map(([featureId, analyzer]) => Object.freeze({ featureId, analyzer })),
  );
  return Object.freeze({
    snapshot: () => bindings,
    get<Output = unknown, Event extends GroundedTransportEvent = GroundedTransportEvent>(
      featureId: string,
    ): GroundedFeatureAnalyzer<Output, Event> {
      const analyzer = byFeature.get(featureId);
      if (!analyzer) throw new GroundedCapabilityError("unknown-feature-policy");
      return analyzer as GroundedFeatureAnalyzer<Output, Event>;
    },
  });
}

export function isGroundedFeatureAnalyzer(
  analyzer: unknown,
): analyzer is GroundedFeatureAnalyzer<unknown, GroundedTransportEvent> {
  return typeof analyzer === "object" && analyzer !== null && ownedFeatureAnalyzers.has(analyzer);
}
