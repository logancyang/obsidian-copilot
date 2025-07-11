import { ChatModelProviders, SettingKeyProviders } from "@/constants";

/**
 * Standard model interface definition - for frontend display
 */
export interface StandardModel {
  id: string; // Model unique identifier
  name: string; // Model display name
  provider: SettingKeyProviders; // Provider
}

// The list model interface return value for each Provider.

// OpenAI response model definition
export interface OpenAIModelResponse {
  object: string;
  data: OpenAIModel[];
}

/**
 {
 "id": "model-id-0",
 "object": "model",
 "created": 1686935002,
 "owned_by": "organization-owner"
 },
 */
export interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

// Google (Gemini) response model definition
export interface GoogleModelResponse {
  models: GoogleModel[];
  nextPageToken?: string;
}

/**
 {
 "name": "models/gemini-2.5-pro-exp-03-25",
 "version": "2.5-exp-03-25",
 "displayName": "Gemini 2.5 Pro Experimental 03-25",
 "description": "Experimental release (March 25th, 2025) of Gemini 2.5 Pro",
 "inputTokenLimit": 1048576,
 "outputTokenLimit": 65536,
 "supportedGenerationMethods": [
 "generateContent",
 "countTokens",
 "createCachedContent"
 ],
 "temperature": 1,
 "topP": 0.95,
 "topK": 64,
 "maxTemperature": 2
 }
 */
export interface GoogleModel {
  name: string;
  baseModelId?: string;
  version?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  temperature?: number;
  maxTemperature?: number;
  topP?: number;
  topK?: number;
}

// Anthropic response model definition
export interface AnthropicModelResponse {
  data: AnthropicModel[];
  first_id?: string;
  has_more?: boolean;
  last_id?: string;
}

/**
 {
 "created_at": "2025-02-19T00:00:00Z",
 "display_name": "Claude 3.7 Sonnet",
 "id": "claude-3-7-sonnet-20250219",
 "type": "model"
 }
 */
export interface AnthropicModel {
  created_at: string;
  display_name: string;
  id: string;
  type: string;
}

// Mistral response model definition
export interface MistralModelResponse {
  object: string;
  data: MistralModel[];
}

/**
 {
 "id": "string",
 "object": "model",
 "created": 0,
 "owned_by": "mistralai",
 "capabilities": {
 "completion_chat": true,
 "completion_fim": false,
 "function_calling": true,
 "fine_tuning": false,
 "vision": false
 },
 "name": "string",
 "description": "string",
 "max_context_length": 32768,
 "aliases": [ ],
 "deprecation": "2019-08-24T14:15:22Z",
 "default_model_temperature": 0,
 "type": "base"
 }
 */
export interface MistralModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  capabilities?: {
    completion_chat: boolean;
    completion_fim: boolean;
    function_calling: boolean;
    fine_tuning: boolean;
    vision: boolean;
  };
  name?: string;
  description?: string;
  max_context_length?: number;
  aliases?: string[];
  deprecation?: string;
  default_model_temperature?: number;
  type?: string;
}

// Cohere response model definition
export interface CohereModelResponse {
  models: CohereModel[];
  next_page_token?: string;
}

/**
 {
 "name": "command-r-plus",
 "endpoints": [
 "generate",
 "chat",
 "summarize"
 ],
 "finetuned": false,
 "context_length": 128000,
 "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-r-plus.json",
 "supports_vision": false,
 "features": [
 "logprobs",
 "json_mode",
 "json_schema",
 "strict_tools",
 "safety_modes",
 "tools"
 ],
 "default_endpoints": []
 },
 */
export interface CohereModel {
  name: string;
  endpoints?: string[];
  finetuned?: boolean;
  context_length?: number;
  tokenizer_url?: string;
  supports_vision?: boolean;
  default_endpoints?: string[];
  features?: string[];
}

// DeepSeek response model definition
export interface DeepSeekModelResponse {
  object: string;
  data: DeepSeekModel[];
}

