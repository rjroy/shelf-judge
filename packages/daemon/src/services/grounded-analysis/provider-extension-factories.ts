import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { NativeTransportDiagnosticSink } from "./transport-diagnostics.js";
import {
  createOllamaProviderExtension,
  createOllamaRequestPayloadHook,
  OLLAMA_GROUNDED_MAX_TOKENS,
} from "./ollama-provider-extension.js";

export interface ProviderExtensionConfiguration {
  providerId: string;
  modelId: string;
}

export interface ProviderSessionExtensions {
  readonly extensionFactories: readonly ExtensionFactory[];
  readonly createExtensionFactories?: (
    sink: NativeTransportDiagnosticSink,
  ) => readonly ExtensionFactory[];
  readonly onPayload?: SimpleStreamOptions["onPayload"];
}

/**
 * Register only the selected provider's built-in extension. External extensions
 * remain governed by the explicit allowlist in the provider configuration.
 */
export function createProviderSessionExtensions(
  configuration: ProviderExtensionConfiguration,
): ProviderSessionExtensions {
  if (configuration.providerId !== "ollama") return { extensionFactories: [] };

  return {
    extensionFactories: [],
    createExtensionFactories: (sink) => [
      createOllamaProviderExtension(
        configuration.modelId,
        OLLAMA_GROUNDED_MAX_TOKENS,
        undefined,
        sink,
      ),
    ],
    onPayload: createOllamaRequestPayloadHook(OLLAMA_GROUNDED_MAX_TOKENS),
  };
}
