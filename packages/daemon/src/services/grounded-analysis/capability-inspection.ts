export interface GroundedExtensionCapabilities {
  extensionId: string;
  toolNames: readonly string[];
  hookNames: readonly string[];
  hasContextTransformer: boolean;
}

export interface GroundedSessionCapabilities {
  activeToolNames: readonly string[];
  extensions: readonly GroundedExtensionCapabilities[];
}

export class GroundedCapabilityError extends Error {
  constructor(readonly safeDetail: string) {
    super(safeDetail);
    this.name = "GroundedCapabilityError";
  }
}

export function assertGroundedSessionCapabilities(
  capabilities: GroundedSessionCapabilities,
  allowedTools: GroundedAllowedToolManifest,
): void {
  for (const extension of capabilities.extensions) {
    if (extension.toolNames.length > 0) {
      throw new GroundedCapabilityError(`unapproved-extension-tools:${extension.extensionId}`);
    }
    if (extension.hookNames.length > 0) {
      throw new GroundedCapabilityError(`unapproved-extension-hooks:${extension.extensionId}`);
    }
    if (extension.hasContextTransformer) {
      throw new GroundedCapabilityError(`unapproved-context-transform:${extension.extensionId}`);
    }
  }

  const activeToolNames = [...capabilities.activeToolNames].sort();
  const allowedToolNames = [...allowedTools.toolNames].sort();
  if (
    activeToolNames.length !== allowedToolNames.length ||
    activeToolNames.some((name, index) => name !== allowedToolNames[index])
  ) {
    throw new GroundedCapabilityError("unapproved-active-tools");
  }
}

const GroundedAllowedToolManifestSchema = z
  .object({
    feature: z.string().min(1),
    toolNames: z.array(z.string().min(1)).nonempty(),
  })
  .strict()
  .superRefine(({ toolNames }, context) => {
    if (new Set(toolNames).size !== toolNames.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toolNames"],
        message: "Allowed tool names must be unique",
      });
    }
  });

export interface GroundedAllowedToolManifest {
  readonly feature: string;
  readonly toolNames: readonly string[];
}

export function snapshotGroundedAllowedToolManifest(
  input: GroundedAllowedToolManifest,
): GroundedAllowedToolManifest {
  const parsed = GroundedAllowedToolManifestSchema.parse(input);
  return Object.freeze({
    feature: parsed.feature,
    toolNames: Object.freeze([...parsed.toolNames]),
  });
}
import { z } from "zod";
