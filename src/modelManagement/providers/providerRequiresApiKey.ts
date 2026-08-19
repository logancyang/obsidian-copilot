import type { Provider } from "@/modelManagement/types/persisted";

/**
 * The single runtime read point for "does this provider need an API key".
 *
 * Reads the explicit, persisted `Provider.requiresApiKey` flag — written at
 * every creation path (BYOK setup, agent setup, Plus sign-in) and backfilled
 * onto legacy rows by the settings-v5 migration. Self-hosting is NOT the
 * criteria — a self-hosted endpoint can sit behind an auth proxy, and a hosted
 * provider can be keyless — so the answer is always the stored flag.
 *
 * The `?? true` is a defensive backstop only: post-migration every persisted
 * row carries the flag, but a stray flagless row defaults to key-requiring so a
 * key-gated provider is never silently treated as keyless.
 */
export function providerRequiresApiKey(provider: Provider): boolean {
  return provider.requiresApiKey ?? true;
}

/**
 * Returns whether a runtime must resolve a credential before using this provider.
 * Optional-auth providers become authenticated once they own a keychain pointer;
 * a dangling pointer must fail closed instead of silently changing request semantics.
 *
 * @param provider - Persisted provider whose runtime credential contract is being evaluated.
 */
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
