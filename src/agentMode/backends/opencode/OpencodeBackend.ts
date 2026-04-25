import type { CustomModel } from "@/aiParams";
import { BREVILABS_MODELS_BASE_URL, ChatModelProviders } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { logInfo, logWarn } from "@/logger";
import { findCustomModel } from "@/utils";
import { getSettings } from "@/settings/model";
import { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";

/**
 * Map from Copilot's `ChatModelProviders` enum value (as stored in
 * `CustomModel.provider`) to OpenCode's provider id (as it appears in
 * OpenCode's `availableModels` and config). Only providers in this map are
 * routable through OpenCode; everything else (Azure, Bedrock, Ollama,
 * LM Studio, GitHub Copilot, etc.) is filtered out of the picker.
 *
 * Copilot Plus is handled separately because it isn't a built-in OpenCode
 * provider — we register it as a custom `@ai-sdk/openai-compatible` entry
 * pointing at brevilabs and authed via the user's `plusLicenseKey`.
 */
export const OPENCODE_PROVIDER_MAP: Partial<Record<ChatModelProviders, string>> = {
  [ChatModelProviders.ANTHROPIC]: "anthropic",
  [ChatModelProviders.OPENAI]: "openai",
  [ChatModelProviders.GOOGLE]: "google",
  [ChatModelProviders.GROQ]: "groq",
  [ChatModelProviders.MISTRAL]: "mistral",
  [ChatModelProviders.DEEPSEEK]: "deepseek",
  [ChatModelProviders.OPENROUTERAI]: "openrouter",
  [ChatModelProviders.XAI]: "xai",
  [ChatModelProviders.COPILOT_PLUS]: "copilot-plus",
};

/** OpenCode provider id reserved for Copilot Plus's brevilabs proxy. */
const COPILOT_PLUS_PROVIDER_ID = "copilot-plus";

/** OpenCode-style model id: `<providerId>/<modelName>`. */
export function copilotModelToOpencodeId(model: CustomModel): string | undefined {
  const providerId = OPENCODE_PROVIDER_MAP[model.provider as ChatModelProviders];
  if (!providerId) return undefined;
  return `${providerId}/${model.name}`;
}

/**
 * Spawns `opencode acp --cwd <vault>` with `OPENCODE_CONFIG_CONTENT`
 * containing decrypted BYOK keys pulled from the existing Copilot settings.
 *
 * Reuses Copilot's top-level `*ApiKey` fields so users don't have to re-enter
 * them in an Agent Mode-specific settings panel.
 */
export class OpencodeBackend implements AcpBackend {
  readonly id = "opencode" as const;
  readonly displayName = "opencode";

  async buildSpawnDescriptor(ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor> {
    const binaryPath = getSettings().agentMode?.backends?.opencode?.binaryPath;
    if (!binaryPath) {
      throw new Error(
        "opencode binary not installed. Open Agent Mode settings and install it before starting a session."
      );
    }

    const config = await buildOpencodeConfig();

    return {
      command: binaryPath,
      args: ["acp", "--cwd", ctx.vaultBasePath],
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
    };
  }
}

/**
 * Build the `OPENCODE_CONFIG_CONTENT` payload from current Copilot settings.
 *
 *   - Per-provider `options.apiKey` is set for any BYOK key configured in
 *     Copilot, decrypted in-process.
 *   - Each enabled `activeModel` whose provider is in `OPENCODE_PROVIDER_MAP`
 *     is registered under `provider.<id>.models.<modelName>` so OpenCode
 *     reports it in `NewSessionResponse.models.availableModels` — that's how
 *     Copilot-configured models show up in the Agent Mode picker.
 *   - The top-level `model` field carries the user's sticky preference
 *     (translated from `selectedModelKey`) so a fresh session boots with the
 *     right default, even before `unstable_setSessionModel` is called.
 *
 * Exported for unit tests.
 */
export async function buildOpencodeConfig(): Promise<Record<string, unknown>> {
  const s = getSettings();

  type Mapping = { providerId: string; settingsKey: keyof typeof s };
  const mappings: Mapping[] = [
    { providerId: "anthropic", settingsKey: "anthropicApiKey" },
    { providerId: "openai", settingsKey: "openAIApiKey" },
    { providerId: "google", settingsKey: "googleApiKey" },
    { providerId: "groq", settingsKey: "groqApiKey" },
    { providerId: "mistral", settingsKey: "mistralApiKey" },
    { providerId: "deepseek", settingsKey: "deepseekApiKey" },
    { providerId: "openrouter", settingsKey: "openRouterAiApiKey" },
    { providerId: "xai", settingsKey: "xaiApiKey" },
  ];

  const decrypted = await Promise.all(
    mappings.map(async (m) => {
      const raw = s[m.settingsKey];
      if (typeof raw !== "string" || !raw) return null;
      const apiKey = await getDecryptedKey(raw);
      if (!apiKey) return null;
      return { providerId: m.providerId, apiKey };
    })
  );

  type ProviderConfig = {
    npm?: string;
    name?: string;
    options?: { apiKey?: string; baseURL?: string; headers?: Record<string, string> };
    models?: Record<string, Record<string, unknown>>;
  };
  const provider: Record<string, ProviderConfig> = {};
  for (const entry of decrypted) {
    if (entry) provider[entry.providerId] = { options: { apiKey: entry.apiKey } };
  }

  // Copilot Plus speaks OpenAI's wire format but isn't a built-in OpenCode
  // provider. Register it as a custom `@ai-sdk/openai-compatible` entry
  // pointing at brevilabs and authed via the user's `plusLicenseKey`.
  if (typeof s.plusLicenseKey === "string" && s.plusLicenseKey) {
    const licenseKey = await getDecryptedKey(s.plusLicenseKey);
    if (licenseKey) {
      provider[COPILOT_PLUS_PROVIDER_ID] = {
        npm: "@ai-sdk/openai-compatible",
        name: "Copilot Plus",
        options: { baseURL: BREVILABS_MODELS_BASE_URL, apiKey: licenseKey },
      };
    }
  }

  // Register Copilot-configured models under their respective providers so
  // OpenCode treats them as known when reporting `availableModels`. When the
  // top-level provider key is absent, fall back to the per-model `apiKey` so
  // models the user configured with a model-specific key still reach the
  // agent. Without this fallback any such model would be silently dropped.
  const injected: string[] = [];
  for (const model of s.activeModels ?? []) {
    if (!model.enabled) continue;
    if (model.isEmbeddingModel) continue;
    const providerId = OPENCODE_PROVIDER_MAP[model.provider as ChatModelProviders];
    if (!providerId) continue;

    if (!provider[providerId]) {
      const perModel = model.apiKey ? await getDecryptedKey(model.apiKey) : null;
      if (!perModel) {
        logWarn(
          `[AgentMode] skipping ${model.provider}/${model.name}: no API key (set the provider key in Copilot settings or on the model itself)`
        );
        continue;
      }
      provider[providerId] = { options: { apiKey: perModel } };
    }

    if (!provider[providerId].models) provider[providerId].models = {};
    provider[providerId].models[model.name] = {};
    injected.push(`${providerId}/${model.name}`);
  }

  if (injected.length > 0) {
    logInfo(
      `[AgentMode] injected ${injected.length} model(s) into opencode config: ${injected.join(", ")}`
    );
  } else if (Object.keys(provider).length === 0) {
    logInfo(
      "[AgentMode] no BYOK keys found; opencode will rely on its own auth. Set provider keys in Copilot settings to use Agent Mode end-to-end."
    );
  }

  const config: Record<string, unknown> = { provider };

  // Apply sticky model preference at spawn so the very first turn (before
  // `unstable_setSessionModel` lands) uses the user's pick.
  const selectedKey = s.agentMode?.backends?.opencode?.selectedModelKey;
  if (selectedKey) {
    try {
      const customModel = findCustomModel(selectedKey, s.activeModels ?? []);
      const opencodeId = copilotModelToOpencodeId(customModel);
      if (opencodeId) config.model = opencodeId;
    } catch {
      // Stale `selectedModelKey` (model was deleted) — ignore, fall back to
      // OpenCode's default.
    }
  }

  return config;
}