/**
 {
 "id": "deepseek-chat",
 "object": "model",
 "owned_by": "deepseek"
 },
 */
export interface DeepSeekModel {
  id: string;
  object: string;
  owned_by: string;
}

// Groq response model definition
export interface GroqModelResponse {
  object: string;
  data: GroqModel[];
}

/**
 {
 "id": "llama3-8b-8192",
 "object": "model",
 "created": 1693721698,
 "owned_by": "Meta",
 "active": true,
 "context_window": 8192,
 "public_apps": null
 },
 */
export interface GroqModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  active?: boolean;
  context_window?: number;
  public_apps?: any;
}

// XAI response model definition
export interface XAIModelResponse {
  data: XAIModel[];
  object: string;
}

/**
 {
 "id": "grok-3-beta",
 "created": 1743724800,
 "object": "model",
 "owned_by": "xai"
 },
 */

export interface XAIModel {
  id: string;
  created: number;
  object: string;
  owned_by: string;
}

// OpenRouterAI response model definition
export interface OpenRouterAIModelResponse {
  data: OpenRouterAIModel[];
}

/**
 {
 "id": "google/gemini-2.5-pro-preview-03-25",
 "name": "Google: Gemini 2.5 Pro Preview",
 "created": 1744924206,
 "description": "Gemini 2.5 Pro is Google’s state-of-the-art AI model designed for advanced reasoning, coding, mathematics, and scientific tasks. It employs “thinking” capabilities, enabling it to reason through responses with enhanced accuracy and nuanced context handling. Gemini 2.5 Pro achieves top-tier performance on multiple benchmarks, including first-place positioning on the LMArena leaderboard, reflecting superior human-preference alignment and complex problem-solving abilities.",
 "context_length": 1048576,
 "architecture": {
 "modality": "text+image->text",
 "input_modalities": [
 "text",
 "image",
 "file"
 ],
 "output_modalities": [
 "text"
 ],
 "tokenizer": "Gemini",
 "instruct_type": null
 },
 "pricing": {
 "prompt": "0.00000125",
 "completion": "0.00001",
 "request": "0",
 "image": "0.00516",
 "web_search": "0",
 "internal_reasoning": "0",
 "input_cache_read": "0.000000625",
 "input_cache_write": "0"
 },
 "top_provider": {
 "context_length": 1048576,
 "max_completion_tokens": 65535,
 "is_moderated": false
 },
 "per_request_limits": null
 }
 */
export interface OpenRouterAIModel {
  id: string;
  name: string;
  created: number;
  description?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
  };
  top_provider?: {
    is_moderated?: boolean;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    web_search?: string;
    internal_reasoning?: string;
  };
  context_length?: number;
  per_request_limits?: Record<string, string>;
}

// Response type mapping
export interface ProviderResponseMap {
  [ChatModelProviders.OPENAI]: OpenAIModelResponse;
  [ChatModelProviders.GOOGLE]: GoogleModelResponse;
  [ChatModelProviders.ANTHROPIC]: AnthropicModelResponse;
  [ChatModelProviders.MISTRAL]: MistralModelResponse;
  [ChatModelProviders.COHEREAI]: CohereModelResponse;
  [ChatModelProviders.DEEPSEEK]: DeepSeekModelResponse;
  [ChatModelProviders.GROQ]: GroqModelResponse;
  [ChatModelProviders.XAI]: XAIModelResponse;
  [ChatModelProviders.OPENROUTERAI]: OpenRouterAIModelResponse;
  [ChatModelProviders.COPILOT_PLUS]: null;
  [ChatModelProviders.AZURE_OPENAI]: null;
}

// Adapter type definition - converts provider-specific models to standard format
export type ModelAdapter<T extends SettingKeyProviders> = (
  data: ProviderResponseMap[T]
) => StandardModel[];

// Create adapter function type
export type ProviderModelAdapters = {
  [K in SettingKeyProviders]?: ModelAdapter<K>;
};

