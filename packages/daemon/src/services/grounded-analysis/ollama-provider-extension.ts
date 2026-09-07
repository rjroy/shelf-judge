import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";

/**
 * Makes Pi's OpenAI-compatible request match Ollama's documented controls.
 * This hook is intentionally opt-in at the evaluation session call site.
 */
export function createOllamaRequestPayloadHook(
  maxTokens: number,
): NonNullable<SimpleStreamOptions["onPayload"]> {
  return (payload) => {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return payload;
    return {
      ...payload,
      max_tokens: maxTokens,
      reasoning_effort: "none",
    };
  };
}

/** Registers the operator-selected local model without discovering user extensions. */
export function createOllamaProviderExtension(
  modelId: string,
  maxTokens = 512,
  baseUrl = "http://127.0.0.1:11434/v1",
): ExtensionFactory {
  return (pi) => {
    pi.registerProvider("ollama", {
      name: "Shelf Judge local Ollama",
      baseUrl,
      apiKey: "ollama",
      api: "openai-completions",
      models: [
        {
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ["text"],
          contextWindow: 262144,
          maxTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
  };
}
