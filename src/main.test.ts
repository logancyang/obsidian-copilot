/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */
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
    addIcon: jest.fn(),
  };
});
jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: { getInstance: jest.fn() },
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logFatalError: jest.fn(),
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
  logFileManager: { flush: jest.fn().mockResolvedValue(undefined), setApp: jest.fn() },
}));
jest.mock("@/settings/migrations", () => ({ runSettingsMigrations: jest.fn() }));
jest.mock("@/settings/migrations/legacyIndexRemovalMigration", () => ({
  cleanupLegacyIndexArtifacts: jest.fn(),
}));
jest.mock("@/commands/migrator", () => ({
  ...jest.requireActual<typeof import("@/commands/migrator")>("@/commands/migrator"),
  migrateCommands: jest.fn(async () => null),
}));
jest.mock("@/system-prompts/migration", () => ({
  ...jest.requireActual<typeof import("@/system-prompts/migration")>("@/system-prompts/migration"),
  migrateSystemPromptsFromSettings: jest.fn(async () => null),
}));
jest.mock("@/openArtifacts/openArtifactsLedger", () => ({ migrateOpenArtifactsFolder: jest.fn() }));
jest.mock("@/state/vaultDataAtoms", () => ({
  VaultDataManager: { getInstance: jest.fn(() => ({ cleanup: jest.fn(), initialize: jest.fn() })) },
}));
jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(() => ({ stopActiveWebTabTracking: jest.fn() })),
  startActiveWebTabTracking: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: jest.fn(() => false) }));
