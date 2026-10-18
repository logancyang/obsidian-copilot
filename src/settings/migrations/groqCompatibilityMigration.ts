import type { CopilotSettings } from "@/settings/model";

const GROQ_OPENAI_BASE_URL = "https://api.groq.com/openai/v1";

export function groqOpenAICompatibleBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return GROQ_OPENAI_BASE_URL;
  return `${trimmed.replace(/(\/openai\/v1|\/openai|\/v1)$/i, "")}/openai/v1`;
}

export function planGroqOpenAICompatibility(
  settings: CopilotSettings
): Partial<CopilotSettings> | null {
  let updatedProviders: CopilotSettings["providers"] | undefined;
  for (const [providerId, provider] of Object.entries(settings.providers ?? {})) {
    if (
      provider.origin.kind !== "byok" ||
      provider.origin.catalogProviderId !== "groq" ||
      provider.providerType !== "openai-compatible"
    ) {
      continue;
    }
    const baseUrl = groqOpenAICompatibleBaseUrl(provider.baseUrl);
    if (baseUrl === provider.baseUrl) continue;
    updatedProviders ??= { ...settings.providers };
    updatedProviders[providerId] = { ...provider, baseUrl };
  }
  return updatedProviders ? { providers: updatedProviders } : null;
}
