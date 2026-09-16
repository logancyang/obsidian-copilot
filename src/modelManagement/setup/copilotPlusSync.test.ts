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

/** Long enough for every backoff and deadline in a cold-start retry sequence. */
const COLD_START_TOTAL_MS = 60_000;

/** Put the settings store in the signed-in state the sync is called for. */
function signedIn(licenseKey = "token"): void {
  setSettings({ isPaidUser: true, plusLicenseKey: licenseKey });
}

/** An endpoint read the test resolves by hand, to hold a sync at that read. */
function deferredRead() {
  let resolve: (value: BrevilabsModelsResponse | null) => void = () => {};
  const read = new Promise<BrevilabsModelsResponse | null>((settle) => {
    resolve = settle;
  });
  return { read: () => read, resolve };
}

/** Let the queued work run so a sync reaches its pending endpoint read. */
function flush(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("copilotPlusSync", () => {
  beforeEach(() => {
    resetSettings();
    // `resetSettings` deliberately preserves this cache in production, so a
    // clean slate has to ask for one.
    setSettings({ copilotPlusCatalog: { models: [], defaultEnabledIds: [] } });
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
      signedIn("hydrated-token");

      await syncCopilotPlusProvider(api, true, "hydrated-token", async () => response());

      expect(unregisterPlusProvider).not.toHaveBeenCalled();
      const input = registerPlusProvider.mock.calls[0][0];
      expect(input.apiKey).toBe("hydrated-token");
      expect(input.models?.map((m) => m.id)).toEqual(["copilot-plus-flash", "glm-5.2"]);
      expect(input.autoEnrollModelIds).toEqual(["copilot-plus-flash"]);
    });

    it("caches the published lineup so later startups need no request", async () => {
      const { api } = makeApi();
      signedIn();

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
      signedIn();
      await syncCopilotPlusProvider(api, true, "token", async () => response());
      const afterFirst = getSettings().copilotPlusCatalog;

      await syncCopilotPlusProvider(api, true, "token", async () => response());

      expect(getSettings().copilotPlusCatalog).toBe(afterFirst);
    });

    it("rewrites the cache when the service adds or withdraws a model", async () => {
      const { api } = makeApi();
      signedIn();
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
        signedIn();
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
      "unregisters the provider and registers nothing when paid state or credential is missing",
      async ({ isPaidUser, licenseKey }) => {
        const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();

        await syncCopilotPlusProvider(api, isPaidUser, licenseKey, async () => response());

        expect(registerPlusProvider).not.toHaveBeenCalled();
        expect(unregisterPlusProvider).toHaveBeenCalledTimes(1);
      }
    );

    it("caches the lineup for an install that has never signed in, with removal already done before the read (https://github.com/Brevilabs/obsidian-copilot-private/issues/476)", async () => {
      // The locked "Copilot license required" rows render from this cache, so
      // an install that never signs in has nothing to advertise without it.
      // Revoking access still must not wait on the network, so the read is in
      // flight only after the unregister has resolved.
      const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();
      const pending = deferredRead();
      const fetchModels = jest.fn(pending.read);

      const sync = syncCopilotPlusProvider(api, false, "", fetchModels);
      await flush();

      expect(unregisterPlusProvider).toHaveBeenCalledTimes(1);
      expect(fetchModels).toHaveBeenCalledTimes(1);
      expect(getSettings().copilotPlusCatalog.models).toEqual([]);

      pending.resolve(response());
      await sync;

      expect(getSettings().copilotPlusCatalog.models.map((m) => m.id)).toEqual([
        "copilot-plus-flash",
        "glm-5.2",
      ]);
      expect(registerPlusProvider).not.toHaveBeenCalled();
    });

    it("leaves the cache untouched when an unlicensed read matches it (https://github.com/Brevilabs/obsidian-copilot-private/issues/476)", async () => {
      const { api } = makeApi();
      await syncCopilotPlusProvider(api, false, "", async () => response());
      const afterFirst = getSettings().copilotPlusCatalog;

      await syncCopilotPlusProvider(api, false, "", async () => response());

      expect(getSettings().copilotPlusCatalog).toBe(afterFirst);
    });

    it("keeps the cached lineup when an unlicensed read is unreadable (https://github.com/Brevilabs/obsidian-copilot-private/issues/476)", async () => {
      const { api } = makeApi();
      setSettings({
        copilotPlusCatalog: {
          models: [{ id: "cached-model", displayName: "Cached" }],
          defaultEnabledIds: ["cached-model"],
        },
      });
      const fetchModels = jest.fn(async () => null);

      await syncCopilotPlusProvider(api, false, "", fetchModels);

      expect(fetchModels).toHaveBeenCalledTimes(1);
      expect(getSettings().copilotPlusCatalog.models.map((m) => m.id)).toEqual(["cached-model"]);
    });

    it("abandons an unlicensed read once the user signs in, so the licensed sync is the only writer (https://github.com/Brevilabs/obsidian-copilot-private/issues/476)", async () => {
      const { api } = makeApi();
      const pending = deferredRead();

      const sync = syncCopilotPlusProvider(api, false, "", pending.read);
      await flush();
      // No timer is advanced: the sign-in alone has to settle the read.
      signedIn();
      await sync;
      pending.resolve(response());
      await flush();

      expect(getSettings().copilotPlusCatalog.models).toEqual([]);
    });

    it("retries a failed read when there is no cached lineup to fall back on (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      // A first sign-in has no cache, so giving up on one failed read would
      // leave someone who has just paid with a provider and no models.
      jest.useFakeTimers();
      try {
        const { api, registerPlusProvider } = makeApi();
        signedIn();
        const fetchModels = jest
          .fn<Promise<BrevilabsModelsResponse | null>, []>()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValue(response());

        const sync = syncCopilotPlusProvider(api, true, "token", fetchModels);
        // Two backoffs plus each attempt's deadline timer.
        await jest.advanceTimersByTimeAsync(COLD_START_TOTAL_MS);
        await sync;

        expect(fetchModels).toHaveBeenCalledTimes(3);
        expect(registerPlusProvider.mock.calls[0][0].models).toHaveLength(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not retry when a cached lineup can carry the session (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api } = makeApi();
      signedIn();
      setSettings({
        copilotPlusCatalog: {
          models: [{ id: "cached-model", displayName: "Cached" }],
          defaultEnabledIds: ["cached-model"],
        },
      });
      const fetchModels = jest.fn(async () => null);

      await syncCopilotPlusProvider(api, true, "token", fetchModels);

      expect(fetchModels).toHaveBeenCalledTimes(1);
    });

    it("abandons the retry sequence once the user signs out (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      jest.useFakeTimers();
      try {
        const { api, registerPlusProvider } = makeApi();
        signedIn();
        const fetchModels = jest.fn(async () => {
          setSettings({ isPaidUser: false, plusLicenseKey: "" });
          return null;
        });

        const sync = syncCopilotPlusProvider(api, true, "token", fetchModels);
        await jest.advanceTimersByTimeAsync(10_000);
        await sync;

        expect(fetchModels).toHaveBeenCalledTimes(1);
        expect(registerPlusProvider).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("abandons a read still in flight when the user signs out, so removal never waits out the deadline (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      // The caller chains the unregister behind whatever read is in flight, so
      // waiting a stalled one out would keep a revoked license's provider and
      // its keychain credential registered for the rest of the deadline.
      jest.useFakeTimers();
      try {
        const { api, registerPlusProvider } = makeApi();
        signedIn();
        setSettings({
          copilotPlusCatalog: {
            models: [{ id: "cached-model", displayName: "Cached" }],
            defaultEnabledIds: ["cached-model"],
          },
        });
        const sync = syncCopilotPlusProvider(api, true, "token", () => new Promise(() => {}));

        setSettings({ isPaidUser: false, plusLicenseKey: "" });
        // No timer is advanced: the sign-out alone has to settle the read.
        await sync;

        expect(registerPlusProvider).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not register after the user signed out during the lineup read (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      // The endpoint read is the only await between the caller's decision and
      // the write. Registering on a stale argument would restore a revoked
      // license's provider and its keychain credential after sign-out.
      const { api, registerPlusProvider } = makeApi();
      signedIn();

      await syncCopilotPlusProvider(api, true, "token", async () => {
        setSettings({ isPaidUser: false, plusLicenseKey: "" });
        return response();
      });

      expect(registerPlusProvider).not.toHaveBeenCalled();
    });

    it("does not register a key the user has since rotated away from (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api, registerPlusProvider } = makeApi();
      signedIn("old-key");

      await syncCopilotPlusProvider(api, true, "old-key", async () => {
        setSettings({ plusLicenseKey: "new-key" });
        return response();
      });

      expect(registerPlusProvider).not.toHaveBeenCalled();
    });

    it("contains background reconciliation failures", async () => {
      const { api, registerPlusProvider } = makeApi();
      signedIn("hydrated-token");
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
        signedIn();
        const sync = syncCopilotPlusProvider(api, true, "token", () => new Promise(() => {}));

        await jest.advanceTimersByTimeAsync(COLD_START_TOTAL_MS);
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
      signedIn();
      setSettings({
        copilotPlusCatalog: {
          models: [{ id: "cached-model", displayName: "Cached" }],
          defaultEnabledIds: ["cached-model"],
        },
      });

      await expect(
        syncCopilotPlusProvider(api, true, "token", async () => {
          throw new Error("offline");
        })
      ).resolves.toBeUndefined();
      expect(registerPlusProvider.mock.calls[0][0].models).toBeUndefined();
    });
  });
});
