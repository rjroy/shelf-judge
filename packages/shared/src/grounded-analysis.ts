import { z } from "zod";

export const GROUNDED_ANALYSIS_CONTRACT_VERSION = 1 as const;
export const GROUNDED_DISCLOSURE_VERSION = 1 as const;
export const CANCELLATION_CAPABILITY_BITS = 256 as const;

const IdSchema = z.string().min(1);
const SafeCountSchema = z.number().int().safe().min(0);
const PositiveSafeIntegerSchema = z.number().int().safe().positive();

// ISO 4217 active alphabetic currency codes. Updating this set is an explicit wire change.
export const ISO_4217_CURRENCY_CODES = [
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BOV",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHE",
  "CHF",
  "CHW",
  "CLF",
  "CLP",
  "CNY",
  "COP",
  "COU",
  "CRC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "IQD",
  "IRR",
  "ISK",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KPW",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MXV",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "SSP",
  "STN",
  "SVC",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "USN",
  "UYI",
  "UYU",
  "UYW",
  "UZS",
  "VED",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XAD",
  "XAG",
  "XAU",
  "XBA",
  "XBB",
  "XBC",
  "XBD",
  "XCD",
  "XCG",
  "XDR",
  "XOF",
  "XPD",
  "XPF",
  "XPT",
  "XSU",
  "XTS",
  "XUA",
  "XXX",
  "YER",
  "ZAR",
  "ZMW",
  "ZWG",
] as const;

export const Iso4217CurrencyCodeSchema = z.enum(ISO_4217_CURRENCY_CODES);
export const CancellationCapabilitySchema = z.string().regex(/^[0-9a-f]{64}$/);

export const GroundedProviderIdentitySchema = z
  .object({
    providerId: IdSchema,
    modelId: IdSchema,
    extensionIds: z.array(IdSchema),
  })
  .strict()
  .superRefine(({ extensionIds }, context) => {
    if (new Set(extensionIds).size !== extensionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extensionIds"],
        message: "Provider extension IDs must be unique",
      });
    }
  });

export const GroundedProviderConfigurationStatusSchema = z.union([
  z
    .object({
      status: z.literal("configured"),
      identity: GroundedProviderIdentitySchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.enum(["model-configuration", "extension-binding"]),
      safeDetail: z.string().min(1).optional(),
      correctionDestination: z
        .object({ operationId: z.literal("shelf.grounded-analysis.configuration.get") })
        .strict(),
    })
    .strict(),
]);

const ProviderReportedDecimalSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Cost must be a canonical nonnegative decimal");

export const GroundedProviderUsageSchema = z
  .object({
    state: z.literal("reported"),
    inputTokens: SafeCountSchema.optional(),
    outputTokens: SafeCountSchema.optional(),
    cacheReadTokens: SafeCountSchema.optional(),
    cacheWriteTokens: SafeCountSchema.optional(),
    monetaryCost: z
      .object({
        amount: ProviderReportedDecimalSchema,
        currency: Iso4217CurrencyCodeSchema,
      })
      .strict()
      .optional(),
    inferenceRoundTrips: PositiveSafeIntegerSchema,
  })
  .strict();

export const GroundedUsageUnavailableSchema = z
  .object({ state: z.literal("unavailable") })
  .strict();

export const GroundedCancellationIdentitySchema = z
  .object({
    batchId: IdSchema,
    requestId: IdSchema,
    capability: CancellationCapabilitySchema,
  })
  .strict();

export const GroundedDisclosureAcknowledgementSchema = z
  .object({
    version: z.literal(GROUNDED_DISCLOSURE_VERSION),
    providerId: IdSchema,
    modelId: IdSchema,
    acknowledged: z.literal(true),
  })
  .strict();

export function createGroundedDisclosureSchema<
  const EvidenceClass extends readonly [string, ...string[]],
>(evidenceClasses: EvidenceClass) {
  return z
    .object({
      version: z.literal(GROUNDED_DISCLOSURE_VERSION),
      provider: GroundedProviderIdentitySchema,
      evidenceClasses: z.array(z.enum(evidenceClasses)).nonempty(),
      relevantOwnerNotesMayBeTransmitted: z.boolean(),
      providerProcessingAndRetentionFollowProviderPolicy: z.literal(true),
      localRetention: z.string().min(1),
      applicationTokenCap: z.null(),
      applicationMonetaryCap: z.null(),
      modelOperationCount: PositiveSafeIntegerSchema,
      maximumProviderRoundTrips: PositiveSafeIntegerSchema,
      cancellation: z.string().min(1),
    })
    .strict()
    .superRefine(
      ({ evidenceClasses: values, modelOperationCount, maximumProviderRoundTrips }, context) => {
        if (new Set(values).size !== values.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["evidenceClasses"],
            message: "Disclosure evidence classes must be unique",
          });
        }
        if (maximumProviderRoundTrips < modelOperationCount) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["maximumProviderRoundTrips"],
            message: "Maximum provider round trips cannot be lower than model operations",
          });
        }
      },
    );
}

export function createGroundedUnavailableReasonSchema<
  const Reasons extends readonly [string, ...string[]],
>(reasons: Reasons) {
  return z.enum(reasons);
}

export interface GroundedOperationResultDefinition {
  outcome: string;
  payload: z.ZodRawShape;
}

type GroundedOperationResultFromDefinition<Definition extends GroundedOperationResultDefinition> = {
  outcome: Definition["outcome"];
} & {
  [Key in keyof Definition["payload"]]: z.output<Definition["payload"][Key]>;
};

export function createGroundedOperationResultSchema<
  const Definitions extends readonly GroundedOperationResultDefinition[],
>(definitions: Definitions) {
  type Result = GroundedOperationResultFromDefinition<Definitions[number]>;
  const schemas = definitions.map(({ outcome, payload }) =>
    z.object({ outcome: z.literal(outcome), ...payload }).strict(),
  );
  if (schemas.length === 0) return z.never();
  if (schemas.length === 1) return schemas[0] as z.ZodType<Result>;
  return z.union(
    schemas as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
  ) as z.ZodType<Result>;
}

export type GroundedProviderIdentity = z.infer<typeof GroundedProviderIdentitySchema>;
export type GroundedProviderConfigurationStatus = z.infer<
  typeof GroundedProviderConfigurationStatusSchema
>;
export type GroundedProviderUsage = z.infer<typeof GroundedProviderUsageSchema>;
export type GroundedUsageUnavailable = z.infer<typeof GroundedUsageUnavailableSchema>;
export type GroundedCancellationIdentity = z.infer<typeof GroundedCancellationIdentitySchema>;
export type GroundedDisclosureAcknowledgement = z.infer<
  typeof GroundedDisclosureAcknowledgementSchema
>;
