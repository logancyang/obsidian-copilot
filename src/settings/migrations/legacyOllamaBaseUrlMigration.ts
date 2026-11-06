import { ChatModelProviders } from "@/constants";
import type { Provider } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";

function trimBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? "").trim().replace(/\/+$/, "");
}

export function planLegacyOllamaBaseUrlRepair(
  settings: Pick<CopilotSettings, "activeModels" | "providers">
): Record<string, Provider> | null {
  const legacyOllamaUrls = new Set(
    (settings.activeModels ?? [])
      .filter((model) => model.provider === (ChatModelProviders.OLLAMA as string))
      .map((model) => trimBaseUrl(model.baseUrl).toLowerCase())
      .filter(Boolean)
  );
  if (legacyOllamaUrls.size === 0) return null;

  let changed = false;
  const next: Record<string, Provider> = {};
  for (const [id, provider] of Object.entries(settings.providers)) {
    const baseUrl = trimBaseUrl(provider.baseUrl);
    // Copilot 3 reached Ollama through its native API root, so the BYOK migration copied a URL
    // without the /v1 that Ollama's OpenAI-compatible API needs, and every chat request 404ed.
    // https://github.com/logancyang/obsidian-copilot/issues/4109
    if (
      provider.origin.kind === "byok" &&
      !provider.origin.catalogProviderId &&
      provider.providerType === "openai-compatible" &&
      legacyOllamaUrls.has(baseUrl.toLowerCase()) &&
      !/\/v1$/i.test(baseUrl)
    ) {
      next[id] = { ...provider, baseUrl: `${baseUrl}/v1` };
      changed = true;
    } else {
      next[id] = provider;
    }
  }
  return changed ? next : null;
}
