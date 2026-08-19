import type { Provider } from "@/modelManagement/types/persisted";
import type { KeychainService } from "@/services/keychainService";

/**
 * The single runtime read point for "does this provider have an API key on
 * THIS device".
 *
 * `provider.apiKeyKeychainId` alone cannot answer that question: the pointer
 * syncs with `data.json`, while the keychain entry it names is device-local.
 * After "Delete All Keys" the pointer survives on purpose (clearing it would
 * strand the still-valid entries other devices hold), so a pointer-only check
 * reports "API key set" for a key this device no longer has. The honest
 * answer is a live local read: the pointer supplies the address, the keychain
 * supplies the fact.
 *
 * Returns `false` for a tombstoned entry (`""`) and for any keychain failure —
 * an unreadable key is indistinguishable from an absent one at the "is it
 * configured?" level, and rendering must never throw.
 *
 * https://github.com/logancyang/obsidian-copilot-preview/issues/261
 *
 * @param provider - The provider row whose configured state is being asked.
 * @param keychain - Keychain reader used for the live presence check.
 */
export function providerHasApiKey(
  provider: Provider,
  keychain: Pick<KeychainService, "getSecretById">
): boolean {
  if (!provider.apiKeyKeychainId) return false;
  try {
    return !!keychain.getSecretById(provider.apiKeyKeychainId);
  } catch {
    return false;
  }
}
