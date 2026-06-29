/**
 * Tests for `syncCopilotPlusProvider` — the sign-in/sign-out bridge that
 * reconciles the singleton Copilot Plus provider.
 *
 * The register/unregister decision must key on Plus sign-in state (`isPlusUser`
 * + a raw stored key), NOT on whether that key decrypts. A decrypt failure
 * (safeStorage unavailable, vault synced to another machine) returns "" from
 * `getDecryptedKey`; treating that as sign-out would tear down the persisted
 * provider + user curation. These tests pin that down.
 */

import {
  COPILOT_PLUS_DEFAULT_ENABLED_MODELS,
  COPILOT_PLUS_MODELS,
  syncCopilotPlusProvider,
} from "./copilotPlusSync";

import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { RegisterPlusProviderInput } from "@/modelManagement/setup/CopilotPlusSetupApi";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const getDecryptedKey = jest.fn<Promise<string>, [string]>();
jest.mock("@/encryptionService", () => ({
  getDecryptedKey: (k: string) => getDecryptedKey(k),
}));

function makeApi() {
  const registerPlusProvider = jest.fn(async (_input: RegisterPlusProviderInput) => ({
    providerId: "plus-1",
    configuredModelIds: [] as string[],
  }));
  const unregisterPlusProvider = jest.fn(async () => {});
  const api = {
    setup: { copilotPlus: { registerPlusProvider, unregisterPlusProvider } },
  } as unknown as ModelManagementApi;
  return { api, registerPlusProvider, unregisterPlusProvider };
}

beforeEach(() => {
  getDecryptedKey.mockReset();
});

describe("syncCopilotPlusProvider", () => {
  it("registers with the decrypted token when signed in with a decryptable key", async () => {
    getDecryptedKey.mockResolvedValue("decrypted-token");
    const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();

    await syncCopilotPlusProvider(api, true, "enc_desk_raw");

    expect(getDecryptedKey).toHaveBeenCalledWith("enc_desk_raw");
    expect(unregisterPlusProvider).not.toHaveBeenCalled();
    expect(registerPlusProvider).toHaveBeenCalledTimes(1);
    expect(registerPlusProvider.mock.calls[0][0]).toMatchObject({
      apiKey: "decrypted-token",
      models: COPILOT_PLUS_MODELS,
      // Only the default-on subset (flash) auto-enrolls; the rest ship off.
      autoEnrollModelIds: COPILOT_PLUS_DEFAULT_ENABLED_MODELS,
    });
  });

  it("curated list ships the full lineup but defaults only copilot-plus-flash to on", () => {
    const ids = COPILOT_PLUS_MODELS.map((m) => m.id);
    expect(ids).toEqual([
      "copilot-plus-flash",
      "kimi-k2.6",
      "glm-5.2",
      "kimi-k2.7-code",
      "deepseek-v4-pro",
      "mimo-v2.5",
      "minimax-m2.7",
    ]);
    expect(COPILOT_PLUS_DEFAULT_ENABLED_MODELS).toEqual(["copilot-plus-flash"]);
  });

  it("still registers (never tears down) when the stored key fails to decrypt, leaving the token untouched", async () => {
    // Decrypt failure: getDecryptedKey returns "" but the raw key is present
    // and the user is still a Plus user.
    getDecryptedKey.mockResolvedValue("");
    const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();

    await syncCopilotPlusProvider(api, true, "enc_desk_raw");

    expect(unregisterPlusProvider).not.toHaveBeenCalled();
    expect(registerPlusProvider).toHaveBeenCalledTimes(1);
    // `undefined` makes registerPlusProvider leave the existing keychain token
    // in place rather than overwriting it with "".
    expect(registerPlusProvider.mock.calls[0][0].apiKey).toBeUndefined();
  });

  it("unregisters when not a Plus user", async () => {
    const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();

    await syncCopilotPlusProvider(api, false, "enc_desk_raw");

    expect(registerPlusProvider).not.toHaveBeenCalled();
    expect(unregisterPlusProvider).toHaveBeenCalledTimes(1);
    // No need to decrypt on the teardown path.
    expect(getDecryptedKey).not.toHaveBeenCalled();
  });

  it("unregisters when signed in but no key is stored", async () => {
    const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();

    await syncCopilotPlusProvider(api, true, "");

    expect(registerPlusProvider).not.toHaveBeenCalled();
    expect(unregisterPlusProvider).toHaveBeenCalledTimes(1);
  });

  it("swallows errors (best-effort background reconcile)", async () => {
    getDecryptedKey.mockResolvedValue("decrypted-token");
    const { api, registerPlusProvider } = makeApi();
    registerPlusProvider.mockRejectedValueOnce(new Error("boom"));

    await expect(syncCopilotPlusProvider(api, true, "enc_desk_raw")).resolves.toBeUndefined();
  });
});
