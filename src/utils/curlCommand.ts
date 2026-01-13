import { CustomModel } from "@/aiParams";
import { ChatModelProviders, EmbeddingModelProviders, ProviderInfo } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";

// ============================================================================
// Types
// ============================================================================

export type BuildCurlCommandResult =
  | { ok: true; command: string; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

interface CurlRequestSpec {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  curlArgs?: string[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_BEDROCK_ANTHROPIC_VERSION = "bedrock-2023-05-31";
const DEFAULT_CHAT_MESSAGE = "Hello!";
const DEFAULT_EMBEDDING_INPUT = "Hello!";
const DEFAULT_OPENAI_MAX_TOKENS = 64;
const DEFAULT_ANTHROPIC_MAX_TOKENS = 256;
const DEFAULT_BEDROCK_MAX_TOKENS = 256;
const DEFAULT_GOOGLE_MAX_OUTPUT_TOKENS = 256;

/** Providers that use OpenAI-compatible API format */
const OPENAI_COMPATIBLE_PROVIDERS = new Set<string>([
  ChatModelProviders.OPENAI,
  EmbeddingModelProviders.OPENAI,
  ChatModelProviders.OPENROUTERAI,
  ChatModelProviders.GROQ,
  ChatModelProviders.XAI,
  ChatModelProviders.SILICONFLOW,
  EmbeddingModelProviders.SILICONFLOW,
  ChatModelProviders.OPENAI_FORMAT,
  EmbeddingModelProviders.OPENAI_FORMAT,
  ChatModelProviders.LM_STUDIO,
  EmbeddingModelProviders.LM_STUDIO,
  ChatModelProviders.MISTRAL,
  ChatModelProviders.DEEPSEEK,
  // Note: Ollama uses native API (/api/chat), not OpenAI-compatible
]);

// ============================================================================
// Helper Functions
// ============================================================================

/** Removes trailing slashes from a string */
function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, "");
}

/** Attempts to parse a URL, returning null when invalid */
function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Escapes a string for safe inclusion in a single-quoted shell string */
function escapeForSingleQuotedString(value: string): string {
  return value.replace(/'/g, "'\"'\"'");
}

/** Gets the default base URL for curl generation from ProviderInfo */
function getProviderCurlBaseURL(provider: string): string {
  const info = ProviderInfo[provider as keyof typeof ProviderInfo];
  return (info?.curlBaseURL ?? info?.host ?? "").trim();
}

/**
 * Resolves API key for curl generation.
 * Falls back to placeholder when key is missing or cannot be decrypted.
 */
async function resolveApiKeyForCurl(
  apiKeyInput: string | undefined
): Promise<{ apiKey: string; warnings: string[] }> {
  const warnings: string[] = [];
  const trimmed = apiKeyInput?.trim() ?? "";

  if (!trimmed) {
    warnings.push("API key is empty; using placeholder.");
    return { apiKey: "<YOUR_API_KEY>", warnings };
  }

  try {
    const decrypted = (await getDecryptedKey(trimmed))?.trim();
    if (!decrypted || decrypted === "Copilot failed to decrypt API keys!") {
      warnings.push("API key could not be decrypted; using placeholder.");
      return { apiKey: "<YOUR_API_KEY>", warnings };
    }
    return { apiKey: decrypted, warnings };
  } catch {
    warnings.push("API key could not be decrypted; using placeholder.");
    return { apiKey: "<YOUR_API_KEY>", warnings };
  }
}

/** Strips OpenAI-style endpoint suffixes to avoid duplication */
function stripOpenAIEndpointSuffix(baseUrl: string): string {
  const trimmed = trimTrailingSlashes(baseUrl);
  const suffixes = ["/chat/completions", "/embeddings", "/responses"];

  for (const suffix of suffixes) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length);
    }
  }
  return trimmed;
}

/**
 * Normalizes Google API base URL for curl generation.
 * - Strips trailing slashes and /models suffix
 * - Ensures /v1beta is present (SDK auto-appends it, so curl should simulate this)
 */
