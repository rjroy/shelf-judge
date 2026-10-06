export type JevRunPublicationState = "published" | "unchanged" | "pending";

export type JevRunPublicationPhase = "seal" | "validate" | "promote";

export type JevRunOutcomePersistence = "sealed" | "finalized" | "unpersisted";

export type JevRunStopReason =
  | "provider-limit"
  | "provider-unconfigured"
  | "application-attempt-limit"
  | "application-token-threshold"
  | "application-deadline"
  | "owner-cancelled";

/** Additive execution-independent publication result for an explicit Jev run. */
export interface JevRunPublication {
  state: JevRunPublicationState;
  phase?: JevRunPublicationPhase;
  outcomePersistence: JevRunOutcomePersistence;
  reason?: string;
}

export interface JevRunProgressProjection {
  state: "last-known-running" | "completed" | "interrupted" | "failed";
  scope?: "collection" | "wishlist";
  pairCount: number;
  completedPairs: number;
  cacheHits: number;
  cacheMisses: number;
  failedPairs: number;
  stopReason?: JevRunStopReason;
  publication?: JevRunPublication;
}

export type JevRefreshProgressEntry =
  | { state: "none" | "unavailable" }
  | {
      state: "process-local";
      value: JevRunProgressProjection;
      /** Present only while this process-local pending outcome still owns a durable batch. */
      retryRunId: string;
    }
  | {
      state: "saved";
      relation: "active-run" | "historical" | "unknown";
      value: JevRunProgressProjection;
      /** Present only while the matching sealed batch is unresolved. */
      retryRunId?: string;
    };

export interface JevRefreshProgressResponse {
  coverageMeasurement: "not-measured";
  activity:
    | { state: "active"; runId: string; scope?: "collection" | "wishlist" }
    | { state: "idle" }
    | { state: "unavailable" };
  progress: JevRefreshProgressEntry;
}
