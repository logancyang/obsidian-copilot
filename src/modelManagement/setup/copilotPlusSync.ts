/**
 * Reconciles the Copilot Plus provider with the user's current Plus state.
 *
 * Plus has no model-list endpoint, so the model set is a hardcoded snapshot
 * (`COPILOT_PLUS_MODELS`). `syncCopilotPlusProvider` is the single bridge the
 * plugin host calls on Plus sign-in / sign-out (and once on load): it
 * registers the Plus provider when signed in (with a key) and unregisters it
 * otherwise. Both `register`/`unregister` are idempotent, so calling this on
 * every relevant settings change is safe.
 */

import { BREVILABS_MODELS_BASE_URL, ChatModels } from "@/constants";
import { getDecryptedKey } from "@/encryptionService";
import { logError } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { ModelInfo } from "@/modelManagement/types/catalog";

/**
 * The Copilot Plus models the brevilabs relay exposes. Hardcoded — Plus offers
 * a single curated chat model today and there's no relay catalog to fetch. Wire
 * ids must match what the relay accepts; opencode routes them as
 * `copilot-plus/<id>` (see `mapProviderToOpencodeId`).
 */
export const COPILOT_PLUS_MODELS: readonly ModelInfo[] = Object.freeze([
  {
    id: ChatModels.COPILOT_PLUS_FLASH,
    displayName: "Copilot Plus Flash",
    toolCall: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  },
]);

/**
 * Register or unregister the Plus provider to match Plus state. Best-effort:
 * a failure is logged, not thrown, since this runs as background reconciliation
 * off a settings change.
 *
 * `licenseKey` is the RAW stored key (still encrypted on disk) — the same value
 * the rest of the plugin gates on (`brevilabsClient`, `plusUtils`). The
 * register/unregister decision keys on sign-in state (`isPaidUser` + a stored
 * key), NOT on whether that key happens to decrypt: a decrypt failure (Electron
 * `safeStorage` unavailable, a vault synced to another machine) must not tear
 * down the persisted provider + the user's curation. Decryption is only for the
 * relay Bearer token, and a failed decrypt leaves the previously-stored token
 * untouched rather than overwriting it with "".
 */
export async function syncCopilotPlusProvider(
  api: ModelManagementApi,
  isPaidUser: boolean,
  licenseKey: string | undefined
): Promise<void> {
  try {
    if (isPaidUser && licenseKey) {
      const token = await getDecryptedKey(licenseKey);
      await api.setup.copilotPlus.registerPlusProvider({
        providerType: "openai-compatible",
        displayName: "Copilot Plus",
        baseUrl: BREVILABS_MODELS_BASE_URL,
        // Only refresh the stored relay token when decryption succeeded; ""
        // would clobber a previously-good keychain entry, and `undefined` makes
        // `registerPlusProvider` leave the existing token in place.
        apiKey: token || undefined,
        models: COPILOT_PLUS_MODELS,
      });
    } else {
      await api.setup.copilotPlus.unregisterPlusProvider();
    }
  } catch (err) {
    logError("[modelManagement] Copilot Plus provider sync failed", err);
  }
}