function normalizeGoogleBaseUrl(baseUrl: string): string {
  let normalized = trimTrailingSlashes(baseUrl);

  // Strip /models suffix if present
  if (normalized.endsWith("/models")) {
    normalized = normalized.slice(0, -7);
  }

  // If URL doesn't contain version path, append /v1beta to simulate SDK behavior
  if (!normalized.includes("/v1beta") && !normalized.includes("/v1")) {
    normalized = `${normalized}/v1beta`;
  }

  return normalized;
}

/**
 * Normalizes Ollama base URL by removing /api, /v1, or combined suffixes.
 * Ollama native API uses /api/chat and /api/embed endpoints.
 */
function normalizeOllamaBaseUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlashes(baseUrl);
  const suffixes = ["/api/v1", "/v1", "/api"];

  for (const suffix of suffixes) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length);
    }
  }

  return trimmed;
}

/** Formats a curl command from request specification */
function formatCurlCommand(spec: CurlRequestSpec): string {
  const parts: string[] = [];
  const urlEscaped = escapeForSingleQuotedString(spec.url);

  parts.push(`curl --request ${spec.method} '${urlEscaped}'`);

  for (const arg of spec.curlArgs ?? []) {
    parts.push(`  ${arg}`);
  }

  // Order headers for readability
  const orderedKeys = [
    "Content-Type",
    "Accept",
    "Authorization",
    "x-goog-api-key",
    "api-key",
    "x-api-key",
    "anthropic-version",
    "OpenAI-Organization",
  ];

  const headers = spec.headers ?? {};
  const emitted = new Set<string>();

  for (const key of orderedKeys) {
    if (headers[key] !== undefined) {
      emitted.add(key);
      parts.push(`  --header '${escapeForSingleQuotedString(`${key}: ${headers[key]}`)}'`);
    }
  }

  for (const key of Object.keys(headers).sort()) {
    if (!emitted.has(key)) {
      parts.push(`  --header '${escapeForSingleQuotedString(`${key}: ${headers[key]}`)}'`);
    }
  }

  if (spec.body !== undefined) {
    const json = JSON.stringify(spec.body, null, 2);
    parts.push(`  --data-raw '${escapeForSingleQuotedString(json)}'`);
  }

  return parts.join(" \\\n");
}

// ============================================================================
// OpenAI-Compatible Provider Builder
// ============================================================================