jest.mock("@/utils/notificationSound", () => ({ disposeNotificationSound: jest.fn() }));
jest.mock("@/utils/chatDeepLink", () => ({
  ...jest.requireActual<typeof import("@/utils/chatDeepLink")>("@/utils/chatDeepLink"),
  findChatFileByDeepLinkId: jest.fn(),
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
import { CHAT_AGENT_VIEWTYPE, CHAT_VIEWTYPE } from "@/constants";
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
import { logError, logFatalError, logInfo, logWarn } from "@/logger";
import { migrateCommands } from "@/commands/migrator";
import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { logFileManager } from "@/logFileManager";
import { flushPersistence, resetPersistenceState } from "@/services/settingsPersistence";
import { migrateOpenArtifactsFolder } from "@/openArtifacts/openArtifactsLedger";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { disposeNotificationSound } from "@/utils/notificationSound";
import { findChatFileByDeepLinkId } from "@/utils/chatDeepLink";
import { Notice, TFile, type WorkspaceLeaf } from "obsidian";

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

async function flushTeardown(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("main", () => {
  describe("CopilotPlugin", () => {
    describe("copyChatLink()", () => {
      beforeEach(() => jest.clearAllMocks());

      it("copies a markdown link titled by the chat topic that targets the note's epoch", async () => {
        const plugin = createPluginUnderTest([]);
        const frontmatter = { epoch: 1735732800000, topic: "Trip planning" };
        Object.assign(plugin, {
          app: {
            vault: {
              getName: () => "My Vault",
              getAbstractFileByPath: (path: string) =>
                new (TFile as unknown as new (path: string) => TFile)(path),
            },
            metadataCache: {
              getCache: () => ({ frontmatter }),
              getFileCache: () => ({ frontmatter }),
            },
          },
        });
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

        await plugin.copyChatLink(async () => "Copilot/conversations/renamed.md");

        expect(writeText).toHaveBeenCalledWith(
          "[Trip planning](obsidian://copilot-chat?vault=My%20Vault&id=epoch%3A1735732800000)"
        );
      });

      it.each([
        ["returns no note", async () => ""],
        [
          "throws",
          async () => {
            throw new Error("disk full");
          },
        ],
      ])(
        "reports a failure and copies nothing when saving the chat %s https://github.com/Brevilabs/obsidian-copilot-private/issues/601",
        async (_, resolveNotePath) => {
          const plugin = createPluginUnderTest([]);
          const writeText = jest.fn().mockResolvedValue(undefined);
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
          });

          await plugin.copyChatLink(resolveNotePath);

          expect(writeText).not.toHaveBeenCalled();
          expect(Notice).toHaveBeenCalledWith("Could not copy chat link.");
        }
      );
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

    describe("onload()", () => {
      const pendingTeardown = Symbol.for("obsidian-copilot:pending-teardown");

      beforeEach(() => {
        jest.clearAllMocks();
        delete (window as unknown as Record<symbol, unknown>)[pendingTeardown];
        (flushPersistence as jest.Mock).mockResolvedValue(undefined);
        (logFileManager.flush as jest.Mock).mockResolvedValue(undefined);
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
        (migrateOpenArtifactsFolder as jest.Mock).mockResolvedValue(undefined);
      });

      function createLoadingPlugin(loadSettings: () => Promise<void> = async () => undefined) {
        const plugin = createPluginUnderTest([]);
        const registrations = {
          register: jest.fn(),
          registerEvent: jest.fn(),
          registerDomEvent: jest.fn(),
          registerInterval: jest.fn(),
          registerView: jest.fn(),
          registerEditorExtension: jest.fn(),
          registerObsidianProtocolHandler: jest.fn(),
          addSettingTab: jest.fn(),
          addRibbonIcon: jest.fn(),
          addCommand: jest.fn(),
        };
        Object.assign(plugin, registrations, {
          app: {
            vault: { adapter: {}, configDir: "config", on: jest.fn(), getRoot: jest.fn() },
            workspace: {
              getLeavesOfType: jest.fn(() => []),
              on: jest.fn(),
              onLayoutReady: jest.fn(),
              getActiveViewOfType: jest.fn(() => null),
            },
            metadataCache: { on: jest.fn() },
            loadLocalStorage: jest.fn(),
          },
          manifest: { version: "4.0.13" },
          pluginLifecycleActive: true,
          unload: jest.fn(),
          loadSettings: jest.fn(loadSettings),
          openChatDeepLink: jest.fn(async () => undefined),
        });
        const finishStartup = () =>
          (plugin as unknown as { initialization: Promise<void> }).initialization;
        const openCopilotChatLink = (params: Record<string, string>) =>
          (
            registrations.registerObsidianProtocolHandler.mock.calls[0][1] as (
              params: Record<string, string>
            ) => void
          )(params);
        return { plugin, registrations, finishStartup, openCopilotChatLink };
      }

      function deferred() {
        let resolve: () => void = () => undefined;
        const promise = new Promise<void>((done) => (resolve = done));
        return { promise, resolve };
      }

      it("returns before settings load so Obsidian can open the vault without waiting for Copilot https://github.com/logancyang/obsidian-copilot/issues/3518", () => {
        const settings = deferred();
        const { plugin, registrations } = createLoadingPlugin(() => settings.promise);

        expect(plugin.onload()).toBeUndefined();

        expect(registrations.registerObsidianProtocolHandler).toHaveBeenCalledWith(
          "copilot-chat",
          expect.any(Function)
        );
        expect(registrations.addSettingTab).not.toHaveBeenCalled();
        expect(registrations.registerView).not.toHaveBeenCalled();
      });

      it("registers the settings tab, chat views, commands, and ribbon icon once startup finishes", async () => {
        const { plugin, registrations, finishStartup } = createLoadingPlugin();

        plugin.onload();

        await finishStartup();
        expect(registrations.addSettingTab).toHaveBeenCalledTimes(1);
        expect(registrations.registerView).toHaveBeenCalledWith(
          CHAT_VIEWTYPE,
          expect.any(Function)
        );
        expect(registrations.addCommand).toHaveBeenCalled();
        expect(registrations.addRibbonIcon).toHaveBeenCalledTimes(1);
        expect(registrations.registerObsidianProtocolHandler).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["settings load", "settings"],
        ["the .openartifacts folder move, its last startup step", "folder"],
      ] as const)(
        "registers nothing after Obsidian unloads it during %s https://github.com/logancyang/obsidian-copilot/issues/3518",
        async (_step, pausedStep) => {
          const step = deferred();
          const { plugin, registrations, finishStartup } = createLoadingPlugin(
            pausedStep === "settings" ? () => step.promise : undefined
          );
          if (pausedStep === "folder") {
            (migrateOpenArtifactsFolder as jest.Mock).mockReturnValue(step.promise);
          }

          plugin.onload();
          plugin.onunload();
          step.resolve();

          await finishStartup();
          expect(registrations.register).not.toHaveBeenCalled();
          expect(registrations.addSettingTab).not.toHaveBeenCalled();
          expect(registrations.registerView).not.toHaveBeenCalled();
          expect(registrations.addCommand).not.toHaveBeenCalled();
        }
      );

      it("loads settings only after the previous copy finishes shutting down https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const calls: string[] = [];
        const previous = createPluginUnderTest(calls);
        (logFileManager.flush as jest.Mock).mockImplementation(async () => {
          calls.push("previousLogFlushed");
        });
        const next = createLoadingPlugin(async () => {
          calls.push("settingsLoaded");
        });

        previous.onunload();
        next.plugin.onload();

        await next.finishStartup();
        expect(calls.slice(-2)).toEqual(["previousLogFlushed", "settingsLoaded"]);
      });

      it("waits for every earlier copy's shutdown, not only the most recently unloaded one https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        jest.useFakeTimers();
        try {
          const slow = createPluginUnderTest([]);
          Object.assign(slow.agentSessionManager as object, {
            shutdown: jest.fn(() => new Promise<void>(() => undefined)),
          });
          const abandoned = createLoadingPlugin();
          const next = createLoadingPlugin();

          slow.onunload();
          abandoned.plugin.onload();
          abandoned.plugin.onunload();
          next.plugin.onload();
          await jest.advanceTimersByTimeAsync(9_999);

          expect(next.plugin.loadSettings).not.toHaveBeenCalled();
        } finally {
          jest.useRealTimers();
        }
      });

      it("skips settings load when Obsidian unloads it while it waits for the previous copy's shutdown https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const previousTeardown = deferred();
        (window as unknown as Record<symbol, unknown>)[pendingTeardown] = previousTeardown.promise;
        const { plugin, finishStartup } = createLoadingPlugin();

        plugin.onload();
        plugin.onunload();
        previousTeardown.resolve();

        await finishStartup();
        expect(resetPersistenceState).not.toHaveBeenCalled();
        expect(plugin.loadSettings).not.toHaveBeenCalled();
      });

      it("keeps the next copy from loading settings until a copy unloaded mid-load settles https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        jest.useFakeTimers();
        try {
          const previousSettingsStarted = deferred();
          const previousSettings = deferred();
          const previous = createLoadingPlugin(() => {
            previousSettingsStarted.resolve();
            return previousSettings.promise;
          });
          const next = createLoadingPlugin();

          previous.plugin.onload();
          await previousSettingsStarted.promise;
          previous.plugin.onunload();
          next.plugin.onload();
          await jest.advanceTimersByTimeAsync(9_999);
          expect(next.plugin.loadSettings).not.toHaveBeenCalled();
          previousSettings.resolve();

          await next.finishStartup();
          expect(next.plugin.loadSettings).toHaveBeenCalledTimes(1);
        } finally {
          jest.useRealTimers();
        }
      });

      it("starts anyway after 10 seconds when the previous copy's shutdown hangs https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        jest.useFakeTimers();
        try {
          (window as unknown as Record<symbol, unknown>)[pendingTeardown] = new Promise(
            () => undefined
          );
          const { plugin, finishStartup } = createLoadingPlugin();

          plugin.onload();
          await jest.advanceTimersByTimeAsync(9_999);
          expect(plugin.loadSettings).not.toHaveBeenCalled();
          await jest.advanceTimersByTimeAsync(1);

          await finishStartup();
          expect(plugin.loadSettings).toHaveBeenCalledTimes(1);
          expect(logWarn).toHaveBeenCalledWith(
            "Copilot started before its previous copy finished shutting down.",
            expect.anything()
          );
        } finally {
          jest.useRealTimers();
        }
      });

      it("delays only the first start after a shutdown that never finishes https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        jest.useFakeTimers();
        try {
          (window as unknown as Record<symbol, unknown>)[pendingTeardown] = new Promise(
            () => undefined
          );
          const first = createLoadingPlugin();
          first.plugin.onload();
          await jest.advanceTimersByTimeAsync(10_000);
          await first.finishStartup();
          const second = createLoadingPlugin();

          first.plugin.onunload();
          second.plugin.onload();
          await jest.advanceTimersByTimeAsync(1);

          expect(second.plugin.loadSettings).toHaveBeenCalledTimes(1);
        } finally {
          jest.useRealTimers();
        }
      });

      it("opens a copilot-chat link that arrives during startup once the chat managers exist https://github.com/logancyang/obsidian-copilot/issues/3271", async () => {
        const settings = deferred();
        const { plugin, finishStartup, openCopilotChatLink } = createLoadingPlugin(
          () => settings.promise
        );

        plugin.onload();
        openCopilotChatLink({ action: "copilot-chat", id: "epoch:1" });
        expect(plugin.openChatDeepLink).not.toHaveBeenCalled();
        settings.resolve();
        await finishStartup();

        expect(plugin.openChatDeepLink).toHaveBeenCalledWith({
          action: "copilot-chat",
          id: "epoch:1",
        });
      });

      it("ignores a copilot-chat link when Copilot is unloaded before startup finishes https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const settings = deferred();
        const { plugin, finishStartup, openCopilotChatLink } = createLoadingPlugin(
          () => settings.promise
        );

        plugin.onload();
        openCopilotChatLink({ action: "copilot-chat", id: "epoch:1" });
        plugin.onunload();
        settings.resolve();
        await finishStartup();

        expect(plugin.openChatDeepLink).not.toHaveBeenCalled();
      });

      it("ignores a copilot-chat link when Copilot is unloaded before the link's queued open runs https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const { plugin, finishStartup, openCopilotChatLink } = createLoadingPlugin();
        plugin.onload();
        await finishStartup();

        openCopilotChatLink({ action: "copilot-chat", id: "epoch:1" });
        plugin.onunload();
        await finishStartup();

        expect(plugin.openChatDeepLink).not.toHaveBeenCalled();
      });

      it("reports a startup failure even with debug logging off, then unloads what startup registered https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
        const failure = new Error("settings unreadable");
        const { plugin, finishStartup } = createLoadingPlugin(async () => {
          throw failure;
        });

        plugin.onload();

        await finishStartup();
        expect(logFatalError).toHaveBeenCalledWith("Copilot failed to start.", failure);
        expect(Notice).toHaveBeenCalledWith(
          "Copilot failed to start. Check the console for details."
        );
        expect(plugin.unload).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["runs", "stays loaded", true],
        ["skips", "unloads", false],
      ] as const)(
        "%s the legacy command and system-prompt migrations when Copilot %s while their files load https://github.com/logancyang/obsidian-copilot/issues/3518",
        async (_outcome, _lifecycle, staysLoaded) => {
          const { plugin, finishStartup } = createLoadingPlugin();
          plugin.onload();
          await finishStartup();
          const layoutReady = (plugin.app.workspace.onLayoutReady as jest.Mock).mock
            .calls[0][0] as () => void;
          const filesLoaded = deferred();
          Object.assign(plugin, {
            customCommandRegister: { initialize: () => filesLoaded.promise, cleanup: jest.fn() },
            systemPromptRegister: { initialize: () => filesLoaded.promise, cleanup: jest.fn() },
            projectRegister: { initialize: async () => null, cleanup: jest.fn() },
          });

          layoutReady();
          if (!staysLoaded) plugin.onunload();
          filesLoaded.resolve();
          await filesLoaded.promise;

          expect(migrateCommands).toHaveBeenCalledTimes(staysLoaded ? 1 : 0);
          expect(migrateSystemPromptsFromSettings).toHaveBeenCalledTimes(staysLoaded ? 1 : 0);
        }
      );
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
        expect(plugin.isPluginLifecycleActive()).toBe(true);

        plugin.onunload();

        expect(plugin.isPluginLifecycleActive()).toBe(false);
      });

      it("releases audio before asynchronous teardown can overlap a later plugin lifecycle (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        const calls: string[] = [];
        let releaseSessions: () => void = () => undefined;
        (disposeNotificationSound as jest.Mock).mockImplementation(() => calls.push("audio"));
        const plugin = createPluginUnderTest(calls);
        Object.assign(plugin, {
          agentSessionManager: {
            shutdown: () =>
              new Promise<void>((resolve) => {
                releaseSessions = resolve;
              }),
          },
        });

        plugin.onunload();

        expect(calls).toEqual(["audio", "highlight", "modelDiscovery"]);
        releaseSessions();
        await flushTeardown();
      });

      it("tears down collaborators in order, draining settings writes only after it stops queuing them and the log last https://github.com/logancyang/obsidian-copilot/issues/3518", async () => {
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
          "highlight",
          "modelDiscovery",
          "sessions",
          "customCommands",
          "systemPrompts",
          "projects",
          "settings",
          "persistence",
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
  });
});
