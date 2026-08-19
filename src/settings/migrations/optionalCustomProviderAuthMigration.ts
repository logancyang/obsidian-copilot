import type { Provider } from "@/modelManagement";

/**
 * Makes authentication optional for existing custom OpenAI-compatible BYOK providers.
 * Stored keychain pointers remain intact, so authenticated providers keep failing
 * closed if their configured secret cannot be resolved.
 *
 * @param providers - Persisted provider map from the pre-v10 settings snapshot.
 */
export function planOptionalCustomProviderAuthMigration(
  providers: Record<string, Provider>
): Record<string, Provider> | null {
  let changed = false;
  const next: Record<string, Provider> = {};

  for (const [id, provider] of Object.entries(providers)) {
    const isCustomOpenAICompatible =
      provider.origin.kind === "byok" &&
      !provider.origin.catalogProviderId &&
      provider.providerType === "openai-compatible";

    // Existing rows persisted the old template default, not a user choice.
    // https://github.com/logancyang/obsidian-copilot/issues/2895
    if (isCustomOpenAICompatible && provider.requiresApiKey !== false) {
      next[id] = { ...provider, requiresApiKey: false };
      changed = true;
    } else {
      next[id] = provider;
    }
  }

  return changed ? next : null;
}