/** Builds curl request spec for OpenAI-compatible APIs */
async function buildOpenAICompatibleRequestSpec(
  model: CustomModel,
  isEmbeddingModel: boolean
): Promise<{ ok: true; spec: CurlRequestSpec; warnings: string[] } | { ok: false; error: string; warnings: string[] }> {
  const warnings: string[] = [];
  const provider = model.provider?.trim() ?? "";

  const providerBase = getProviderCurlBaseURL(provider);
  const baseUrlOverride = model.baseUrl?.trim() ?? "";

  // Build base URL (deterministic - no guessing /v1)
  const baseCandidate = trimTrailingSlashes(
    baseUrlOverride || providerBase || "https://api.example.com/v1"
  );
  const apiBase = stripOpenAIEndpointSuffix(baseCandidate);

  // Model name
  const modelName = model.name?.trim() || "<MODEL_NAME>";
  if (!model.name?.trim()) {
    warnings.push("Model name is empty; using placeholder.");
  }

  // API key
  const apiKeyResolved = await resolveApiKeyForCurl(model.apiKey);
  warnings.push(...apiKeyResolved.warnings);

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKeyResolved.apiKey}`,
  };

  // Add OpenAI org ID if present
  if (model.openAIOrgId?.trim()) {
    headers["OpenAI-Organization"] = model.openAIOrgId.trim();
  }

  // Add OpenRouter-specific headers (see chatModelManager.ts:259-262)
  if (provider === ChatModelProviders.OPENROUTERAI) {
    headers["HTTP-Referer"] = "https://obsidiancopilot.com";
    headers["X-Title"] = "Obsidian Copilot";
  }

  if (isEmbeddingModel) {
    return {
      ok: true,
      warnings,
      spec: {
        method: "POST",
        url: `${apiBase}/embeddings`,
        headers,
        body: {
          model: modelName,
          input: DEFAULT_EMBEDDING_INPUT,
        },
      },
    };
  }

  return {
    ok: true,
    warnings,
    spec: {
      method: "POST",
      url: `${apiBase}/chat/completions`,
      headers,
      body: {
        model: modelName,
        messages: [{ role: "user", content: DEFAULT_CHAT_MESSAGE }],
        stream: false,
        max_tokens: DEFAULT_OPENAI_MAX_TOKENS,
      },
    },
  };
}

// ============================================================================
// Azure OpenAI Builder
// ============================================================================

/** Builds Azure OpenAI endpoint URL */
function buildAzureEndpointUrl(
  model: CustomModel,
  deploymentName: string,
  endpoint: string,
  apiVersion: string
): { url: string; warnings: string[] } {
  const warnings: string[] = [];
  const instanceName = model.azureOpenAIApiInstanceName?.trim() || "[instance]";

  if (!model.azureOpenAIApiInstanceName?.trim()) {
    warnings.push("Azure instance name is empty; using placeholder.");
  }

  const baseOverride = model.baseUrl?.trim();
  if (baseOverride) {
    const parsed = tryParseUrl(baseOverride);
    if (parsed) {
      let basePath = trimTrailingSlashes(parsed.pathname || "");

      // Avoid duplicating /openai/deployments/ path
      if (basePath.includes("/openai/deployments/")) {
        basePath = basePath.split("/openai/deployments/")[0];
      }

      const base = `${parsed.origin}${basePath}`;
      return {
        warnings,
        url: `${base}/openai/deployments/${encodeURIComponent(deploymentName)}/${endpoint}?api-version=${encodeURIComponent(apiVersion)}`,
      };
    }
  }

  return {
    warnings,
    url: `https://${instanceName}.openai.azure.com/openai/deployments/${encodeURIComponent(deploymentName)}/${endpoint}?api-version=${encodeURIComponent(apiVersion)}`,
  };
}

/** Builds curl request spec for Azure OpenAI */
async function buildAzureOpenAIRequestSpec(
  model: CustomModel,
  isEmbeddingModel: boolean
): Promise<
  { ok: true; spec: CurlRequestSpec; warnings: string[] } | { ok: false; error: string; warnings: string[] }
> {
  const warnings: string[] = [];

  const apiKeyResolved = await resolveApiKeyForCurl(model.apiKey);
  warnings.push(...apiKeyResolved.warnings);

  const deploymentName = isEmbeddingModel
    ? model.azureOpenAIApiEmbeddingDeploymentName?.trim() || "[deployment]"
    : model.azureOpenAIApiDeploymentName?.trim() || "[deployment]";

  if (!deploymentName || deploymentName === "[deployment]") {
    warnings.push("Azure deployment name is empty; using placeholder.");
  }

  const apiVersion = model.azureOpenAIApiVersion?.trim() || "[api-version]";
  if (!model.azureOpenAIApiVersion?.trim()) {
    warnings.push("Azure api-version is empty; using placeholder.");
  }

  const endpoint = isEmbeddingModel ? "embeddings" : "chat/completions";
  const endpointUrl = buildAzureEndpointUrl(model, deploymentName, endpoint, apiVersion);
  warnings.push(...endpointUrl.warnings);

  const body = isEmbeddingModel
    ? { input: DEFAULT_EMBEDDING_INPUT }
    : {
        messages: [{ role: "user", content: DEFAULT_CHAT_MESSAGE }],
        stream: false,
        max_tokens: DEFAULT_OPENAI_MAX_TOKENS,
      };

  return {
    ok: true,
    warnings,
    spec: {
      method: "POST",
      url: endpointUrl.url,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": apiKeyResolved.apiKey,
      },
      body,
    },
  };
}

