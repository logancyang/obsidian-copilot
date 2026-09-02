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
import { DEFAULT_OPEN_AREA } from "@/constants";
import { resetSettings, setSettings } from "@/settings/model";

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

    describe("submitPromptToAgentChat()", () => {
      afterEach(() => {
        resetSettings();
      });

      it("reveals Agent Chat and latches the prompt for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
        const plugin = createPluginUnderTest([]);
        const queueSubmitPrompt = jest.fn();
        class FakeAgentView {
          eventTarget = { queueSubmitPrompt };
        }
        const view = new FakeAgentView();
        Object.assign(plugin, { CopilotAgentView: FakeAgentView });
        const activateAgentView = jest
          .spyOn(plugin, "activateAgentView")
          .mockResolvedValue({ view } as never);

        await plugin.submitPromptToAgentChat("Publish Notes/Active.md");

        expect(activateAgentView).toHaveBeenCalledTimes(1);
        expect(queueSubmitPrompt).toHaveBeenCalledWith("Publish Notes/Active.md");
      });

      it("shares a deferred Editor-area activation and preserves FIFO prompt delivery for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
        const plugin = createPluginUnderTest([]);
        const queueSubmitPrompt = jest.fn();
        class FakeAgentView {
          eventTarget = { queueSubmitPrompt, queueVisible: jest.fn() };
        }
        let view: FakeAgentView | null = null;
        let releaseView!: () => void;
        const leaf = {
          get view() {
            return view;
          },
          setViewState: jest.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseView = () => {
                  view = new FakeAgentView();
                  resolve();
                };
              })
          ),
        };
        const getLeaf = jest.fn(() => leaf);
        Object.assign(plugin, {
          CopilotAgentView: FakeAgentView,
          app: {
            workspace: {
              getLeavesOfType: jest.fn(() => []),
              getLeaf,
              getRightLeaf: jest.fn(),
              revealLeaf: jest.fn(),
            },
          },
        });
        setSettings({ defaultOpenArea: DEFAULT_OPEN_AREA.EDITOR });

        const first = plugin.submitPromptToAgentChat("Publish Notes/First.md");
        const second = plugin.submitPromptToAgentChat("Publish Notes/Second.md");
        expect(getLeaf).toHaveBeenCalledTimes(1);
        expect(leaf.setViewState).toHaveBeenCalledTimes(1);
        releaseView();
        await Promise.all([first, second]);

        expect(queueSubmitPrompt.mock.calls.map(([prompt]) => String(prompt))).toEqual([
          "Publish Notes/First.md",
          "Publish Notes/Second.md",
        ]);
      });

      it("does not fall back when Agent Chat is unavailable for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
        const plugin = createPluginUnderTest([]);
        const queueSubmitPrompt = jest.fn();
        class FakeAgentView {
          eventTarget = { queueSubmitPrompt };
        }
        Object.assign(plugin, { CopilotAgentView: FakeAgentView });
        jest.spyOn(plugin, "activateAgentView").mockResolvedValue(null);

        await expect(
          plugin.submitPromptToAgentChat("Publish Notes/Active.md")
        ).resolves.toBeUndefined();

        expect(queueSubmitPrompt).not.toHaveBeenCalled();
      });

      it("contains Agent Chat reveal failures for https://github.com/Brevilabs/obsidian-copilot-private/issues/357", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("reveal failed");
        jest.spyOn(plugin, "activateAgentView").mockRejectedValue(failure);

        await expect(
          plugin.submitPromptToAgentChat("Publish Notes/Active.md")
        ).resolves.toBeUndefined();

        expect(logError).toHaveBeenCalledWith(
          "Failed to delegate OpenArtifacts publishing to Agent Chat.",
          failure
        );
      });
    });
  });
});
