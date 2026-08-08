/**
 * Built-in provider definitions surfaced in the BYOK "Add provider"
 * wizard alongside catalog-derived definitions.
 *
 * Covers providers `models.dev` does not list — local runners
 * (Ollama, LM Studio), per-tenant deploys (Azure, Bedrock), and the
 * catch-all custom OpenAI-compatible endpoint. None carry a model list;
 * available ids come from `/models` fetched at dialog open or from the
 * user typing them in manually.
 */

import type { ProviderDefinition } from "@/modelManagement/types/runtime";

/**
 * Local runners — surfaced in their own "Self Host" group on the first
 * Add-provider screen. They ship a known localhost endpoint and run key-less
 * by default (though a local proxy may still front them with auth).
 */
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

/** The bring-your-own-endpoint definition the "Add a custom provider" CTA opens. */
export const CUSTOM_OPENAI_DEFINITION: ProviderDefinition = {
  id: "custom-openai-compatible",
  displayName: "Custom OpenAI-compatible",
  providerType: "openai-compatible",
  requiresApiKey: true,
  modelInputHint: "e.g. gpt-5.5",
};

export const BUILTIN_PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  ...LOCAL_PROVIDER_DEFINITIONS,
  CUSTOM_OPENAI_DEFINITION,
  {
    id: "azure-openai",
    displayName: "Azure OpenAI",
    providerType: "azure",
    requiresApiKey: true,
    modelInputHint: "matches your Azure deployment name",
  },
  {
    id: "aws-bedrock",
    displayName: "AWS Bedrock",
    providerType: "bedrock",
    requiresApiKey: true,
    modelInputHint: "e.g. anthropic.claude-sonnet-4-5",
  },
];
