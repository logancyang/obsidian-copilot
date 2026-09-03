// The plugin module graph reaches Obsidian base classes the shared mock does
// not model and provider SDKs Jest cannot resolve under jsdom; stubbing them
// here (rather than in `__mocks__/obsidian.js`) keeps the blast radius to this
// suite while letting the real `CopilotPlugin` class load.
jest.mock("obsidian", () => {
  const actual = jest.requireActual<Record<string, unknown>>("obsidian");
  return {
    ...actual,
    Plugin: class Plugin {},
    PluginSettingTab: class PluginSettingTab {},
  };
});
jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: { getInstance: jest.fn() },
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));
jest.mock("@/miyo/miyoResync", () => ({
  resetMiyoMutations: jest.fn(),
  startMiyoMutationSession: jest.fn(),
}));
jest.mock("@/services/settingsPersistence", () => ({
  flushPersistence: jest.fn().mockResolvedValue(undefined),
  persistSettings: jest.fn(),
  loadSettingsWithKeychain: jest.fn(),
  resetPersistenceState: jest.fn(),
}));
jest.mock("@/logFileManager", () => ({
  logFileManager: { flush: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("@/state/vaultDataAtoms", () => ({
  VaultDataManager: { getInstance: jest.fn(() => ({ cleanup: jest.fn() })) },
}));
jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(() => ({ stopActiveWebTabTracking: jest.fn() })),
  startActiveWebTabTracking: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: jest.fn(() => false) }));
jest.mock("@/utils/notificationSound", () => ({ disposeNotificationSound: jest.fn() }));
const mockSkillManagerDispose = jest.fn();
const mockSkillManagerHasInstance = jest.fn(() => true);
jest.mock("@/agentMode", () => ({
  SkillManager: {
    hasInstance: () => mockSkillManagerHasInstance(),
    getInstance: () => ({ dispose: mockSkillManagerDispose }),
  },
}));

import CopilotPlugin from "@/main";
import { logError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { resetMiyoMutations } from "@/miyo/miyoResync";
import { flushPersistence } from "@/services/settingsPersistence";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { disposeNotificationSound } from "@/utils/notificationSound";

/**
 * Build a plugin instance without running Obsidian's `Plugin` constructor or
 * `onload`, wiring only the collaborators `teardown()` touches. Each is a spy
 * that appends to `calls`, so a test can assert the unload order the previous
 * `async onunload` body established.
 */
function createPluginUnderTest(calls: string[]) {
  const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;

  Object.assign(plugin, {
    app: { workspace: { getLeavesOfType: jest.fn(() => []) } },
    chatSelectionHighlightController: { cleanup: jest.fn(() => calls.push("highlight")) },
    agentModelDiscoveryUnsubscriber: jest.fn(() => calls.push("modelDiscovery")),
    agentSessionManager: {
      shutdown: jest.fn(async () => {
        calls.push("sessions");
      }),
    },
    customCommandRegister: { cleanup: jest.fn(() => calls.push("customCommands")) },
    systemPromptRegister: { cleanup: jest.fn(() => calls.push("systemPrompts")) },
    projectRegister: { cleanup: jest.fn(() => calls.push("projects")) },
    settingsUnsubscriber: jest.fn(() => calls.push("settings")),
    modelManagement: { dispose: jest.fn(() => calls.push("modelManagement")) },
    cleanupSelectionHandler: jest.fn(),
    cleanupWebSelectionWatcher: jest.fn(),
  });

  return plugin;
}

/** Let the fire-and-forget teardown chain settle before asserting on it. */
async function flushTeardown(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("main", () => {
  describe("CopilotPlugin", () => {
    describe("onunload()", () => {
      beforeEach(() => {
        jest.clearAllMocks();
        (disposeNotificationSound as jest.Mock).mockReset();
        (flushPersistence as jest.Mock).mockResolvedValue(undefined);
        (logFileManager.flush as jest.Mock).mockResolvedValue(undefined);
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
      });

      it("returns void so Obsidian's non-awaiting unload cannot drop the teardown promise", () => {
        const plugin = createPluginUnderTest([]);

        expect(plugin.onunload()).toBeUndefined();
      });

      it("ends the Miyo mutation lifecycle synchronously, before returning to Obsidian", () => {
        const calls: string[] = [];
        const plugin = createPluginUnderTest(calls);

        plugin.onunload();

        // Everything above teardown()'s first `await` must run before the next
        // `onload()` can start, which is what makes the vault boundary real.
        expect(resetMiyoMutations).toHaveBeenCalledTimes(1);
        expect(flushPersistence).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([]);
      });

      it("releases audio before asynchronous teardown can overlap a later plugin lifecycle (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        const calls: string[] = [];
        let releasePersistence: () => void = () => undefined;
        (disposeNotificationSound as jest.Mock).mockImplementation(() => calls.push("audio"));
        (flushPersistence as jest.Mock).mockImplementation(() => {
          calls.push("persistence");
          return new Promise<void>((resolve) => {
            releasePersistence = resolve;
          });
        });
        const plugin = createPluginUnderTest(calls);

        plugin.onunload();

        expect(calls).toEqual(["audio", "persistence"]);
        releasePersistence();
        await flushTeardown();
      });

      it("tears down collaborators in order, flushing persistence before session shutdown and the log last", async () => {
        const calls: string[] = [];
        const plugin = createPluginUnderTest(calls);
        (flushPersistence as jest.Mock).mockImplementation(async () => {
          calls.push("persistence");
        });
        (logFileManager.flush as jest.Mock).mockImplementation(async () => {
          calls.push("logFlush");
        });

        plugin.onunload();
        await flushTeardown();

        expect(calls).toEqual([
          "persistence",
          "highlight",
          "modelDiscovery",
          "sessions",
          "customCommands",
          "systemPrompts",
          "projects",
          "settings",
          "modelManagement",
          "logFlush",
        ]);
        expect(logInfo).toHaveBeenCalledWith("Copilot plugin unloaded");
      });

      it("completes teardown when onload never assigned its collaborators", async () => {
        const calls: string[] = [];
        const plugin = createPluginUnderTest(calls);
        Object.assign(plugin, {
          chatSelectionHighlightController: undefined,
          agentModelDiscoveryUnsubscriber: undefined,
          agentSessionManager: undefined,
          customCommandRegister: undefined,
          systemPromptRegister: undefined,
          projectRegister: undefined,
          settingsUnsubscriber: undefined,
          modelManagement: undefined,
        });

        plugin.onunload();
        await flushTeardown();

        expect(logError).not.toHaveBeenCalled();
        expect(logInfo).toHaveBeenCalledWith("Copilot plugin unloaded");
      });

      it("logs a teardown rejection instead of leaving an unhandled promise rejection", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("shutdown failed");
        (
          plugin.agentSessionManager as unknown as { shutdown: jest.Mock }
        ).shutdown.mockRejectedValue(failure);

        plugin.onunload();
        await flushTeardown();

        expect(logError).toHaveBeenCalledWith(
          "Copilot: plugin teardown failed during unload:",
          failure
        );
      });

      it("disposes the skill manager on a desktop runtime", async () => {
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
        const plugin = createPluginUnderTest([]);

        plugin.onunload();
        await flushTeardown();

        expect(mockSkillManagerDispose).toHaveBeenCalledTimes(1);
        expect(logInfo).toHaveBeenCalledWith("Copilot plugin unloaded");
      });

      it("skips the Node-backed skill cleanup on a mobile runtime, where the barrel import would crash", async () => {
        const plugin = createPluginUnderTest([]);

        plugin.onunload();
        await flushTeardown();

        expect(mockSkillManagerDispose).not.toHaveBeenCalled();
        expect(logInfo).toHaveBeenCalledWith("Copilot plugin unloaded");
      });
    });

    describe("newAgentChatWithDraft()", () => {
      beforeEach(() => {
        jest.clearAllMocks();
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
      });

      it("opens a global Agent session with reviewable text left as a draft for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const plugin = createPluginUnderTest([]);
        const createGlobalSessionWithDraft = jest.fn().mockResolvedValue(undefined);
        Object.assign(plugin.agentSessionManager as object, {
          createGlobalSessionWithDraft,
        });
        const activateAgentView = jest.spyOn(plugin, "activateAgentView").mockResolvedValue(null);

        await plugin.newAgentChatWithDraft("Repair this skill");

        expect(createGlobalSessionWithDraft).toHaveBeenCalledWith("Repair this skill");
        expect(activateAgentView).toHaveBeenCalledTimes(1);
        expect(createGlobalSessionWithDraft.mock.invocationCallOrder[0]).toBeLessThan(
          activateAgentView.mock.invocationCallOrder[0]
        );
      });

      it("surfaces session creation failures without sending or throwing for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("create failed");
        Object.assign(plugin.agentSessionManager as object, {
          createGlobalSessionWithDraft: jest.fn().mockRejectedValue(failure),
        });
        const activateAgentView = jest.spyOn(plugin, "activateAgentView").mockResolvedValue(null);

        await expect(plugin.newAgentChatWithDraft("Repair this skill")).resolves.toBeUndefined();

        expect(logWarn).toHaveBeenCalledWith(
          "[CopilotPlugin] Failed to create agent session with draft",
          failure
        );
        expect(activateAgentView).not.toHaveBeenCalled();
      });
    });

    describe("newAgentChatWithPrompt()", () => {
      beforeEach(() => {
        jest.clearAllMocks();
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
      });

      it("binds the prompt to a chat before revealing Agent Chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
        const plugin = createPluginUnderTest([]);
        const createSessionWithPrompt = jest.fn().mockResolvedValue({ internalId: "session-1" });
        const setActiveSession = jest.fn();
        Object.assign(plugin.agentSessionManager as object, {
          createSessionWithPrompt,
          setActiveSession,
        });
        const activateAgentView = jest.spyOn(plugin, "activateAgentView").mockResolvedValue(null);

        await plugin.newAgentChatWithPrompt("Publish this note");

        expect(createSessionWithPrompt).toHaveBeenCalledWith("Publish this note");
        expect(activateAgentView).toHaveBeenCalledTimes(1);
        expect(createSessionWithPrompt.mock.invocationCallOrder[0]).toBeLessThan(
          activateAgentView.mock.invocationCallOrder[0]
        );
      });

      it("reveals the chat that owns the request even when another became active during creation for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
        const plugin = createPluginUnderTest([]);
        const createSessionWithPrompt = jest.fn().mockResolvedValue({ internalId: "session-1" });
        const setActiveSession = jest.fn();
        Object.assign(plugin.agentSessionManager as object, {
          createSessionWithPrompt,
          setActiveSession,
        });
        const activateAgentView = jest.spyOn(plugin, "activateAgentView").mockResolvedValue(null);

        await plugin.newAgentChatWithPrompt("Publish this note");

        expect(setActiveSession).toHaveBeenCalledWith("session-1");
        expect(setActiveSession.mock.invocationCallOrder[0]).toBeLessThan(
          activateAgentView.mock.invocationCallOrder[0]
        );
      });

      it("runs a second request only after the first chat is revealed for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
        const plugin = createPluginUnderTest([]);
        let releaseFirstReveal: (() => void) | undefined;
        const createSessionWithPrompt = jest
          .fn()
          .mockImplementation((prompt: string) => Promise.resolve({ internalId: prompt }));
        Object.assign(plugin.agentSessionManager as object, {
          createSessionWithPrompt,
          setActiveSession: jest.fn(),
        });
        const activateAgentView = jest.spyOn(plugin, "activateAgentView").mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirstReveal = () => resolve(null);
            })
        );

        const first = plugin.newAgentChatWithPrompt("first");
        const second = plugin.newAgentChatWithPrompt("second");
        for (let turn = 0; turn < 20 && !releaseFirstReveal; turn += 1) {
          await Promise.resolve();
        }

        // Only one composer mounts at a time, so the second chat must not be
        // created while the first request is still being handed to the view.
        expect(createSessionWithPrompt).toHaveBeenCalledTimes(1);
        expect(createSessionWithPrompt).toHaveBeenCalledWith("first");

        releaseFirstReveal?.();
        activateAgentView.mockResolvedValue(null);
        await Promise.all([first, second]);

        expect(createSessionWithPrompt).toHaveBeenNthCalledWith(2, "second");
      });

      it("keeps delivering later requests after one fails for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
        const plugin = createPluginUnderTest([]);
        const createSessionWithPrompt = jest
          .fn()
          .mockRejectedValueOnce(new Error("create failed"))
          .mockResolvedValue({ internalId: "session-2" });
        Object.assign(plugin.agentSessionManager as object, {
          createSessionWithPrompt,
          setActiveSession: jest.fn(),
        });
        jest.spyOn(plugin, "activateAgentView").mockResolvedValue(null);

        await plugin.newAgentChatWithPrompt("first");
        await plugin.newAgentChatWithPrompt("second");

        expect(createSessionWithPrompt).toHaveBeenNthCalledWith(2, "second");
      });

      it("surfaces session creation failures without revealing Agent Chat or throwing for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("create failed");
        Object.assign(plugin.agentSessionManager as object, {
          createSessionWithPrompt: jest.fn().mockRejectedValue(failure),
        });
        const activateAgentView = jest.spyOn(plugin, "activateAgentView").mockResolvedValue(null);

        await expect(plugin.newAgentChatWithPrompt("Publish this note")).resolves.toBeUndefined();

        expect(logWarn).toHaveBeenCalledWith(
          "[CopilotPlugin] Failed to create agent session with prompt",
          failure
        );
        expect(activateAgentView).not.toHaveBeenCalled();
      });
    });
  });
});
