import {
  GroundedProviderConfigurationStatusSchema,
  type GroundedProviderConfigurationStatus,
  type GroundedProviderIdentity,
} from "@shelf-judge/shared";

export const GROUNDED_PROVIDER_ENV = {
  providerId: "SHELF_JUDGE_GROUNDED_PROVIDER_ID",
  modelId: "SHELF_JUDGE_GROUNDED_MODEL_ID",
  extensionIds: "SHELF_JUDGE_GROUNDED_EXTENSION_IDS",
} as const;

export type GroundedProviderStartupConfiguration =
  | ({ status: "configured" } & GroundedProviderIdentity)
  | Extract<GroundedProviderConfigurationStatus, { status: "unavailable" }>;

const correctionDestination = {
  operationId: "shelf.grounded-analysis.configuration.get",
} as const;

function unavailable(safeDetail: string): GroundedProviderStartupConfiguration {
  return {
    status: "unavailable",
    reason: "model-configuration",
    safeDetail,
    correctionDestination,
  };
}

function parseExtensionIds(value: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    const extensionIds: string[] = [];
    for (const entry of parsed as unknown[]) {
      if (typeof entry !== "string" || entry.trim() !== entry || entry.length === 0) {
        return undefined;
      }
      extensionIds.push(entry);
    }
    if (new Set(extensionIds).size !== extensionIds.length) return undefined;
    return extensionIds;
  } catch {
    return undefined;
  }
}

export function resolveGroundedProviderConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): GroundedProviderStartupConfiguration {
  const providerId = env[GROUNDED_PROVIDER_ENV.providerId];
  const modelId = env[GROUNDED_PROVIDER_ENV.modelId];
  const extensionValue = env[GROUNDED_PROVIDER_ENV.extensionIds];
  const missing: string[] = [];
  if (providerId === undefined) missing.push(GROUNDED_PROVIDER_ENV.providerId);
  if (modelId === undefined) missing.push(GROUNDED_PROVIDER_ENV.modelId);
  if (extensionValue === undefined) missing.push(GROUNDED_PROVIDER_ENV.extensionIds);

  if (missing.length > 0) return unavailable(`missing:${missing.join(",")}`);
  if (providerId === undefined || modelId === undefined || extensionValue === undefined) {
    return unavailable("missing:grounded-analysis-configuration");
  }
  if (providerId.length === 0 || providerId.trim() !== providerId) {
    return unavailable(`invalid:${GROUNDED_PROVIDER_ENV.providerId}`);
  }
  if (modelId.length === 0 || modelId.trim() !== modelId) {
    return unavailable(`invalid:${GROUNDED_PROVIDER_ENV.modelId}`);
  }
  const extensionIds = parseExtensionIds(extensionValue);
  if (!extensionIds) return unavailable(`invalid:${GROUNDED_PROVIDER_ENV.extensionIds}`);

  return {
    status: "configured",
    providerId,
    modelId,
    extensionIds,
  };
}

export function toGroundedProviderConfigurationStatus(
  configuration: GroundedProviderStartupConfiguration,
): GroundedProviderConfigurationStatus {
  if (configuration.status === "unavailable") return configuration;
  return GroundedProviderConfigurationStatusSchema.parse({
    status: "configured",
    identity: {
      providerId: configuration.providerId,
      modelId: configuration.modelId,
      extensionIds: configuration.extensionIds,
    },
  });
}