/**
 * Provider model adapters - converts different provider model data to standard format
 * These adapters extract model information from API responses and return in a unified format
 */
export const providerAdapters: ProviderModelAdapters = {
  [ChatModelProviders.OPENAI]: (data): StandardModel[] =>
    data.data?.map((model) => ({
      id: model.id,
      name: model.id,
      provider: ChatModelProviders.OPENAI,
    })) || [],

  [ChatModelProviders.GOOGLE]: (data): StandardModel[] =>
    data.models?.map((model) => {
      // models/gemini-2.5-pro-exp-03-25
      const name = model.name.split("models/")?.[1];
      return {
        id: name,
        name: name,
        provider: ChatModelProviders.GOOGLE,
      };
    }) || [],

  [ChatModelProviders.ANTHROPIC]: (data): StandardModel[] =>
    data.data?.map((model) => ({
      id: model.id,
      name: model.id,
      provider: ChatModelProviders.ANTHROPIC,
    })) || [],

  [ChatModelProviders.MISTRAL]: (data): StandardModel[] =>
    data.data?.map((model) => ({
      id: model.id,
      name: model.id,
      provider: ChatModelProviders.MISTRAL,
    })) || [],

  [ChatModelProviders.COHEREAI]: (data): StandardModel[] =>
    data.models?.map((model) => ({
      id: model.name,
      name: model.name,
      provider: ChatModelProviders.COHEREAI,
    })) || [],

  [ChatModelProviders.DEEPSEEK]: (data): StandardModel[] =>
    data.data?.map((model) => ({
      id: model.id,
      name: model.id,
      provider: ChatModelProviders.DEEPSEEK,
    })) || [],

  [ChatModelProviders.GROQ]: (data): StandardModel[] =>
    data.data?.map((model) => ({
      id: model.id,
      name: model.id,
      provider: ChatModelProviders.GROQ,
    })) || [],

  [ChatModelProviders.XAI]: (data): StandardModel[] =>
    data.data?.map((model) => ({
      id: model.id,
      name: model.id,
      provider: ChatModelProviders.XAI,
    })) || [],

  [ChatModelProviders.OPENROUTERAI]: (data): StandardModel[] =>
    data.data?.map((model) => ({
      id: model.id,
      name: model.id,
      provider: ChatModelProviders.OPENROUTERAI,
    })) || [],
};

/**
 * Default model adapter - handles unknown provider or format model data
 * Attempts to detect common data structure patterns and extract relevant information
 */
export const getDefaultModelAdapter = (provider: SettingKeyProviders) => {
  return (data: any): StandardModel[] => {
    // Try to detect common data structure patterns
    if (data.data && Array.isArray(data.data)) {
      return data.data.map((model: any) => ({
        id: model.id || model.name || String(Math.random()),
        name: model.name || model.id || model.display_name || "Unknown Model",
        provider: provider,
      }));
    } else if (data.models && Array.isArray(data.models)) {
      return data.models.map((model: any) => ({
        id: model.id || model.name || String(Math.random()),
        name: model.name || model.displayName || model.id || "Unknown Model",
        provider: provider,
      }));
    } else if (Array.isArray(data)) {
      return data.map((model: any) => ({
        id: model.id || model.name || String(Math.random()),
        name: model.name || model.id || "Unknown Model",
        provider: provider,
      }));
    }
    return [];
  };
};

/**
 * Get adapter function
 * Uses provider-specific adapter if available, otherwise falls back to default adapter
 */
export const getModelAdapter = (provider: SettingKeyProviders) => {
  return providerAdapters[provider] || getDefaultModelAdapter(provider);
};

/**
 * Parse model data and convert to standard format
 */
export const parseModelsResponse = (provider: SettingKeyProviders, data: any): StandardModel[] => {
  const adapter = getModelAdapter(provider);
  try {
    return adapter(data);
  } catch (error) {
    console.error(`Error parsing ${provider} model data:`, error);
    return [];
  }
};
