import type { ProviderDefinition } from "@/modelManagement/types/runtime";

export const LOCAL_PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: "ollama",
    displayName: "Ollama",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. llama3.2, qwen2.5-coder:7b",
  },
  {
    id: "lmstudio",
    displayName: "LM Studio",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:1234/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. lmstudio-community/Qwen2.5-7B-Instruct-GGUF",
  },
];

export const CUSTOM_OPENAI_DEFINITION: ProviderDefinition = {
  id: "custom-openai-compatible",
  displayName: "Custom OpenAI-compatible",
  providerType: "openai-compatible",
  requiresApiKey: false,
  modelInputHint: "e.g. gpt-5.5",
};
