import type { SemanticDisclosureManifest, SemanticSourceIdentity } from "@shelf-judge/shared";

export interface SemanticPairSource {
  sourceIdentity: SemanticSourceIdentity;
  descriptionA: { name: string; text: string; fingerprint: string } | null;
  descriptionB: { name: string; text: string; fingerprint: string } | null;
  ownerNoteA: { name: string; text: string; fingerprint: string; version: number } | null;
  ownerNoteB: { name: string; text: string; fingerprint: string; version: number } | null;
}

export interface SemanticRefreshPairAuthority {
  /** Invokes operation while the source coordinator remains held after full eligibility revalidation. */
  withCurrentPair<Value>(input: {
    executionId: string;
    manifest: SemanticDisclosureManifest;
    pair: SemanticDisclosureManifest["pairs"][number];
    operation: (source: SemanticPairSource) => Promise<Value>;
  }): Promise<Value>;
}

export interface SemanticGenerationAuthority {
  sourceIdentity: SemanticSourceIdentity;
  eligibleGameIds: string[];
}

export interface SemanticRefreshGenerationAuthority {
  /** Holds the profile source coordinator throughout authority validation and operation. */
  withCurrentGeneration<Value>(input: {
    executionId: string;
    manifest: SemanticDisclosureManifest;
    operation: (authority: SemanticGenerationAuthority) => Promise<Value>;
  }): Promise<Value>;
}

/** Authoritative source-identity check for state mutations, called while the source coordinator is held. */
export interface SemanticSourceIdentityAuthority {
  validateSourceIdentity(
    collection: import("@shelf-judge/shared").Collection,
    expected: SemanticSourceIdentity,
  ): Promise<boolean>;
}

/** Whole-manifest eligibility authority for runtime boundaries that have no execution ID. */
export interface SemanticRefreshManifestAuthority {
  /** Holds the profile source coordinator through complete manifest verification and operation. */
  withCurrentManifest<Value>(input: {
    manifest: SemanticDisclosureManifest;
    operation: (authority: SemanticGenerationAuthority) => Promise<Value>;
  }): Promise<Value>;
}
