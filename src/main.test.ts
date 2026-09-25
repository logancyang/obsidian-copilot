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
import { getSelectedTextContexts, setSelectedTextContexts } from "@/aiParams";
import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import type { WebSelectionTrackingOptions } from "@/services/webViewerService/webViewerServiceSelection";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

const mockStartSelectionTracker = jest.fn();
const mockSelectionTrackerOptions = jest.fn();
jest.mock("@/services/webViewerService/webViewerServiceSelection", () => ({
  WebSelectionTracker: class {
    constructor(options: WebSelectionTrackingOptions) {
      mockSelectionTrackerOptions(options);
    }
    start = mockStartSelectionTracker;
  },
}));
import { logError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
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
    describe("initSelectionHandler()", () => {
      it("attaches Reading view text, preserves it on chat focus, and clears it in the note (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
        setSelectedTextContexts([]);
        const containerEl = document.createElement("div");
        const preview = document.createElement("div");
        preview.className = "markdown-reading-view";
        preview.textContent = "Excerpt from the note";
        containerEl.append(preview);
        document.body.append(containerEl);
        const chat = document.createElement("div");
        chat.textContent = "Chat input";
        document.body.append(chat);
        const noteView = {
          containerEl,
          file: { path: "Research.md", basename: "Research" },
          getMode: () => "preview",
          editor: {},
        };
        const cleanups: Array<() => void> = [];
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;
        Object.assign(plugin, {
          registerEditorExtension: jest.fn(),
          registerDomEvent: (doc: Document, event: string, handler: EventListener) => {
            doc.addEventListener(event, handler);
            cleanups.push(() => doc.removeEventListener(event, handler));
          },
          registerEvent: jest.fn(),
          app: {
            workspace: {
              getLeavesOfType: () => [{ view: noteView }],
              on: jest.fn(),
            },
          },
        });

        plugin.initSelectionHandler();
        const selection = document.getSelection()!;
        const range = document.createRange();
        range.setStart(preview.firstChild!, 0);
        range.setEnd(preview.firstChild!, 7);
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        expect(getSelectedTextContexts()).toEqual([
          expect.objectContaining({
            content: "Excerpt",
            notePath: "Research.md",
            startLine: 0,
            endLine: 0,
          }),
        ]);

        const chatRange = document.createRange();
        chatRange.setStart(chat.firstChild!, 0);
        chatRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(chatRange);
        document.dispatchEvent(new Event("selectionchange"));
        expect(getSelectedTextContexts()).toHaveLength(1);

        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        expect(getSelectedTextContexts()).toEqual([]);

        selection.removeAllRanges();
        cleanups.forEach((cleanup) => cleanup());
        containerEl.remove();
        chat.remove();
      });

      it("attaches and clears a note excerpt from editor updates even when another view is active (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
        setSelectedTextContexts([]);
        let extension: Extension | undefined;
        let noteView: { file: { path: string; basename: string }; editor: object };
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;
        Object.assign(plugin, {
          registerEditorExtension: (value: Extension) => {
            extension = value;
          },
          registerEvent: jest.fn(),
          app: {
            workspace: {
              getLeavesOfType: () => [{ view: noteView }],
              getActiveViewOfType: () => null,
              getActiveFile: () => ({ path: "Wrong.md", basename: "Wrong" }),
              on: jest.fn(),
            },
          },
        });

        plugin.initSelectionHandler();
        const cm = new EditorView({
          doc: "Excerpt from the note",
          parent: document.body,
          extensions: [extension!],
        });
        noteView = {
          file: { path: "Research.md", basename: "Research" },
          editor: {
            cm,
            listSelections: () => [
              {
                anchor: { line: 0, ch: cm.state.selection.main.anchor },
                head: { line: 0, ch: cm.state.selection.main.head },
              },
            ],
            getSelection: () =>
              cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to),
          },
        };
        cm.focus();
        cm.dispatch({ selection: { anchor: 0, head: 7 } });

        expect(getSelectedTextContexts()).toEqual([
          expect.objectContaining({ content: "Excerpt", notePath: "Research.md" }),
        ]);
        cm.dispatch({ selection: { anchor: 7 } });
        expect(getSelectedTextContexts()).toEqual([]);
        cm.destroy();
        setSelectedTextContexts([]);
      });
    });

    describe("handleSelectionChange()", () => {
      it("automatically attaches a note excerpt even when the retired preferences were saved as false", () => {
        settingsStore.set(settingsAtom, {
          ...DEFAULT_SETTINGS,
          ...{ autoAddSelectionToContext: false, autoIncludeTextSelection: false },
        });
        setSelectedTextContexts([]);
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;
        Object.assign(plugin, {
          app: {
            workspace: {
              getActiveViewOfType: () => ({
                editor: {
                  listSelections: () => [{ anchor: { line: 1, ch: 0 }, head: { line: 2, ch: 7 } }],
                  getSelection: () => "An excerpt from the note.",
                },
              }),
              getActiveFile: () => ({ path: "Research.md", basename: "Research" }),
            },
          },
        });

        plugin.handleSelectionChange();

        expect(getSelectedTextContexts()).toEqual([
          expect.objectContaining({
            content: "An excerpt from the note.",
            sourceType: "note",
            notePath: "Research.md",
            startLine: 2,
            endLine: 3,
          }),
        ]);
        setSelectedTextContexts([]);
      });
      it("updates selected text when the content changes at the same editor range (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
        setSelectedTextContexts([]);
        let selectedText = "First";
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;
        Object.assign(plugin, {
          app: {
            workspace: {
              getActiveViewOfType: () => ({
                editor: {
                  listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 5 } }],
                  getSelection: () => selectedText,
                },
              }),
              getActiveFile: () => ({ path: "Research.md", basename: "Research" }),
            },
          },
        });

        plugin.handleSelectionChange();
        selectedText = "After";
        plugin.handleSelectionChange();

        expect(getSelectedTextContexts()).toEqual([
          expect.objectContaining({ content: "After", notePath: "Research.md" }),
        ]);
        setSelectedTextContexts([]);
      });
    });

    describe("initWebSelectionWatcher()", () => {
      it("enables desktop web selection tracking even when the retired preference was saved as false", () => {
        settingsStore.set(settingsAtom, {
          ...DEFAULT_SETTINGS,
          ...{ autoAddSelectionToContext: false, autoIncludeTextSelection: false },
        });
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;
        Object.assign(plugin, { app: {} });

        plugin.initWebSelectionWatcher();

        const options = mockSelectionTrackerOptions.mock.calls.at(
          -1
        )![0] as WebSelectionTrackingOptions;
        expect(options.isEnabled()).toBe(true);
        expect(mockStartSelectionTracker).toHaveBeenCalled();
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
      });
    });

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

      it("revokes lifecycle-sensitive mutations before returning (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", () => {
        const plugin = createPluginUnderTest([]);
        Object.assign(plugin, { pluginLifecycleActive: true });

        plugin.onunload();

        expect(plugin.isPluginLifecycleActive()).toBe(false);
      });

      it("flushes persistence synchronously, before returning to Obsidian", () => {
        const calls: string[] = [];
        const plugin = createPluginUnderTest(calls);

        plugin.onunload();

        // Everything above teardown()'s first `await` must run before the next
        // `onload()` can start, which is what makes the vault boundary real.
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

    describe("isPluginLifecycleActive()", () => {
      it("reports whether this plugin instance owns lifecycle-sensitive mutations", () => {
        const plugin = createPluginUnderTest([]);
        Object.assign(plugin, { pluginLifecycleActive: true });

        expect(plugin.isPluginLifecycleActive()).toBe(true);
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
  });
});
