import { SystemPromptManager } from "@/system-prompts/systemPromptManager";
import * as systemPromptUtils from "@/system-prompts/systemPromptUtils";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

jest.mock("@/system-prompts/systemPromptUtils", () => ({
  fetchAllSystemPrompts: jest.fn(),
  loadAllSystemPrompts: jest.fn(),
}));

describe("systemPromptManager", () => {
  describe("SystemPromptManager", () => {
    let manager: SystemPromptManager;
    let originalApp: typeof window.app;

    beforeEach(() => {
      (SystemPromptManager as unknown as Record<string, unknown>).instance = undefined;
      jest.clearAllMocks();
      originalApp = window.app;
      window.app = {} as typeof window.app;
      manager = SystemPromptManager.getInstance(window.app);
    });

    afterEach(() => {
      window.app = originalApp;
    });

    describe("getInstance()", () => {
      it("returns the singleton instance", () => {
        const instance1 = SystemPromptManager.getInstance();
        const instance2 = SystemPromptManager.getInstance();

        expect(instance1).toBe(instance2);
      });

      it("requires an app for the first initialization", () => {
        (SystemPromptManager as unknown as Record<string, unknown>).instance = undefined;

        expect(() => SystemPromptManager.getInstance()).toThrow(
          "App is required for first initialization"
        );
      });

      it("does not require an app after initialization", () => {
        const instance1 = SystemPromptManager.getInstance(window.app);
        const instance2 = SystemPromptManager.getInstance();

        expect(instance1).toBe(instance2);
      });
    });

    describe("initialize()", () => {
      it("loads all system prompts into the shared cache", async () => {
        await manager.initialize();

        expect(systemPromptUtils.loadAllSystemPrompts).toHaveBeenCalledWith(window.app);
      });
    });

    describe("fetchPrompts()", () => {
      it("returns prompts fetched from the vault", async () => {
        const prompts = [
          {
            title: "Prompt",
            content: "Content",
            createdMs: 1,
            modifiedMs: 2,
            lastUsedMs: 3,
          },
        ];
        (systemPromptUtils.fetchAllSystemPrompts as jest.Mock).mockResolvedValue(prompts);

        await expect(manager.fetchPrompts()).resolves.toBe(prompts);
        expect(systemPromptUtils.fetchAllSystemPrompts).toHaveBeenCalledWith(window.app);
      });
    });
  });
});
