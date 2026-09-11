import type { App } from "obsidian";
import { logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { getAgentVoiceSettings, setSettings, type AgentVoiceSettings } from "@/settings/model";

/**
 * Vault-namespaced id of the keychain entry holding the demo bearer
 * credential. The `copilot-v{vaultId}-` prefix is what "Delete all keys" and
 * vault cleanup sweep, so an entry stored outside it would outlive the vault.
 *
 * @param vaultId Keychain namespace of the current vault.
 */
export function voiceCredentialKeychainId(vaultId: string): string {
  return `copilot-v${vaultId}-voice-credential`;
}

/**
 * Reads the configured voice credential.
 *
 * @param app Obsidian app whose keychain holds the entry.
 * @param voice Voice settings naming the keychain entry to read.
 * @returns The credential, or null when none is stored or the keychain is
 *   unavailable in this Obsidian version.
 */
export function readVoiceCredential(app: App, voice: AgentVoiceSettings): string | null {
  const keychainId = voice.credentialKeychainId;
  if (!keychainId) return null;
  const keychain = KeychainService.getInstance(app);
  if (!keychain.isAvailable()) {
    logWarn("[Voice] the OS keychain is unavailable, so the credential cannot be read");
    return null;
  }
  const value = keychain.getSecretById(keychainId);
  return value && value.length > 0 ? value : null;
}

/**
 * Stores or clears the voice credential, keeping the settings reference and
 * the keychain entry consistent. The credential value itself never reaches
 * `data.json`, which syncs between devices.
 *
 * @param app Obsidian app whose keychain owns the entry.
 * @param credential The new credential; an empty value removes the entry.
 */
export function writeVoiceCredential(app: App, credential: string): void {
  const keychain = KeychainService.getInstance(app);
  if (!keychain.isAvailable()) {
    logWarn("[Voice] the OS keychain is unavailable, so the credential was not stored");
    return;
  }
  const keychainId = voiceCredentialKeychainId(keychain.getVaultId());
  if (credential.length === 0) {
    keychain.deleteSecretById(keychainId);
    setSettings((cur) => ({
      agentMode: {
        ...cur.agentMode,
        voice: { ...getAgentVoiceSettings(cur), credentialKeychainId: undefined },
      },
    }));
    return;
  }
  keychain.setSecretById(keychainId, credential);
  setSettings((cur) => ({
    agentMode: {
      ...cur.agentMode,
      voice: { ...getAgentVoiceSettings(cur), credentialKeychainId: keychainId },
    },
  }));
}
