import { getDecryptedKey } from "@/encryptionService";
import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import { AcpBackend, AcpSpawnDescriptor } from "./types";

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
    const settings = getSettings();
    const binaryPath = settings.agentMode?.binaryPath;
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
 * Only providers with a non-empty key are included so opencode doesn't show
 * configured-but-unauthorized providers in its picker.
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

  const provider: Record<string, { options: { apiKey: string } }> = {};
  for (const entry of decrypted) {
    if (entry) provider[entry.providerId] = { options: { apiKey: entry.apiKey } };
  }

  if (Object.keys(provider).length === 0) {
    logInfo(
      "[AgentMode] no BYOK keys found; opencode will rely on its own auth. Set provider keys in Copilot settings to use Agent Mode end-to-end."
    );
  }

  return { provider };
}
