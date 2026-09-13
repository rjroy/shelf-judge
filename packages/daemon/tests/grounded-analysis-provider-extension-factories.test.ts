import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { createProviderSessionExtensions } from "../src/services/grounded-analysis/provider-extension-factories.js";

const ollamaModel = {
  id: "qwen3.6:27B",
  name: "qwen3.6:27B",
  provider: "ollama",
  api: "openai-completions",
  baseUrl: "http://127.0.0.1:11434/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 262144,
  maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} satisfies Model<Api>;

describe("createProviderSessionExtensions", () => {
  test("registers Ollama and applies its request payload controls", () => {
    const options = createProviderSessionExtensions({
      providerId: "ollama",
      modelId: "qwen3.6:27B",
    });
    expect(options.extensionFactories).toHaveLength(0);
    expect(options.createExtensionFactories).toBeDefined();
    expect(options.onPayload?.({ model: "qwen3.6:27B" }, ollamaModel)).toEqual({
      model: "qwen3.6:27B",
      max_tokens: 1024,
      reasoning_effort: "none",
    });
  });

  test("does not register Ollama for an unrelated selected provider", () => {
    expect(createProviderSessionExtensions({ providerId: "openai", modelId: "gpt-5" })).toEqual({
      extensionFactories: [],
    });
  });
});
