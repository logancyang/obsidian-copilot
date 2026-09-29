import type { Provider } from "@/modelManagement/types/persisted";

export function providerRequiresApiKey(provider: Provider): boolean {
  return provider.requiresApiKey ?? true;
}

export function providerNeedsResolvedApiKey(provider: Provider): boolean {
  // Copilot Plus provisions a relay token instead of a user-entered BYOK key,
  // but every relay request still requires it.
  // https://github.com/logancyang/obsidian-copilot/issues/2895
  return (
    provider.origin.kind === "copilot-plus" ||
    providerRequiresApiKey(provider) ||
    !!provider.apiKeyKeychainId
  );
}
