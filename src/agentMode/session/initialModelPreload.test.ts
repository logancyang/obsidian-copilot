import { preloadInitialModels } from "@/agentMode/session/initialModelPreload";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { CopilotPlusSyncQueue } from "@/modelManagement";

describe("initialModelPreload", () => {
  describe("preloadInitialModels()", () => {
    it("gates OpenCode but not Claude or Codex on Plus catalog settlement (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      let settleCatalog: () => void = () => undefined;
      const waitForSettled = jest.fn(
        () =>
          new Promise((resolve) => {
            settleCatalog = () => resolve({ status: "ready", models: [] });
          })
      );
      const preloadModels = jest.fn(async (_backendId: string) => undefined);
      const manager = { preloadModels } as unknown as AgentSessionManager;
      const plusSync = { waitForSettled } as unknown as CopilotPlusSyncQueue;

      const opencode = preloadInitialModels(manager, "opencode", plusSync, true);
      await preloadInitialModels(manager, "claude", plusSync, true);
      await preloadInitialModels(manager, "codex", plusSync, true);

      expect(preloadModels.mock.calls.map(([id]) => id)).toEqual(["claude", "codex"]);
      settleCatalog();
      await opencode;
      expect(preloadModels).toHaveBeenLastCalledWith("opencode");
    });

    it("starts OpenCode after an unavailable catalog settles (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const preloadModels = jest.fn(async (_backendId: string) => undefined);
      const manager = { preloadModels } as unknown as AgentSessionManager;
      const plusSync = {
        waitForSettled: async () => ({ status: "error", models: [] }),
      } as unknown as CopilotPlusSyncQueue;

      await preloadInitialModels(manager, "opencode", plusSync, true);

      expect(preloadModels).toHaveBeenCalledWith("opencode");
    });

    it("does not gate an ineligible OpenCode user on the Plus catalog (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", async () => {
      const waitForSettled = jest.fn(() => new Promise(() => undefined));
      const preloadModels = jest.fn(async (_backendId: string) => undefined);
      const manager = { preloadModels } as unknown as AgentSessionManager;
      const plusSync = { waitForSettled } as unknown as CopilotPlusSyncQueue;

      await preloadInitialModels(manager, "opencode", plusSync, false);

      expect(waitForSettled).not.toHaveBeenCalled();
      expect(preloadModels).toHaveBeenCalledWith("opencode");
    });
  });
});
