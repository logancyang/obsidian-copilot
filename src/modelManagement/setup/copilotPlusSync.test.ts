import type { BrevilabsModelsResponse } from "@/LLMProviders/brevilabsClient";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { RegisterPlusProviderInput } from "@/modelManagement/setup/CopilotPlusSetupApi";
import { plusSyncNeeded, syncCopilotPlusProvider } from "@/modelManagement/setup/copilotPlusSync";
import { getSettings, resetSettings, setSettings } from "@/settings/model";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
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

/** A two-model lineup in the shape the models endpoint really publishes. */
function response(): BrevilabsModelsResponse {
  return {
    data: [
      {
        id: "copilot-plus-flash",
        label: "Copilot Plus Flash",
        description: "The default model.",
        context_length: "1M",
        supports_images: true,
        supports_tools: true,
        supports_reasoning: true,
        reasoning_efforts: [],
        default_enabled: true,
      },
      {
        id: "glm-5.2",
        label: "GLM-5.2",
        description: "A frontier open-weight model.",
        context_length: "256K",
        supports_images: false,
        supports_tools: true,
        supports_reasoning: true,
        reasoning_efforts: ["none", "high"],
        default_enabled: false,
      },
    ],
  };
}

describe("copilotPlusSync", () => {
  beforeEach(() => {
    resetSettings();
  });

  describe("plusSyncNeeded()", () => {
    const base = { isPaidUser: true, plusLicenseKey: "key-1" };

    it("stays false when a signed-in user's Reset Settings preserves the paid state (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      expect(plusSyncNeeded(base, { ...base })).toBe(false);
    });

    it("fires on a genuine sign-out or sign-in (isPaidUser flip)", () => {
      expect(plusSyncNeeded(base, { ...base, isPaidUser: false })).toBe(true);
      expect(plusSyncNeeded({ ...base, isPaidUser: false }, base)).toBe(true);
    });

    it("fires on a key rotation while signed in, but not while signed out", () => {
      expect(plusSyncNeeded(base, { ...base, plusLicenseKey: "key-2" })).toBe(true);
      expect(
        plusSyncNeeded(
          { isPaidUser: false, plusLicenseKey: "key-1" },
          { isPaidUser: false, plusLicenseKey: "key-2" }
        )
      ).toBe(false);
    });
  });

  describe("syncCopilotPlusProvider()", () => {
    it("registers with the Keychain-hydrated token and the published lineup", async () => {
      const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();

      await syncCopilotPlusProvider(api, true, "hydrated-token", async () => response());

      expect(unregisterPlusProvider).not.toHaveBeenCalled();
      const input = registerPlusProvider.mock.calls[0][0];
      expect(input.apiKey).toBe("hydrated-token");
      expect(input.models?.map((m) => m.id)).toEqual(["copilot-plus-flash", "glm-5.2"]);
      expect(input.autoEnrollModelIds).toEqual(["copilot-plus-flash"]);
    });

    it("caches the published lineup so later startups need no request", async () => {
      const { api } = makeApi();

      await syncCopilotPlusProvider(api, true, "token", async () => response());

      expect(getSettings().copilotPlusCatalog).toEqual({
        models: [
          {
            id: "copilot-plus-flash",
            displayName: "Copilot Plus Flash",
            description: "The default model.",
            toolCall: true,
            reasoning: true,
            reasoningEfforts: [],
            modalities: { input: ["text", "image"], output: ["text"] },
            limits: { context: 1024 * 1024 },
          },
          {
            id: "glm-5.2",
            displayName: "GLM-5.2",
            description: "A frontier open-weight model.",
            toolCall: true,
            reasoning: true,
            reasoningEfforts: ["none", "high"],
            modalities: { input: ["text"], output: ["text"] },
            limits: { context: 256 * 1024 },
          },
        ],
        defaultEnabledIds: ["copilot-plus-flash"],
      });
    });

    it("leaves the cache untouched when the lineup has not changed (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      // Every consumer of this cache rebuilds from a settings change, and for
      // OpenCode that means restarting the subprocess and replacing the user's
      // session. A reload that finds the same lineup must write nothing.
      const { api } = makeApi();
      await syncCopilotPlusProvider(api, true, "token", async () => response());
      const afterFirst = getSettings().copilotPlusCatalog;

      await syncCopilotPlusProvider(api, true, "token", async () => response());

      expect(getSettings().copilotPlusCatalog).toBe(afterFirst);
    });

    it("rewrites the cache when the service adds or withdraws a model", async () => {
      const { api } = makeApi();
      await syncCopilotPlusProvider(api, true, "token", async () => response());

      const withdrawn = response();
      withdrawn.data = withdrawn.data!.slice(0, 1);
      await syncCopilotPlusProvider(api, true, "token", async () => withdrawn);

      expect(getSettings().copilotPlusCatalog.models.map((m) => m.id)).toEqual([
        "copilot-plus-flash",
      ]);
    });

    it.each([
      ["a failed request", null],
      ["an empty lineup", { data: [] }],
      ["a non-list payload", { data: "nope" } as unknown as BrevilabsModelsResponse],
      ["an entry with no id", { data: [{ label: "Nameless" }] }],
    ])(
      "registers without a model list on %s, so the cached lineup survives (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)",
      async (_case, payload) => {
        // Reconciling against a lineup we could not read would delete every
        // Plus model the user has, which is what an offline launch would do.
        const { api, registerPlusProvider } = makeApi();
        setSettings({
          copilotPlusCatalog: {
            models: [{ id: "cached-model", displayName: "Cached" }],
            defaultEnabledIds: ["cached-model"],
          },
        });

        await syncCopilotPlusProvider(api, true, "token", async () => payload);

        expect(registerPlusProvider.mock.calls[0][0].models).toBeUndefined();
        expect(getSettings().copilotPlusCatalog.models.map((m) => m.id)).toEqual(["cached-model"]);
      }
    );

    it.each([
      { isPaidUser: false, licenseKey: "hydrated-token" },
      { isPaidUser: true, licenseKey: "" },
    ])(
      "unregisters without reading the endpoint when paid state or credential is missing",
      async ({ isPaidUser, licenseKey }) => {
        // Revoking access must not wait on the network.
        const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();
        const fetchModels = jest.fn(async () => response());

        await syncCopilotPlusProvider(api, isPaidUser, licenseKey, fetchModels);

        expect(fetchModels).not.toHaveBeenCalled();
        expect(registerPlusProvider).not.toHaveBeenCalled();
        expect(unregisterPlusProvider).toHaveBeenCalledTimes(1);
      }
    );

    it("contains background reconciliation failures", async () => {
      const { api, registerPlusProvider } = makeApi();
      registerPlusProvider.mockRejectedValueOnce(new Error("boom"));

      await expect(
        syncCopilotPlusProvider(api, true, "hydrated-token", async () => response())
      ).resolves.toBeUndefined();
    });

    it("gives up on a read that never answers, so a sign-out is not held behind it (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      // The caller serializes these, and `requestUrl` enforces no timeout of
      // its own, so a hung connection would keep a revoked license registered.
      jest.useFakeTimers();
      try {
        const { api, registerPlusProvider } = makeApi();
        const sync = syncCopilotPlusProvider(api, true, "token", () => new Promise(() => {}));

        await jest.advanceTimersByTimeAsync(10_000);
        await sync;

        expect(registerPlusProvider.mock.calls[0][0].models).toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });

    it("still registers the provider when the endpoint reader throws", async () => {
      // Offline is the common case here, and the cached lineup is enough to run
      // on. Abandoning registration would leave a licensed user with no Plus
      // provider until they next got a network.
      const { api, registerPlusProvider } = makeApi();

      await expect(
        syncCopilotPlusProvider(api, true, "token", async () => {
          throw new Error("offline");
        })
      ).resolves.toBeUndefined();
      expect(registerPlusProvider.mock.calls[0][0].models).toBeUndefined();
    });
  });
});
