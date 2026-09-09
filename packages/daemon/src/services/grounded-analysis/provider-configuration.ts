import {
  GroundedProviderConfigurationStatusSchema,
  GroundedProviderIdentitySchema,
  type GroundedProviderConfigurationStatus,
  type GroundedProviderIdentity,
} from "@shelf-judge/shared";

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

export function resolveGroundedProviderConfiguration(
  identity: GroundedProviderIdentity | null,
): GroundedProviderStartupConfiguration {
  if (identity === null) return unavailable("missing:grounded-analysis-configuration");
  const parsed = GroundedProviderIdentitySchema.safeParse(identity);
  if (!parsed.success) return unavailable("invalid:grounded-analysis-configuration");

  return {
    status: "configured",
    ...parsed.data,
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
