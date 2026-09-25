/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
// The plugin module graph reaches Obsidian base classes the shared mock does
// not model and provider SDKs Jest cannot resolve under jsdom; stubbing them
// here (rather than in `__mocks__/obsidian.js`) keeps the blast radius to this
// suite while letting the real `CopilotPlugin` class load.
jest.mock("obsidian", () => {
  const actual = jest.requireActual<Record<string, unknown>>("obsidian");
  const { StateField } =
    jest.requireActual<typeof import("@codemirror/state")>("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define<unknown>({ create: () => null, update: (value) => value }),
    Plugin: class Plugin {},
    PluginSettingTab: class PluginSettingTab {},
    MarkdownView: class MarkdownView {},
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
jest.mock("@/utils/chatDeepLink", () => ({
  buildChatDeepLink: jest.fn(),
  findChatFileByDeepLinkId: jest.fn(),
  getSavedChatDeepLinkId: jest.fn(),
}));
const mockSkillManagerDispose = jest.fn();
const mockSkillManagerHasInstance = jest.fn(() => true);
jest.mock("@/agentMode", () => ({
  SkillManager: {
    hasInstance: () => mockSkillManagerHasInstance(),
    getInstance: () => ({ dispose: mockSkillManagerDispose }),
  },
}));

import CopilotPlugin from "@/main";
import CopilotView from "@/components/CopilotView";
import { getSelectedTextContexts, setSelectedTextContexts } from "@/aiParams";
import { DEFAULT_SETTINGS } from "@/constants";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import type { WebSelectionTrackingOptions } from "@/services/webViewerService/webViewerServiceSelection";
import { EditorView } from "@codemirror/view";
import type { Extension, StateField } from "@codemirror/state";
import { editorInfoField, type MarkdownFileInfo } from "obsidian";

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
import {
  buildChatDeepLink,
  findChatFileByDeepLinkId,
  getSavedChatDeepLinkId,
} from "@/utils/chatDeepLink";
import { Notice, TFile, type WorkspaceLeaf } from "obsidian";

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
    describe("copyChatLink()", () => {
      beforeEach(() => jest.clearAllMocks());

      it("copies the saved file's frontmatter epoch as a vault-scoped URI", async () => {
        const plugin = createPluginUnderTest([]);
        Object.assign(plugin, { app: { vault: { getName: () => "My Vault" } } });
        jest.mocked(getSavedChatDeepLinkId).mockResolvedValue("epoch:1735732800000");
        jest.mocked(buildChatDeepLink).mockReturnValue("obsidian://copilot-chat?stable");
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

        await plugin.copyChatLink("Copilot/conversations/renamed.md");

        expect(getSavedChatDeepLinkId).toHaveBeenCalledWith(
          plugin.app,
          "Copilot/conversations/renamed.md"
        );
        expect(buildChatDeepLink).toHaveBeenCalledWith("My Vault", "epoch:1735732800000");
        expect(writeText).toHaveBeenCalledWith("obsidian://copilot-chat?stable");
      });

      it("copies a native agent identity without looking for a Markdown note", async () => {
        const plugin = createPluginUnderTest([]);
        Object.assign(plugin, { app: { vault: { getName: () => "My Vault" } } });
        const nativeId = "copilot-agent-session://codex/abc";
        jest.mocked(buildChatDeepLink).mockReturnValue("obsidian://copilot-chat?native");
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

        await plugin.copyChatLink(nativeId);

        expect(getSavedChatDeepLinkId).not.toHaveBeenCalled();
        expect(buildChatDeepLink).toHaveBeenCalledWith("My Vault", nativeId);
        expect(writeText).toHaveBeenCalledWith("obsidian://copilot-chat?native");
      });
    });

    describe("openChatDeepLink()", () => {
      beforeEach(() => jest.clearAllMocks());

      it("loads the note resolved from an epoch id through the existing loader", async () => {
        const plugin = createPluginUnderTest([]);
        jest.mocked(findChatFileByDeepLinkId).mockResolvedValue({
          path: "Copilot/conversations/renamed.md",
        } as unknown as TFile);
        const load = jest.spyOn(plugin, "loadChatById").mockResolvedValue(undefined);

        await plugin.openChatDeepLink({ action: "copilot-chat", id: "epoch:1735732800000" });

        expect(findChatFileByDeepLinkId).toHaveBeenCalledWith(plugin.app, "epoch:1735732800000");
        expect(load).toHaveBeenCalledWith("Copilot/conversations/renamed.md");
      });

      it("resumes a native agent session id without looking for a note", async () => {
        const plugin = createPluginUnderTest([]);
        const load = jest.spyOn(plugin, "loadChatById").mockResolvedValue(undefined);

        await plugin.openChatDeepLink({ id: "copilot-agent-session://codex/abc" });

        expect(findChatFileByDeepLinkId).not.toHaveBeenCalled();
        expect(load).toHaveBeenCalledWith("copilot-agent-session://codex/abc");
      });

      it("does not load anything when the id resolves to no note", async () => {
        const plugin = createPluginUnderTest([]);
        jest.mocked(findChatFileByDeepLinkId).mockResolvedValue(null);
        const load = jest.spyOn(plugin, "loadChatById").mockResolvedValue(undefined);

        await plugin.openChatDeepLink({ id: "Copilot/conversations/private.md" });

        expect(load).not.toHaveBeenCalled();
      });
    });

    describe("initSelectionHandler()", () => {
      beforeEach(() => {
        jest.useFakeTimers();
        setSelectedTextContexts([]);
      });
      afterEach(() => {
        jest.useRealTimers();
        setSelectedTextContexts([]);
      });

      it("attaches Reading view text after the debounce even when chat takes the selection first, then clears it in the note (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
        const preview = document.createElement("div");
        preview.textContent = "Excerpt from the note";
        const chat = document.createElement("div");
        chat.textContent = "Chat input";
        document.body.append(preview, chat);
        const noteView = {
          file: { path: "Research.md", basename: "Research" },
          getMode: () => "preview",
          previewMode: { containerEl: preview },
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
          app: { workspace: { getActiveViewOfType: () => noteView, on: jest.fn() } },
        });
        const select = (node: Node, end: number) => {
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, end);
          const selection = document.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
        };

        plugin.initSelectionHandler();
        select(preview.firstChild!, 7);
        select(chat.firstChild!, 0);
        expect(getSelectedTextContexts()).toEqual([]);
        jest.advanceTimersByTime(500);
        expect(getSelectedTextContexts()).toEqual([
          expect.objectContaining({
            content: "Excerpt",
            notePath: "Research.md",
            startLine: 0,
            endLine: 0,
          }),
        ]);

        select(preview.firstChild!, 0);
        jest.advanceTimersByTime(500);
        expect(getSelectedTextContexts()).toEqual([]);

        document.getSelection()!.removeAllRanges();
        cleanups.forEach((cleanup) => cleanup());
        preview.remove();
        chat.remove();
      });

      it("attaches and clears a note excerpt from the focused editor's own note after the debounce (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
        let extension: Extension | undefined;
        const plugin = Object.create(CopilotPlugin.prototype) as CopilotPlugin;
        Object.assign(plugin, {
          registerEditorExtension: (value: Extension) => {
            extension = value;
          },
          registerDomEvent: jest.fn(),
          registerEvent: jest.fn(),
          app: { workspace: { on: jest.fn() } },
        });
        plugin.initSelectionHandler();
        const noteInfo = {
          file: { path: "Research.md", basename: "Research" },
          editor: {
            listSelections: () => [
              {
                anchor: { line: 0, ch: cm.state.selection.main.anchor },
                head: { line: 0, ch: cm.state.selection.main.head },
              },
            ],
            getSelection: () =>
              cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to),
          },
        } as unknown as MarkdownFileInfo;
        const cm = new EditorView({
          doc: "Excerpt from the note",
          parent: document.body,
          extensions: [
            extension!,
            (editorInfoField as unknown as StateField<unknown>).init(() => noteInfo),
          ],
        });

        cm.focus();
        cm.dispatch({ selection: { anchor: 0, head: 3 } });
        cm.dispatch({ selection: { anchor: 0, head: 7 } });
        jest.advanceTimersByTime(500);
        expect(getSelectedTextContexts()).toEqual([
          expect.objectContaining({ content: "Excerpt", notePath: "Research.md" }),
        ]);

        cm.dispatch({ selection: { anchor: 7 } });
        jest.advanceTimersByTime(500);
        expect(getSelectedTextContexts()).toEqual([]);
        cm.destroy();
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

        plugin.handleSelectionChange({
          file: { path: "Research.md", basename: "Research" },
          editor: {
            listSelections: () => [{ anchor: { line: 1, ch: 0 }, head: { line: 2, ch: 7 } }],
            getSelection: () => "An excerpt from the note.",
          },
        } as unknown as MarkdownFileInfo);

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

    describe("addNoteToAgentChat()", () => {
      class AgentView {
        eventTarget = { queueVisible: jest.fn() };
      }

      beforeEach(() => {
        jest.clearAllMocks();
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 reveals an existing Agent Chat and attaches the note to its active draft", async () => {
        const plugin = createPluginUnderTest([]);
        const leaf = { view: new AgentView() } as unknown as WorkspaceLeaf;
        const revealLeaf = jest.fn();
        const getRightLeaf = jest.fn();
        const addContextNoteToActiveChat = jest.fn().mockResolvedValue(undefined);
        Object.assign(plugin, {
          CopilotAgentView: AgentView,
          agentSessionManager: { addContextNoteToActiveChat },
          app: { workspace: { getLeavesOfType: jest.fn(() => [leaf]), revealLeaf, getRightLeaf } },
        });
        const note = Object.assign(new TFile(), { path: "Research.md" });

        await plugin.addNoteToAgentChat(note, true);

        expect(revealLeaf).toHaveBeenCalledWith(leaf);
        expect(getRightLeaf).not.toHaveBeenCalled();
        expect(addContextNoteToActiveChat).toHaveBeenCalledWith(note);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 opens Agent Chat in the right sidebar before attaching the note when none is open", async () => {
        const plugin = createPluginUnderTest([]);
        const leaf = {
          view: new AgentView(),
          setViewState: jest.fn().mockResolvedValue(undefined),
        } as unknown as WorkspaceLeaf;
        const getRightLeaf = jest.fn(() => leaf);
        const getLeaf = jest.fn();
        const revealLeaf = jest.fn();
        const addContextNoteToActiveChat = jest.fn().mockResolvedValue(undefined);
        Object.assign(plugin, {
          CopilotAgentView: AgentView,
          agentSessionManager: { addContextNoteToActiveChat },
          app: {
            workspace: { getLeavesOfType: jest.fn(() => []), getRightLeaf, getLeaf, revealLeaf },
          },
        });
        const note = Object.assign(new TFile(), { path: "Journal.md" });

        await plugin.addNoteToAgentChat(note, true);

        expect(getRightLeaf).toHaveBeenCalledWith(false);
        expect(getLeaf).not.toHaveBeenCalled();
        expect(leaf.setViewState).toHaveBeenCalledWith({ type: CHAT_AGENT_VIEWTYPE, active: true });
        expect(revealLeaf).toHaveBeenCalledWith(leaf);
        expect(addContextNoteToActiveChat).toHaveBeenCalledWith(note);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 reports a failed attachment without throwing", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("backend missing");
        Object.assign(plugin, {
          CopilotAgentView: AgentView,
          agentSessionManager: {
            addContextNoteToActiveChat: jest.fn().mockRejectedValue(failure),
          },
          app: {
            workspace: {
              getLeavesOfType: jest.fn(() => [{ view: new AgentView() }]),
              revealLeaf: jest.fn(),
            },
          },
        });

        await expect(
          plugin.addNoteToAgentChat(Object.assign(new TFile(), { path: "Research.md" }))
        ).resolves.toBeUndefined();

        expect(logError).toHaveBeenCalledWith("Failed to add a note to Agent Chat.", failure);
        expect(Notice).toHaveBeenCalledWith(
          "Could not add the note to Agent Chat. Check Copilot logs."
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 reports a failure to open the Agent Chat pane without throwing", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("view state rejected");
        const addContextNoteToActiveChat = jest.fn();
        Object.assign(plugin, {
          CopilotAgentView: AgentView,
          agentSessionManager: { addContextNoteToActiveChat },
          app: {
            workspace: {
              getLeavesOfType: jest.fn(() => []),
              getRightLeaf: jest.fn(() => ({ setViewState: jest.fn().mockRejectedValue(failure) })),
            },
          },
        });

        await expect(
          plugin.addNoteToAgentChat(Object.assign(new TFile(), { path: "Research.md" }), true)
        ).resolves.toBeUndefined();

        expect(addContextNoteToActiveChat).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith("Failed to add a note to Agent Chat.", failure);
        expect(Notice).toHaveBeenCalledWith(
          "Could not add the note to Agent Chat. Check Copilot logs."
        );
      });
    });

    describe("addNoteToActiveChat()", () => {
      beforeEach(() => {
        jest.clearAllMocks();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 attaches the note to Agent Chat as context when Agent Chat is the target", async () => {
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
        const plugin = createPluginUnderTest([]);
        const addNoteToAgentChat = jest
          .spyOn(plugin, "addNoteToAgentChat")
          .mockResolvedValue(undefined);
        const note = Object.assign(new TFile(), { path: "Research.md" });

        await plugin.addNoteToActiveChat(note);

        expect(addNoteToAgentChat).toHaveBeenCalledWith(note);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 keeps inserting a wikilink into the legacy chat when it is the target", async () => {
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
        const plugin = createPluginUnderTest([]);
        const view = Object.assign(Object.create(CopilotView.prototype) as CopilotView, {
          eventTarget: { queueInsertText: jest.fn() },
        });
        const leaf = { view } as unknown as WorkspaceLeaf;
        const revealLeaf = jest.fn();
        Object.assign(plugin, {
          app: { workspace: { getLeavesOfType: jest.fn(() => [leaf]), revealLeaf } },
        });
        const note = Object.assign(new TFile(), {
          path: "Notes/Research.md",
          basename: "Research",
        });

        await plugin.addNoteToActiveChat(note);

        expect(revealLeaf).toHaveBeenCalledWith(leaf);
        expect(view.eventTarget.queueInsertText).toHaveBeenCalledWith("[[Research]]");
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
