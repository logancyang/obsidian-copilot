import type { BrevilabsModelsResponse } from "@/LLMProviders/brevilabsClient";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { RegisterPlusProviderInput } from "@/modelManagement/setup/CopilotPlusSetupApi";
import {
  createCopilotPlusSyncQueue,
  plusSyncNeeded,
} from "@/modelManagement/setup/copilotPlusSync";

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

const LIVE_RESPONSE: BrevilabsModelsResponse = {
  data: [
    {
      id: "tomorrow-model",
      label: "Tomorrow Model",
      description: "Published by the live catalog.",
      supports_images: true,
      supports_reasoning: true,
      reasoning_efforts: ["low", "high"],
      context_length: "256K",
    },
  ],
};

describe("copilotPlusSync", () => {
  describe("plusSyncNeeded()", () => {
    const signedIn = { isPaidUser: true, plusLicenseKey: "lic-1" };

    it("stays false when a signed-in user's Reset Settings preserves the paid state (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      expect(plusSyncNeeded(signedIn, { ...signedIn })).toBe(false);
    });

    it("fires on a genuine sign-out or sign-in", () => {
      expect(plusSyncNeeded(signedIn, { isPaidUser: false, plusLicenseKey: "lic-1" })).toBe(true);
      expect(plusSyncNeeded({ isPaidUser: false, plusLicenseKey: "" }, signedIn)).toBe(true);
    });

    it("fires on a key rotation while signed in, but not while signed out", () => {
      expect(plusSyncNeeded(signedIn, { isPaidUser: true, plusLicenseKey: "lic-2" })).toBe(true);
      expect(
        plusSyncNeeded(
          { isPaidUser: false, plusLicenseKey: "lic-1" },
          { isPaidUser: false, plusLicenseKey: "lic-2" }
        )
      ).toBe(false);
    });
  });

  describe("createCopilotPlusSyncQueue()", () => {
    it("publishes loading before the endpoint settles without blocking the caller (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api, registerPlusProvider } = makeApi();
      let finishFetch: (response: BrevilabsModelsResponse | null) => void = () => undefined;
      const fetchModels = jest.fn(
        () =>
          new Promise<BrevilabsModelsResponse | null>((resolve) => {
            finishFetch = resolve;
          })
      );
      const syncPlus = createCopilotPlusSyncQueue(api, fetchModels);
      const statuses: string[] = [];
      syncPlus.subscribe(() => statuses.push(syncPlus.getSnapshot().status));

      const startup = syncPlus(true, "hydrated-token");

      expect(syncPlus.getSnapshot()).toMatchObject({ status: "loading", models: [] });
      expect(registerPlusProvider).not.toHaveBeenCalled();

      await Promise.resolve();
      finishFetch(LIVE_RESPONSE);
      await startup;

      expect(syncPlus.getSnapshot()).toEqual({
        status: "ready",
        models: [
          {
            id: "tomorrow-model",
            displayName: "Tomorrow Model",
            description: "Published by the live catalog.",
            reasoning: true,
            reasoningEfforts: ["low", "high"],
            modalities: { input: ["text", "image"], output: ["text"] },
            limits: { context: 262_144 },
          },
        ],
      });
      expect(statuses).toEqual(["loading", "ready"]);
    });

    it("publishes unavailable state when the endpoint cannot be reached (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api } = makeApi();
      const syncPlus = createCopilotPlusSyncQueue(api, async () => null);

      await syncPlus(true, "hydrated-token");

      expect(syncPlus.getSnapshot()).toMatchObject({ status: "error", models: [] });
    });

    it("preserves an explicit empty effort list in the cached catalog (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api } = makeApi();
      const syncPlus = createCopilotPlusSyncQueue(api, async () => ({
        data: [
          {
            id: "no-effort-model",
            label: "No Effort Model",
            supports_reasoning: true,
            reasoning_efforts: [],
          },
        ],
      }));

      await syncPlus(true, "hydrated-token");

      expect(syncPlus.getSnapshot().models).toEqual([
        expect.objectContaining({ reasoningEfforts: [] }),
      ]);
    });

    it("leaves loading for unavailable after a bounded endpoint wait (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      jest.useFakeTimers();
      try {
        const { api, registerPlusProvider } = makeApi();
        const syncPlus = createCopilotPlusSyncQueue(api, () => new Promise(() => undefined));

        const startup = syncPlus(true, "hydrated-token");
        await jest.advanceTimersByTimeAsync(30_000);

        await startup;
        expect(syncPlus.getSnapshot()).toMatchObject({ status: "error", models: [] });
        expect(registerPlusProvider).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("rejects a malformed response without deleting cached models (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();
      const syncPlus = createCopilotPlusSyncQueue(api, async () => ({
        data: [LIVE_RESPONSE.data![0], { label: "Missing id" }],
      }));

      await syncPlus(true, "hydrated-token");

      expect(registerPlusProvider).not.toHaveBeenCalled();
      expect(unregisterPlusProvider).not.toHaveBeenCalled();
      expect(syncPlus.getSnapshot()).toMatchObject({ status: "error", models: [] });
    });

    it("contains provider reconciliation failures (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api, registerPlusProvider } = makeApi();
      registerPlusProvider.mockRejectedValueOnce(new Error("boom"));
      const syncPlus = createCopilotPlusSyncQueue(api, async () => LIVE_RESPONSE);

      await expect(syncPlus(true, "hydrated-token")).resolves.toBeUndefined();

      expect(syncPlus.getSnapshot()).toMatchObject({ status: "error", models: [] });
    });

    it("fetches the server catalog once across lifecycle reconciliation changes (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api, registerPlusProvider, unregisterPlusProvider } = makeApi();
      const fetchModels = jest.fn(async () => LIVE_RESPONSE);
      const syncPlus = createCopilotPlusSyncQueue(api, fetchModels);

      await syncPlus(true, "first-token");
      await syncPlus(false, "");
      await syncPlus(true, "rotated-token");

      expect(fetchModels).toHaveBeenCalledTimes(1);
      expect(unregisterPlusProvider).toHaveBeenCalledTimes(1);
      expect(registerPlusProvider).toHaveBeenLastCalledWith(
        expect.objectContaining({ apiKey: "rotated-token" })
      );
      expect(syncPlus.getSnapshot().status).toBe("ready");
    });

    it("waits for the newest reconciliation and resolves on catalog failure (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api } = makeApi();
      let finishFetch: (response: BrevilabsModelsResponse | null) => void = () => undefined;
      const syncPlus = createCopilotPlusSyncQueue(
        api,
        () =>
          new Promise((resolve) => {
            finishFetch = resolve;
          })
      );

      void syncPlus(true, "first-token");
      void syncPlus(true, "rotated-token");
      const settled = syncPlus.waitForSettled();
      await Promise.resolve();
      finishFetch(null);

      await expect(settled).resolves.toMatchObject({ status: "error", models: [] });
    });

    it("preserves lifecycle order and publishes only the newest queued request (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const { api, unregisterPlusProvider } = makeApi();
      let finishFirst: (response: BrevilabsModelsResponse | null) => void = () => undefined;
      const fetchModels = jest
        .fn<Promise<BrevilabsModelsResponse | null>, []>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishFirst = resolve;
            })
        )
        .mockResolvedValueOnce(LIVE_RESPONSE);
      const syncPlus = createCopilotPlusSyncQueue(api, fetchModels);

      const signIn = syncPlus(true, "hydrated-token");
      const signOut = syncPlus(false, "");
      await Promise.resolve();
      finishFirst(LIVE_RESPONSE);
      await signIn;

      expect(syncPlus.getSnapshot().status).toBe("ready");
      await signOut;

      expect(unregisterPlusProvider).toHaveBeenCalledTimes(1);
      expect(fetchModels).toHaveBeenCalledTimes(1);
      expect(syncPlus.getSnapshot().status).toBe("ready");
    });
  });
});