// ============================================================================
// Anthropic Builder
// ============================================================================

/** Builds curl request spec for Anthropic Messages API */
async function buildAnthropicRequestSpec(
  model: CustomModel
): Promise<
  { ok: true; spec: CurlRequestSpec; warnings: string[] } | { ok: false; error: string; warnings: string[] }
> {
  const warnings: string[] = [];

  const baseOverride = model.baseUrl?.trim() ?? "";
  const providerBase = getProviderCurlBaseURL(ChatModelProviders.ANTHROPIC);
  let apiBase = trimTrailingSlashes(baseOverride || providerBase || "https://api.anthropic.com");
  // Strip known suffixes to avoid duplication
  const anthropicSuffixes = ["/v1/messages", "/v1"];
  for (const suffix of anthropicSuffixes) {
    if (apiBase.endsWith(suffix)) {
      apiBase = apiBase.slice(0, -suffix.length);
      break;
    }
  }
  const url = `${apiBase}/v1/messages`;

  const apiKeyResolved = await resolveApiKeyForCurl(model.apiKey);
  warnings.push(...apiKeyResolved.warnings);

  const modelName = model.name?.trim() || "<MODEL_NAME>";
  if (!model.name?.trim()) {
    warnings.push("Model name is empty; using placeholder.");
  }

  return {
    ok: true,
    warnings,
    spec: {
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": apiKeyResolved.apiKey,
        "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
      },
      body: {
        model: modelName,
        max_tokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
        messages: [{ role: "user", content: DEFAULT_CHAT_MESSAGE }],
      },
    },
  };
}

// ============================================================================
// Google Gemini Builder
// ============================================================================

/**
 * Builds curl request spec for Google Generative Language API (Gemini).
 * Uses x-goog-api-key header for authentication.
 */
async function buildGoogleGenerativeAIRequestSpec(
  model: CustomModel,
  isEmbeddingModel: boolean
): Promise<
  { ok: true; spec: CurlRequestSpec; warnings: string[] } | { ok: false; error: string; warnings: string[] }
> {
  const warnings: string[] = [];

  // Build base URL - normalize to ensure /v1beta is present (simulates SDK behavior)
  const baseOverride = model.baseUrl?.trim() ?? "";
  const providerBase = getProviderCurlBaseURL(ChatModelProviders.GOOGLE);
  const baseCandidate = baseOverride || providerBase || "https://generativelanguage.googleapis.com";
  const apiBase = normalizeGoogleBaseUrl(baseCandidate);

  // Model name - Gemini expects "models/{model}" format
  const modelName = model.name?.trim() || "<MODEL_NAME>";
  if (!model.name?.trim()) {
    warnings.push("Model name is empty; using placeholder.");
  }
  const modelPath = modelName.includes("/") ? modelName : `models/${modelName}`;

  // API key
  const apiKeyResolved = await resolveApiKeyForCurl(model.apiKey);
  warnings.push(...apiKeyResolved.warnings);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-goog-api-key": apiKeyResolved.apiKey,
  };

  if (isEmbeddingModel) {
    return {
      ok: true,
      warnings,
      spec: {
        method: "POST",
        url: `${apiBase}/${modelPath}:embedContent`,
        headers,
        body: {
          content: {
            parts: [{ text: DEFAULT_EMBEDDING_INPUT }],
          },
        },
      },
    };
  }

  return {
    ok: true,
    warnings,
    spec: {
      method: "POST",
      url: `${apiBase}/${modelPath}:generateContent`,
      headers,
      body: {
        contents: [
          {
            role: "user",
            parts: [{ text: DEFAULT_CHAT_MESSAGE }],
          },
        ],
        generationConfig: {
          maxOutputTokens: DEFAULT_GOOGLE_MAX_OUTPUT_TOKENS,
        },
      },
    },
  };
}

// ============================================================================
// Amazon Bedrock Builder
// ============================================================================

/** Checks if Bedrock model ID is Anthropic-based */
function isBedrockAnthropicModel(modelId: string): boolean {
  return /(^|\.)anthropic\./.test(modelId);
}

/** Builds curl command for Amazon Bedrock (provides both auth options) */
async function buildBedrockCurlText(model: CustomModel): Promise<BuildCurlCommandResult> {
  const warnings: string[] = [];

  const modelId = model.name?.trim() || "<MODEL_ID>";
  if (!model.name?.trim()) {
    warnings.push("Model name is empty; using placeholder.");
  }

  const region = model.bedrockRegion?.trim() || "us-east-1";
  if (!model.bedrockRegion?.trim()) {
    warnings.push("Bedrock region is empty; defaulting to us-east-1.");
  }

  const baseOverride = model.baseUrl?.trim();
  const endpointBase = trimTrailingSlashes(
    baseOverride || `https://bedrock-runtime.${region}.amazonaws.com`
  );
  const invokeUrl = `${endpointBase}/model/${encodeURIComponent(modelId)}/invoke`;

  // Build request body
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: [{ type: "text", text: DEFAULT_CHAT_MESSAGE }] }],
    max_tokens: DEFAULT_BEDROCK_MAX_TOKENS,
  };

  if (isBedrockAnthropicModel(modelId)) {
    body.anthropic_version = DEFAULT_BEDROCK_ANTHROPIC_VERSION;
  } else {
    warnings.push("Model ID does not look like Anthropic; request body may need adjustment.");
  }

  const apiKeyResolved = await resolveApiKeyForCurl(model.apiKey);
  warnings.push(...apiKeyResolved.warnings);

  // Option A: Bearer token auth
  const bearerSpec: CurlRequestSpec = {
    method: "POST",
    url: invokeUrl,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKeyResolved.apiKey}`,
    },
    body,
  };

  // Option B: AWS SigV4 auth
  const sigV4Spec: CurlRequestSpec = {
    method: "POST",
    url: invokeUrl,
    curlArgs: [
      `--aws-sigv4 'aws:amz:${escapeForSingleQuotedString(region)}:bedrock'`,
      `--user '<AWS_ACCESS_KEY_ID>:<AWS_SECRET_ACCESS_KEY>'`,
    ],
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
  };

  const commandText = [
    "# Amazon Bedrock InvokeModel",
    "# Option A: Bearer token auth (matches Obsidian Copilot)",
    formatCurlCommand(bearerSpec),
    "",
    "# Option B: IAM auth (AWS SigV4)",
    formatCurlCommand(sigV4Spec),
  ].join("\n");

  return { ok: true, command: commandText, warnings };
}

// ============================================================================
// Ollama Builder
// ============================================================================

/**
 * Builds curl request spec for Ollama native API.
 * Uses /api/chat for chat models and /api/embed for embedding models.
 * Default base URL is http://localhost:11434.
 */
async function buildOllamaRequestSpec(
  model: CustomModel,
  isEmbeddingModel: boolean
): Promise<
  { ok: true; spec: CurlRequestSpec; warnings: string[] } | { ok: false; error: string; warnings: string[] }
> {
  const warnings: string[] = [];

  // Build base URL (deterministic - curlBaseURL is http://localhost:11434)
  const baseOverride = model.baseUrl?.trim() ?? "";
  const providerBase = getProviderCurlBaseURL(ChatModelProviders.OLLAMA);
  const apiBase = normalizeOllamaBaseUrl(
    trimTrailingSlashes(baseOverride || providerBase || "http://localhost:11434")
  );

  // Model name
  const modelName = model.name?.trim() || "<MODEL_NAME>";
  if (!model.name?.trim()) {
    warnings.push("Model name is empty; using placeholder.");
  }

  // Build headers - only add Authorization for remote/cloud deployments with API key
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Ollama local deployments (localhost) typically don't require auth
  // Only add Authorization header if user has provided an API key
  const hasApiKey = model.apiKey?.trim();
  if (hasApiKey) {
    const apiKeyResolved = await resolveApiKeyForCurl(model.apiKey);
    // Filter out "API key is empty" warnings for Ollama since it's often optional
    const filteredWarnings = apiKeyResolved.warnings.filter(
      (w) => !w.includes("API key is empty")
    );
    warnings.push(...filteredWarnings);
    headers.Authorization = `Bearer ${apiKeyResolved.apiKey}`;
  }

  if (isEmbeddingModel) {
    return {
      ok: true,
      warnings,
      spec: {
        method: "POST",
        url: `${apiBase}/api/embed`,
        headers,
        body: {
          model: modelName,
          input: DEFAULT_EMBEDDING_INPUT,
          truncate: true,
        },
      },
    };
  }

  return {
    ok: true,
    warnings,
    spec: {
      method: "POST",
      url: `${apiBase}/api/chat`,
      headers,
      body: {
        model: modelName,
        messages: [{ role: "user", content: DEFAULT_CHAT_MESSAGE }],
        stream: false,
      },
    },
  };
}

// ============================================================================
// Main Entry Function
// ============================================================================

/**
 * Builds an example curl command for the provided model configuration.
 * Intended for debugging connectivity and validating request formats.
 */
export async function buildCurlCommandForModel(model: CustomModel): Promise<BuildCurlCommandResult> {
  const warnings: string[] = [];
  const provider = model.provider?.trim();

  if (!provider) {
    return { ok: false, error: "Provider is required to build a curl command.", warnings };
  }

  const isEmbeddingModel = Boolean(model.isEmbeddingModel);

  // Azure OpenAI
  if (provider === ChatModelProviders.AZURE_OPENAI) {
    const result = await buildAzureOpenAIRequestSpec(model, isEmbeddingModel);
    if (!result.ok) return result;
    return { ok: true, command: formatCurlCommand(result.spec), warnings: result.warnings };
  }

  // Anthropic
  if (provider === ChatModelProviders.ANTHROPIC) {
    if (isEmbeddingModel) {
      return { ok: false, error: "Anthropic does not support embeddings.", warnings };
    }
    const result = await buildAnthropicRequestSpec(model);
    if (!result.ok) return result;
    return { ok: true, command: formatCurlCommand(result.spec), warnings: result.warnings };
  }

  // Amazon Bedrock
  if (provider === ChatModelProviders.AMAZON_BEDROCK) {
    if (isEmbeddingModel) {
      return { ok: false, error: "Bedrock embeddings are not supported by this generator.", warnings };
    }
    return await buildBedrockCurlText(model);
  }

  // Google Gemini
  if (provider === ChatModelProviders.GOOGLE || provider === EmbeddingModelProviders.GOOGLE) {
    const result = await buildGoogleGenerativeAIRequestSpec(model, isEmbeddingModel);
    if (!result.ok) return result;
    return { ok: true, command: formatCurlCommand(result.spec), warnings: result.warnings };
  }

  // Ollama (native API)
  if (provider === ChatModelProviders.OLLAMA || provider === EmbeddingModelProviders.OLLAMA) {
    const result = await buildOllamaRequestSpec(model, isEmbeddingModel);
    if (!result.ok) return result;
    return { ok: true, command: formatCurlCommand(result.spec), warnings: result.warnings };
  }

  // OpenAI-compatible providers
  if (OPENAI_COMPATIBLE_PROVIDERS.has(provider)) {
    const result = await buildOpenAICompatibleRequestSpec(model, isEmbeddingModel);
    if (!result.ok) return result;
    return { ok: true, command: formatCurlCommand(result.spec), warnings: result.warnings };
  }

  return { ok: false, error: `Provider "${provider}" is not supported for curl generation.`, warnings };
}
