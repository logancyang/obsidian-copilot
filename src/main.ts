import { startReleaseUpdateCheck } from "@/services/releaseUpdateNotice";
import { releaseCursorAssociation } from "@/editor/releaseCursorAssociation";
import { registerNoteHeaderAction } from "@/editor/registerNoteHeaderAction";
import type { AgentSessionManager, SessionHost, SkillManager } from "@/agentMode";
import { isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
import {
  buildChatDeepLink,
  findChatFileByDeepLinkId,
  getSavedChatDeepLinkId,
} from "@/utils/chatDeepLink";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import ChainOwner from "@/LLMProviders/chainOwner";
import { CustomModel, setSelectedTextContexts, getSelectedTextContexts } from "@/aiParams";
import { NoteSelectedTextContext, SelectedTextContext } from "@/types/message";
import { registerCommands } from "@/commands";
import CopilotView from "@/components/CopilotView";
import RelevantNotesView from "@/components/RelevantNotesView";
import { APPLY_VIEW_TYPE, ApplyView } from "@/components/composer/ApplyView";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { LoadChatHistoryModal } from "@/components/modals/LoadChatHistoryModal";

import { registerContextMenu } from "@/commands/contextMenu";
import { CustomCommandRegister } from "@/commands/customCommandRegister";
import { migrateCommands } from "@/commands/migrator";
import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { SystemPromptRegister } from "@/system-prompts/systemPromptRegister";
import { ProjectRegister } from "@/projects/projectRegister";
import {
  ABORT_REASON,
  AGENT_CHAT_MODE,
  CHAT_AGENT_VIEWTYPE,
  CHAT_VIEWTYPE,
  COPILOT_AGENT_ICON_ID,
  COPILOT_AGENT_ICON_SVG,
  DEFAULT_OPEN_AREA,
  EVENT_NAMES,
  RELEVANT_NOTES_VIEWTYPE,
} from "@/constants";
import { ChatManager } from "@/core/ChatManager";
import { MessageRepository } from "@/core/MessageRepository";
import { logError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import {
  createModelManagement,
  plusSyncNeeded,
  syncCopilotPlusProvider,
  type ModelManagementApi,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { backupLegacyCredentials } from "@/services/legacyCredentialBackup";
import {
  persistSettings,
  loadSettingsWithKeychain,
  flushPersistence,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { clearRecordedPromptPayload } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import {
  checkIsPaidUser,
  ENTITLEMENT_REFRESH_INTERVAL_MS,
  verifyCachedEntitlement,
} from "@/plusUtils";
import {
  getWebViewerService,
  startActiveWebTabTracking,
} from "@/services/webViewerService/webViewerServiceSingleton";
import { WebSelectionTracker } from "@/services/webViewerService/webViewerServiceSelection";
import { runSettingsMigrations } from "@/settings/migrations";
import {
  cleanupLegacyIndexArtifacts,
  LEGACY_INDEX_CLEANUP_STORAGE_KEY,
} from "@/settings/migrations/legacyIndexRemovalMigration";
import { CopilotSettingTab } from "@/settings/SettingsPage";
import {
  type CopilotSettings,
  getModelKeyFromModel,
  getSettings,
  setSettings,
  subscribeToSettingsChange,
  updateSetting,
} from "@/settings/model";
import { ensureCopilotSubfolders, getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { buildUpgradeRelocationEntries } from "@/settings/upgradeNotice";
import { dehydrateDeviceProfile, hydrateDeviceProfile } from "@/settings/deviceProfiles";
import { getDeviceId } from "@/utils/deviceId";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { disposeNotificationSound } from "@/utils/notificationSound";
import { installRendererEventsShim } from "@/utils/rendererEventsShim";
import { ContextProcessor } from "@/contextProcessor";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { ChatManagerChatUIState } from "@/state/ChatUIState";
import { VaultDataManager } from "@/state/vaultDataAtoms";
import { FileParserManager } from "@/tools/FileParserManager";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import {
  ChatSelectionHighlightController,
  hideChatSelectionHighlight,
  QuickAskController,
  SelectionHighlight,
} from "@/editor";
import {
  addIcon,
  Editor,
  editorInfoField,
  FileSystemAdapter,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  ViewCreator,
  WorkspaceLeaf,
} from "obsidian";
import {
  formatStartupMigrationSummary,
  runStartupMigrationSummary,
  shouldClearCredentialRecovery,
  shouldClearFolderRelocation,
  type StartupMigrationItem,
  type StartupMigrationTask,
} from "@/services/startupMigration";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import {
  extractChatLastAccessedAtMs,
  fileToHistoryItem,
  filterChatHistoryFiles,
} from "@/utils/chatHistoryUtils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import {
  listMarkdownFiles,
  patchFrontmatter,
  readFrontmatterViaAdapter,
  resolveFileByPath,
  trashFile,
} from "@/utils/vaultAdapterUtils";
import { v4 as uuidv4 } from "uuid";
import { EditorView } from "@codemirror/view";
import { OpenArtifactsPublisher } from "@/openArtifacts/OpenArtifactsPublisher";
import { migrateOpenArtifactsFolder } from "@/openArtifacts/openArtifactsLedger";
import {
  createSelfHostWebSearchAgentBridge,
  type SelfHostWebSearchAgentBridge,
} from "@/LLMProviders/selfHostServices";

export default class CopilotPlugin extends Plugin {
  chainOwner: ChainOwner;
  brevilabsClient: BrevilabsClient;
  userMessageHistory: string[] = [];
  fileParserManager: FileParserManager;
  customCommandRegister: CustomCommandRegister;
  systemPromptRegister: SystemPromptRegister;
  projectRegister: ProjectRegister;
  settingsUnsubscriber?: () => void;
  chatUIState: ChatManagerChatUIState;
  agentSessionManager?: AgentSessionManager;
  agentSessionHost?: SessionHost;
  skills?: SkillManager;
  private CopilotAgentView?: typeof import("@/agentMode").CopilotAgentView;
  private PlanPreviewView?: typeof import("@/agentMode").PlanPreviewView;
  private planPreviewViewType?: typeof import("@/agentMode").PLAN_PREVIEW_VIEW_TYPE;
  private agentModelDiscoveryUnsubscriber?: () => void;
  modelManagement!: ModelManagementApi;
  selfHostWebSearchAgentBridge?: Readonly<SelfHostWebSearchAgentBridge>;
  private ribbonIconEl?: HTMLElement;
  userMemoryManager: UserMemoryManager;
  quickAskController: QuickAskController;
  chatSelectionHighlightController: ChatSelectionHighlightController;
  private lastActiveChatViewType: typeof CHAT_VIEWTYPE | typeof CHAT_AGENT_VIEWTYPE = CHAT_VIEWTYPE;
  private selectionDebounceTimer?: number;
  private lastSelectionSignature?: string;
  private webSelectionTracker?: WebSelectionTracker;
  private readonly chatHistoryLastAccessedAtManager = new RecentUsageManager<string>();
  private startupMigrationItems: StartupMigrationItem[] = [];
  private pluginLifecycleActive = true;

  public isPluginLifecycleActive(): boolean {
    return this.pluginLifecycleActive;
  }

  async onload(): Promise<void> {
    installRendererEventsShim();
    resetPersistenceState();
    KeychainService.resetInstance();
    KeychainService.getInstance(this.app);
    await this.loadSettings();
    this.modelManagement = createModelManagement({
      app: this.app,
    });
    // Serialized so a fast sign-out then sign-in settles in issue order, not in whichever
    // overlapping reconcile finishes last. Nothing awaits it: consumers read the cached snapshot.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
    let plusSyncChain: Promise<void> = Promise.resolve();
    const syncPlus = (isPaidUser: boolean | undefined, licenseKey: string): void => {
      plusSyncChain = plusSyncChain.then(() =>
        syncCopilotPlusProvider(this.modelManagement, !!isPaidUser, licenseKey)
      );
    };
    syncPlus(getSettings().isPaidUser, getSettings().plusLicenseKey);
    this.settingsUnsubscriber = subscribeToSettingsChange((prev, next) => {
      void (async () => {
        try {
          await persistSettings(next, (data) => this.saveData(data), prev);
        } catch (error) {
          logError("Failed to persist settings.", error);
          new Notice("Copilot failed to save settings. Check logs and try again.");
        }
        if (plusSyncNeeded(prev, next)) {
          syncPlus(next.isPaidUser, next.plusLicenseKey);
        }
      })();
    });
    this.register(
      startReleaseUpdateCheck(
        this.app,
        this.manifest.version,
        getSettings().lastShownStartupVersion,
        (version) => updateSetting("lastShownStartupVersion", version)
      )
    );
    await runSettingsMigrations(this.modelManagement);
    void cleanupLegacyIndexArtifacts({
      adapter: this.app.vault.adapter,
      configDir: this.app.vault.configDir,
      hasRun: () => this.app.loadLocalStorage(LEGACY_INDEX_CLEANUP_STORAGE_KEY) === "done",
      markRun: () => this.app.saveLocalStorage(LEGACY_INDEX_CLEANUP_STORAGE_KEY, "done"),
      removeRetiredEmbeddingSecrets: () =>
        KeychainService.getInstance().removeRetiredEmbeddingSecrets(),
      notifyFailure: (folder) => {
        new Notice(
          `Copilot couldn't remove old index files from ${folder}. Remove them manually if you want to reclaim the space.`
        );
      },
    });
    const isLegacyUpgrade = getSettings().upgradedToV8FromLegacy;
    this.addSettingTab(new CopilotSettingTab(this.app, this));

    initializeBuiltinTools(this.app);

    ContextProcessor.getInstance(this.app);
    CustomCommandManager.getInstance(this.app);
    logFileManager.setApp(this.app);

    this.brevilabsClient = BrevilabsClient.getInstance();
    this.brevilabsClient.setPluginVersion(this.manifest.version);
    void verifyCachedEntitlement();
    if (!isLegacyUpgrade) void checkIsPaidUser(this.app, { trigger: "startup" });
    this.registerInterval(
      window.setInterval(
        () => void checkIsPaidUser(this.app, { trigger: "refresh" }),
        ENTITLEMENT_REFRESH_INTERVAL_MS
      )
    );

    this.chainOwner = ChainOwner.getInstance(this.app, this.modelManagement);

    // Must precede Agent Chat: startup model discovery may spawn OpenCode.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/165
    const selfHostWebSearchAgentBridge = createSelfHostWebSearchAgentBridge();
    this.selfHostWebSearchAgentBridge = selfHostWebSearchAgentBridge;
    this.register(() => {
      selfHostWebSearchAgentBridge.dispose();
      if (this.selfHostWebSearchAgentBridge === selfHostWebSearchAgentBridge) {
        this.selfHostWebSearchAgentBridge = undefined;
      }
    });

    if (isDesktopRuntime()) {
      const {
        CopilotAgentView,
        PlanPreviewView,
        PLAN_PREVIEW_VIEW_TYPE,
        acpFrameSink,
        createAgentSessionHost,
        createAgentSessionManager,
        setFrameSinkVaultBasePath,
        SkillManager,
      } = await import("@/agentMode");
      const { wireAgentModelDiscovery } = await import("@/agentMode/agentModelDiscovery");
      this.CopilotAgentView = CopilotAgentView;
      this.PlanPreviewView = PlanPreviewView;
      this.planPreviewViewType = PLAN_PREVIEW_VIEW_TYPE;

      const adapter = this.app.vault.adapter;
      setFrameSinkVaultBasePath(
        adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null
      );
      // A log left permissive by an older build is only reachable here when
      // frame logging is off. https://github.com/logancyang/obsidian-copilot-preview/issues/250
      void acpFrameSink.narrowLegacyLogs();

      this.agentSessionManager = createAgentSessionManager(this.app, this);
      this.agentSessionHost = createAgentSessionHost(this.app, this, this.agentSessionManager);
      this.skills = SkillManager.getInstance();
      this.agentModelDiscoveryUnsubscriber = wireAgentModelDiscovery(
        this,
        this.agentSessionManager
      );
    }

    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.initialize(this.app);

    this.fileParserManager = new FileParserManager(this.brevilabsClient, this.app.vault);

    const messageRepo = new MessageRepository();
    const chainManager = this.chainOwner.getCurrentChainManager();
    const chatManager = new ChatManager(messageRepo, chainManager, this.fileParserManager, this);
    this.chatUIState = new ChatManagerChatUIState(chatManager);

    this.userMemoryManager = new UserMemoryManager(this.app);

    this.quickAskController = new QuickAskController(this);
    this.registerEditorExtension(this.quickAskController.createExtension());
    this.registerEditorExtension(releaseCursorAssociation);

    this.chatSelectionHighlightController = new ChatSelectionHighlightController(this, {
      closeQuickAskOnChatFocus: false,
    });
    this.chatSelectionHighlightController.initialize();

    if (isDesktopRuntime()) {
      const { activeLeafRef, layoutRef } = startActiveWebTabTracking(this.app, {
        preserveOnViewTypes: [CHAT_VIEWTYPE],
      });
      this.registerEvent(activeLeafRef);
      this.registerEvent(layoutRef);
    }

    addIcon(COPILOT_AGENT_ICON_ID, COPILOT_AGENT_ICON_SVG);

    if (isDesktopRuntime()) registerNoteHeaderAction(this);

    this.safeRegisterView(CHAT_VIEWTYPE, (leaf: WorkspaceLeaf) => new CopilotView(leaf, this));
    this.safeRegisterView(APPLY_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ApplyView(leaf));
    this.safeRegisterView(
      RELEVANT_NOTES_VIEWTYPE,
      (leaf: WorkspaceLeaf) => new RelevantNotesView(leaf, this)
    );
    if (
      isDesktopRuntime() &&
      this.CopilotAgentView &&
      this.PlanPreviewView &&
      this.planPreviewViewType
    ) {
      const AgentView = this.CopilotAgentView;
      const PreviewView = this.PlanPreviewView;
      this.safeRegisterView(
        CHAT_AGENT_VIEWTYPE,
        (leaf: WorkspaceLeaf) => new AgentView(leaf, this)
      );
      this.safeRegisterView(
        this.planPreviewViewType,
        (leaf: WorkspaceLeaf) => new PreviewView(leaf)
      );
    }

    this.initActiveLeafChangeHandler();

    const agentReady = this.canUseAgentView();
    this.ribbonIconEl = this.addRibbonIcon(
      agentReady ? COPILOT_AGENT_ICON_ID : "message-square",
      agentReady ? "Open Copilot Agent Chat" : "Open Copilot Chat",
      () => (this.canUseAgentView() ? this.activateAgentView() : this.activateView())
    );

    // Awaited so no publish can create .openartifacts before the old folder moves; a
    // destination that already exists would strand the legacy history for good.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/337
    try {
      await migrateOpenArtifactsFolder(this.app.vault);
    } catch (error) {
      logError("Failed to move the Symposium publishing folder to .openartifacts.", error);
    }
    const openArtifactsPublisher = new OpenArtifactsPublisher(this.app);
    const publishFile = (file: TFile): void => {
      void openArtifactsPublisher
        .open(file)
        .catch((error) => logError("Failed to open OpenArtifacts publishing.", error));
    };
    this.register(() => openArtifactsPublisher.dispose());
    registerCommands(this, publishFile);

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu) => {
        registerContextMenu(menu, this.app);
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.chatSelectionHighlightController.handleActiveLeafChange(leaf ?? null);

        const activeViewType = leaf?.getViewState().type;
        if (activeViewType === CHAT_VIEWTYPE || activeViewType === CHAT_AGENT_VIEWTYPE) {
          this.lastActiveChatViewType = activeViewType;
        }
      })
    );

    this.customCommandRegister = new CustomCommandRegister(this, this.app);
    this.systemPromptRegister = new SystemPromptRegister(this, this.app);
    this.projectRegister = new ProjectRegister(this.app);

    this.app.workspace.onLayoutReady(() => {
      void this.runStartupMigrations(isLegacyUpgrade).catch((error) => {
        logError("Failed to finish startup migrations", error);
        new Notice("Copilot could not finish startup migration. Reload Obsidian to retry.");
      });
    });

    this.initSelectionHandler();

    this.initWebSelectionWatcher();

    // A queued URI may fire as soon as its handler is registered, so register
    // after chat managers and views are ready to load a conversation.
    // https://github.com/logancyang/obsidian-copilot/issues/3271
    this.registerObsidianProtocolHandler("copilot-chat", (params) => {
      void this.openChatDeepLink(params);
    });
  }

  private async collectLegacyUpgradeRelocation(): Promise<StartupMigrationItem | null> {
    if (!getSettings().upgradedToV8FromLegacy) return null;

    const entries = buildUpgradeRelocationEntries(getSettings());
    if (entries.length > 0) {
      await ensureCopilotSubfolders(this.app.vault, getSettings());
    }
    if (entries.length === 0) {
      updateSetting("upgradedToV8FromLegacy", false);
      return null;
    }
    return {
      id: "folders",
      title: "Copilot folders",
      status: "action-required",
      summary: "Copilot now keeps its files under one folder. Existing files were not moved.",
      details: entries.map(
        ({ label, oldPath, newPath }) => `${label}: move ${oldPath} to ${newPath}.`
      ),
    };
  }

  private async runStartupMigrations(isLegacyUpgrade: boolean): Promise<void> {
    const initialSettings = getSettings();
    const needsLicenseReentry =
      isLegacyUpgrade && initialSettings.isPaidUser === true && !initialSettings.plusLicenseKey;
    const task = (
      result: Promise<StartupMigrationItem | null>,
      failure: StartupMigrationItem,
      notice?: string
    ): StartupMigrationTask => {
      return {
        result,
        failure: isLegacyUpgrade ? failure : null,
        onFailure: (error) => {
          logError(`${failure.title} startup migration failed`, error);
          if (!isLegacyUpgrade && notice) new Notice(notice);
        },
      };
    };

    const projectTask = task(
      this.projectRegister.initialize(),
      {
        id: "projects",
        title: "Projects",
        status: "error",
        summary: "Projects could not be loaded or migrated. Reload Obsidian to retry.",
      },
      "Failed to load projects. Check console for details."
    );
    const commandsTask = task(
      this.customCommandRegister.initialize().then(() => migrateCommands(this.app)),
      {
        id: "custom-commands",
        title: "Custom commands",
        status: "error",
        summary: "Custom commands could not be loaded or migrated. Reload Obsidian to retry.",
      }
    );
    const promptsTask = task(
      this.systemPromptRegister.initialize().then(() => migrateSystemPromptsFromSettings(this.app)),
      {
        id: "system-prompt",
        title: "System prompt",
        status: "error",
        summary: "System prompts could not be loaded or migrated. Reload Obsidian to retry.",
      }
    );
    const relocationTask = task(this.collectLegacyUpgradeRelocation(), {
      id: "folders",
      title: "Copilot folders",
      status: "error",
      summary: "Folder destinations could not be prepared. Reload Obsidian to retry.",
    });
    const license: StartupMigrationItem | null = needsLicenseReentry
      ? {
          id: "copilot-license",
          title: "Copilot license",
          status: "action-required",
          summary: "Copilot could not restore the previous paid status after the upgrade.",
          details: ["Re-enter the license key in Copilot Settings to restore paid features."],
        }
      : null;
    if (isLegacyUpgrade) {
      void checkIsPaidUser(needsLicenseReentry ? undefined : this.app, { trigger: "startup" });
    }

    await runStartupMigrationSummary({
      initialItems: this.startupMigrationItems,
      tasks: [projectTask, commandsTask, promptsTask, relocationTask],
      afterTasks: () => [license],
      present: (items) => {
        new ConfirmModal(
          this.app,
          () => {},
          formatStartupMigrationSummary(items),
          "Copilot upgrade summary",
          "Done",
          ""
        ).open();
      },
      acknowledge: (items) => {
        this.startupMigrationItems = [];
        const pendingCredentialRecovery = getSettings()._pendingCredentialRecovery;
        if (
          shouldClearCredentialRecovery(
            items,
            pendingCredentialRecovery?.deviceId,
            getDeviceId(this.app)
          )
        ) {
          updateSetting("_pendingCredentialRecovery", undefined);
        }
        if (shouldClearFolderRelocation(items)) {
          updateSetting("upgradedToV8FromLegacy", false);
        }
      },
    });
  }

  private safeRegisterView(type: string, viewCreator: ViewCreator): void {
    try {
      this.registerView(type, viewCreator);
    } catch (error) {
      logWarn(`Copilot: view type "${type}" already registered; skipping re-registration.`, error);
    }
  }

  onunload(): void {
    this.pluginLifecycleActive = false;
    // The audio module is shared across hot-reloaded plugin instances, so the outgoing
    // teardown must release its context before a successor can create one. https://github.com/logancyang/obsidian-copilot/issues/2987
    disposeNotificationSound();
    this.teardown().catch((error) => {
      logError("Copilot: plugin teardown failed during unload:", error);
    });
  }

  private async teardown(): Promise<void> {
    await flushPersistence();

    this.clearAllPersistentSelectionHighlights();

    this.chatSelectionHighlightController?.cleanup();

    this.agentModelDiscoveryUnsubscriber?.();
    this.agentSessionHost?.dispose();
    await this.agentSessionManager?.shutdown();

    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.cleanup();

    this.customCommandRegister?.cleanup();
    this.systemPromptRegister?.cleanup();
    this.projectRegister?.cleanup();
    this.settingsUnsubscriber?.();

    if (isDesktopRuntime()) {
      const { SkillManager } = await import("@/agentMode");
      if (SkillManager.hasInstance()) {
        SkillManager.getInstance().dispose();
      }
    }

    window.clearTimeout(this.selectionDebounceTimer);
    this.cleanupWebSelectionWatcher();
    this.clearSelectionContext();

    try {
      const webViewerService = getWebViewerService(this.app);
      webViewerService.stopActiveWebTabTracking();
    } catch {}

    this.modelManagement?.dispose();

    await logFileManager.flush();
    logInfo("Copilot plugin unloaded");
  }

  private clearAllPersistentSelectionHighlights(): void {
    try {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      for (const leaf of leaves) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) continue;
        const cm = view.editor?.cm;
        if (cm) {
          SelectionHighlight.hide(cm);
          hideChatSelectionHighlight(cm);
        }
      }
    } catch (error) {
      logWarn("Failed to clear persistent selection highlights:", error);
    }
  }

  updateUserMessageHistory(newMessage: string) {
    this.userMessageHistory = [...this.userMessageHistory, newMessage];
  }

  async autosaveCurrentChat() {
    if (getSettings().autosaveChat) {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
      if (chatView) {
        await chatView.saveChat();
      }
    }
  }

  async processText(
    editor: Editor,
    eventType: string,
    eventSubtype?: string,
    checkSelectedText = true
  ) {
    const selectedText = editor.getSelection();

    const isChatWindowActive = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE).length > 0;

    if (!isChatWindowActive) {
      await this.activateView();
    }

    window.setTimeout(() => {
      const activeCopilotView = this.app.workspace
        .getLeavesOfType(CHAT_VIEWTYPE)
        .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;
      if (activeCopilotView && (!checkSelectedText || selectedText)) {
        const event = new CustomEvent(eventType, { detail: { selectedText, eventSubtype } });
        activeCopilotView.eventTarget.dispatchEvent(event);
      }
    }, 0);
  }

  processSelection(editor: Editor, eventType: string, eventSubtype?: string) {
    void this.processText(editor, eventType, eventSubtype);
  }

  emitChatIsVisible(viewType: typeof CHAT_VIEWTYPE | typeof CHAT_AGENT_VIEWTYPE = CHAT_VIEWTYPE) {
    const view = this.app.workspace
      .getLeavesOfType(viewType)
      .map((leaf) => leaf.view)
      .find(
        (v): v is CopilotView | InstanceType<NonNullable<typeof this.CopilotAgentView>> =>
          v instanceof CopilotView || this.isCopilotAgentView(v)
      );

    if (view) {
      view.eventTarget.dispatchEvent(new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE));
    }
  }

  initActiveLeafChangeHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) {
          return;
        }
        const activeViewType = leaf.getViewState().type;
        if (activeViewType === CHAT_VIEWTYPE || activeViewType === CHAT_AGENT_VIEWTYPE) {
          this.emitChatIsVisible(activeViewType);
        }
      })
    );
  }

  initSelectionHandler() {
    this.registerEditorExtension(
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet || !update.view.hasFocus) return;

        // The originating editor identifies its note even in a popout, where
        // the active leaf may differ. https://github.com/Brevilabs/obsidian-copilot-private/issues/597
        const info = update.state.field(editorInfoField, false);
        if (info) this.scheduleSelectionUpdate(() => this.handleSelectionChange(info));
      })
    );

    const watchDocument = (doc: Document) =>
      this.registerDomEvent(doc, "selectionchange", () => this.handleReadingSelectionChange(doc));
    watchDocument(activeDocument);
    this.registerEvent(this.app.workspace.on("window-open", (win) => watchDocument(win.doc)));
  }

  private scheduleSelectionUpdate(update: () => void): void {
    window.clearTimeout(this.selectionDebounceTimer);
    this.selectionDebounceTimer = window.setTimeout(update, 500);
  }

  private handleReadingSelectionChange(doc: Document): void {
    const selection = doc.getSelection();
    const anchor = selection?.anchorNode;
    const focus = selection?.focusNode;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!anchor || !focus || !file || view.getMode() !== "preview") return;

    // Only rendered text inside the note is a note selection; a later chat
    // selection leaves the pending one attached. https://github.com/Brevilabs/obsidian-copilot-private/issues/597
    const readingEl = view.previewMode.containerEl;
    if (!readingEl.contains(anchor) || !readingEl.contains(focus)) return;

    const selectedText = selection.toString();
    this.scheduleSelectionUpdate(() => {
      const signature = `preview:${file.path}:${selectedText}`;
      if (signature === this.lastSelectionSignature) return;
      this.lastSelectionSignature = signature;

      if (!selectedText.trim()) {
        this.clearNoteSelectionContexts();
        return;
      }

      // Rendered Markdown does not expose reliable source line numbers for every selection.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/597
      this.setSelectionContext({
        id: uuidv4(),
        content: selectedText,
        sourceType: "note",
        noteTitle: file.basename,
        notePath: file.path,
        startLine: 0,
        endLine: 0,
      });
    });
  }

  private clearNoteSelectionContexts(): void {
    const currentContexts = getSelectedTextContexts();
    const nonNoteContexts = currentContexts.filter((ctx) => ctx.sourceType !== "note");
    if (currentContexts.length !== nonNoteContexts.length) {
      setSelectedTextContexts(nonNoteContexts);
    }
  }

  private clearSelectionContext() {
    setSelectedTextContexts([]);
  }

  private clearWebSelectionContextForUrl(url: string): void {
    const current = getSelectedTextContexts();
    const next = current.filter((c) => c.sourceType !== "web" || c.url !== url);
    if (next.length === current.length) {
      return;
    }
    setSelectedTextContexts(next);
  }

  private setSelectionContext(context: SelectedTextContext) {
    setSelectedTextContexts([context]);
  }

  handleSelectionChange({ editor, file }: MarkdownFileInfo) {
    const selectionRange = editor?.listSelections()[0];
    if (!editor || !selectionRange) {
      return;
    }

    const signature = file
      ? `${file.path}:${selectionRange.anchor.line}:${selectionRange.anchor.ch}:${selectionRange.head.line}:${selectionRange.head.ch}`
      : "";

    if (signature === this.lastSelectionSignature) {
      return;
    }
    this.lastSelectionSignature = signature;

    const selectedText = editor.getSelection();

    if (!selectedText || !selectedText.trim()) {
      this.clearNoteSelectionContexts();
      return;
    }

    if (!file) {
      return;
    }

    const anchorLine = selectionRange.anchor.line + 1;
    const headLine = selectionRange.head.line + 1;
    const startLine = Math.min(anchorLine, headLine);
    const endLine = Math.max(anchorLine, headLine);

    const selectedTextContext: NoteSelectedTextContext = {
      id: uuidv4(),
      content: selectedText,
      sourceType: "note",
      noteTitle: file.basename,
      notePath: file.path,
      startLine,
      endLine,
    };

    this.setSelectionContext(selectedTextContext);
  }

  initWebSelectionWatcher() {
    if (!isDesktopRuntime()) {
      return;
    }

    const webViewerService = getWebViewerService(this.app);

    this.webSelectionTracker = new WebSelectionTracker({
      intervalMs: 500,
      emptySelectionDebounceCount: 2,
      isEnabled: () => true,
      getLeaf: () => webViewerService.getActiveLeaf() ?? webViewerService.getLastActiveLeaf(),
      getActiveLeaf: () => webViewerService.getActiveLeaf(),
      onSelectionChange: (context) => {
        this.setSelectionContext(context);
      },
      onSelectionClear: ({ url }) => {
        this.clearWebSelectionContextForUrl(url);
      },
    });

    this.webSelectionTracker.start();
  }

  cleanupWebSelectionWatcher() {
    this.webSelectionTracker?.stop();
    this.webSelectionTracker = undefined;
  }

  suppressCurrentWebSelection(url?: string): void {
    if (url && url.trim()) {
      this.webSelectionTracker?.suppressSelectionForUrl(url);
      return;
    }

    this.webSelectionTracker?.suppressCurrentSelection();
  }

  private getCurrentEditorOrDummy(): Editor {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return {
      getSelection: () => {
        const selection = activeView?.editor?.getSelection();
        if (selection) return selection;
        const activeFile = this.app.workspace.getActiveFile();
        return activeFile ? this.app.vault.read(activeFile) : "";
      },
      replaceSelection: activeView?.editor?.replaceSelection.bind(activeView.editor) || (() => {}),
    } as Partial<Editor> as Editor;
  }

  processCustomPrompt(eventType: string, customPrompt: string) {
    const editor = this.getCurrentEditorOrDummy();
    void this.processText(editor, eventType, customPrompt, false);
  }

  toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    if (leaves.length > 0) {
      void this.deactivateView();
    } else {
      void this.activateView();
    }
  }

  async activateView(): Promise<void> {
    await this.openOrRevealView(CHAT_VIEWTYPE);
    window.setTimeout(() => {
      this.emitChatIsVisible();
    }, 50);
  }

  private pickContextChatViewType(): typeof CHAT_VIEWTYPE | typeof CHAT_AGENT_VIEWTYPE {
    const agentUsable = this.canUseAgentView();
    const agentOpen =
      agentUsable && this.app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE).length > 0;
    const legacyOpen = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE).length > 0;

    let useAgent: boolean;
    if (agentOpen && legacyOpen) {
      useAgent = this.lastActiveChatViewType === CHAT_AGENT_VIEWTYPE;
    } else if (agentOpen || legacyOpen) {
      useAgent = agentOpen;
    } else {
      useAgent = agentUsable;
    }
    return useAgent ? CHAT_AGENT_VIEWTYPE : CHAT_VIEWTYPE;
  }

  async activateChatViewForContext(): Promise<void> {
    if (this.pickContextChatViewType() === CHAT_AGENT_VIEWTYPE) {
      await this.activateAgentView();
    } else {
      await this.activateView();
    }
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
  }

  toggleAgentView() {
    if (!this.requireAgentView()) return;
    const leaves = this.app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE);
    if (leaves.length > 0) {
      void this.deactivateAgentView();
    } else {
      void this.activateAgentView();
    }
  }

  async activateAgentView(openInRightSidebar = false): Promise<WorkspaceLeaf | null> {
    if (!this.requireAgentView()) return null;
    const leaf = await this.openOrRevealView(CHAT_AGENT_VIEWTYPE, openInRightSidebar);
    const view = leaf?.view;
    if (this.isCopilotAgentView(view)) {
      view.eventTarget.queueVisible();
    }
    return leaf;
  }

  async addNoteToAgentChat(note: TFile, openInRightSidebar = false): Promise<void> {
    try {
      const leaf = await this.activateAgentView(openInRightSidebar);
      if (!leaf) return;
      await this.agentSessionManager?.addContextNoteToActiveChat(note);
    } catch (error) {
      logError("Failed to add a note to Agent Chat.", error);
      new Notice("Could not add the note to Agent Chat. Check Copilot logs.");
    }
  }

  async deactivateAgentView() {
    this.app.workspace.detachLeavesOfType(CHAT_AGENT_VIEWTYPE);
  }

  async activateRelevantNotesView(): Promise<WorkspaceLeaf | null> {
    return this.openOrRevealView(RELEVANT_NOTES_VIEWTYPE);
  }

  async addNoteToActiveChat(note: TFile): Promise<void> {
    // Agent Chat attaches the note as context; Quick Chat keeps the [[wikilink]] (https://github.com/Brevilabs/obsidian-copilot-private/issues/579).
    if (this.pickContextChatViewType() === CHAT_AGENT_VIEWTYPE) {
      await this.addNoteToAgentChat(note);
      return;
    }
    let leaf = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0] ?? null;
    if (!leaf) {
      await this.activateView();
      leaf = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0] ?? null;
    }
    if (!leaf) return;

    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof CopilotView) {
      leaf.view.eventTarget.queueInsertText(`[[${note.basename}]]`);
    }
  }

  async newAgentChat(): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    await this.activateAgentView();
    try {
      await manager.createSession();
    } catch (error) {
      logWarn("[CopilotPlugin] Failed to create agent session", error);
      new Notice("Failed to create agent session. Check Copilot logs.");
    }
  }

  async newAgentChatWithDraft(initialDraft: string): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    try {
      await manager.createGlobalSessionWithDraft(initialDraft);
      await this.activateAgentView();
    } catch (error) {
      logWarn("[CopilotPlugin] Failed to create agent session with draft", error);
      new Notice("Failed to create agent session. Check Copilot logs.");
    }
  }

  private async openOrRevealView(
    viewType: string,
    openInRightSidebar = false
  ): Promise<WorkspaceLeaf | null> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return leaves[0];
    }
    const leaf =
      openInRightSidebar || getSettings().defaultOpenArea === DEFAULT_OPEN_AREA.VIEW
        ? this.app.workspace.getRightLeaf(false)
        : this.app.workspace.getLeaf(true);
    if (!leaf) return null;
    await leaf.setViewState({ type: viewType, active: true });
    // A new right-sidebar leaf can exist while the sidebar remains collapsed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/579
    if (openInRightSidebar) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  private requireAgentView(): AgentSessionManager | null {
    if (!isDesktopRuntime()) {
      new Notice("Agent Chat is not available on mobile.");
      return null;
    }
    if (!this.agentSessionManager) {
      new Notice("Agent Chat is not initialized.");
      return null;
    }
    return this.agentSessionManager;
  }

  private canUseAgentView(): boolean {
    return !!this.agentSessionManager && isDesktopRuntime();
  }

  private isCopilotAgentView(
    view: unknown
  ): view is InstanceType<NonNullable<typeof this.CopilotAgentView>> {
    const AgentView = this.CopilotAgentView;
    return !!AgentView && view instanceof AgentView;
  }

  async loadSettings() {
    const rawData = (await this.loadData()) as unknown;
    // The keychain bootstrap may persist a sparse snapshot of the raw on-disk
    // data (vaultId backfill) before settings are hydrated. That snapshot is
    // already in dehydrated, on-disk shape, so it must bypass the
    // `dehydrateDeviceProfile` override below via `super.saveData` — routing it
    // through `this.saveData` would read the absent flat fields as "cleared"
    // and delete this device's `deviceProfiles` segment
    // (https://github.com/logancyang/obsidian-copilot/issues/2539).
    const settings = await loadSettingsWithKeychain(
      this.app,
      rawData,
      (d) => super.saveData(d),
      (raw) =>
        backupLegacyCredentials(raw, this.manifest.dir ?? "", {
          exists: (path) => this.app.vault.adapter.exists(path),
          write: (path, contents) => this.app.vault.adapter.write(path, contents),
          rename: (from, to) => this.app.vault.adapter.rename(from, to),
        }),
      (item) => this.startupMigrationItems.push(item)
    );
    setSettings(hydrateDeviceProfile(settings, getDeviceId(this.app)));
  }

  // Single choke point for persisted writes; the load-time keychain bootstrap bypasses it via
  // `super.saveData` (see `loadSettings`).
  // https://github.com/logancyang/obsidian-copilot/issues/2539
  async saveData(data: unknown): Promise<void> {
    return super.saveData(dehydrateDeviceProfile(data as CopilotSettings, getDeviceId(this.app)));
  }

  mergeActiveModels(
    existingActiveModels: CustomModel[],
    builtInModels: CustomModel[]
  ): CustomModel[] {
    const modelMap = new Map<string, CustomModel>();

    existingActiveModels.forEach((model) => {
      const key = getModelKeyFromModel(model);
      const existingModel = modelMap.get(key);
      if (existingModel) {
        modelMap.set(key, {
          ...model,
          isBuiltIn: existingModel.isBuiltIn || model.isBuiltIn,
        });
      } else {
        modelMap.set(key, model);
      }
    });

    return Array.from(modelMap.values());
  }

  async loadCopilotChatHistory() {
    const chatFiles = await this.getChatHistoryFiles();
    if (chatFiles.length === 0) {
      new Notice("No chat history found.");
      return;
    }
    new LoadChatHistoryModal(
      this.app,
      chatFiles,
      this.chatHistoryLastAccessedAtManager,
      (file) => void this.loadChatHistory(file)
    ).open();
  }

  async getChatHistoryFiles(): Promise<TFile[]> {
    const folderFiles = await listMarkdownFiles(this.app, getEffectiveConversationsFolder());
    if (folderFiles.length === 0) return [];

    return filterChatHistoryFiles(this.app, folderFiles);
  }

  async getChatHistoryItems(): Promise<ChatHistoryItem[]> {
    const files = await this.getChatHistoryFiles();
    return files.map((file) =>
      fileToHistoryItem(this.app, file, this.chatHistoryLastAccessedAtManager)
    );
  }

  private async touchChatHistoryLastAccessedAt(file: TFile): Promise<void> {
    try {
      this.chatHistoryLastAccessedAtManager.touch(file.path);

      const persistedLastAccessedAtMs = extractChatLastAccessedAtMs(this.app, file);
      const timestampToPersist = this.chatHistoryLastAccessedAtManager.shouldPersist(
        file.path,
        persistedLastAccessedAtMs
      );

      if (timestampToPersist === null) {
        return;
      }

      let persistedAtMs = timestampToPersist;

      if (
        this.app.fileManager?.processFrontMatter &&
        this.app.vault.getAbstractFileByPath(file.path) != null
      ) {
        await this.app.fileManager.processFrontMatter(
          file,
          (frontmatter: Record<string, unknown>) => {
            const existingValue = Number(frontmatter.lastAccessedAt);
            const existingAtMs =
              Number.isFinite(existingValue) && existingValue > 0 ? existingValue : 0;

            persistedAtMs = Math.max(existingAtMs, timestampToPersist);

            if (existingAtMs === persistedAtMs) {
              return;
            }

            frontmatter.lastAccessedAt = persistedAtMs;
          }
        );
      } else {
        await patchFrontmatter(this.app, file.path, { lastAccessedAt: persistedAtMs });
      }

      this.chatHistoryLastAccessedAtManager.markPersisted(file.path, persistedAtMs);
    } catch (error) {
      logWarn(`[CopilotPlugin] Failed to update chat lastAccessedAt for ${file.path}`, error);
    }
  }

  getChatHistoryLastAccessedAtManager(): RecentUsageManager<string> {
    return this.chatHistoryLastAccessedAtManager;
  }

  async loadChatHistory(file: TFile) {
    await this.autosaveCurrentChat();

    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (!existingView) {
      await this.activateView();
    }

    await this.chatUIState.loadChatHistory(file);

    void this.touchChatHistoryLastAccessedAt(file);

    const copilotView = (existingView || this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0])
      ?.view as CopilotView;
    if (copilotView) {
      copilotView.updateView();
    }
  }

  async loadChatById(fileId: string): Promise<void> {
    if (isNativeChatId(fileId)) {
      await this.loadNativeAgentChat(fileId);
      return;
    }
    const file = await resolveFileByPath(this.app, fileId);
    if (!file) throw new Error("Chat file not found.");

    const cachedMode = this.app.metadataCache.getFileCache(file)?.frontmatter?.mode;
    let mode = typeof cachedMode === "string" ? cachedMode : undefined;
    if (!mode) {
      try {
        const fm = await readFrontmatterViaAdapter(this.app, file.path);
        if (typeof fm?.mode === "string") mode = fm.mode;
      } catch {}
    }
    if (mode === AGENT_CHAT_MODE) {
      await this.loadAgentChatHistory(file);
      return;
    }
    await this.loadChatHistory(file);
  }

  async copyChatLink(chatId: string): Promise<void> {
    try {
      const id = isNativeChatId(chatId) ? chatId : await getSavedChatDeepLinkId(this.app, chatId);
      if (!id) {
        new Notice("Save this chat before copying a link.");
        return;
      }
      await navigator.clipboard.writeText(buildChatDeepLink(this.app.vault.getName(), id));
      new Notice("Chat link copied.");
    } catch (error) {
      logError("Failed to copy chat link", error);
      new Notice("Could not copy chat link.");
    }
  }

  async openChatDeepLink(params: Record<string, string>): Promise<void> {
    const id = params.id ?? "";
    try {
      const chatId = isNativeChatId(id) ? id : (await findChatFileByDeepLinkId(this.app, id))?.path;
      if (!chatId) {
        new Notice("Chat link not found.");
        return;
      }
      await this.loadChatById(chatId);
    } catch (error) {
      logError("Failed to open chat link", error);
      new Notice("Could not open chat link.");
    }
  }

  private async loadNativeAgentChat(chatId: string): Promise<void> {
    const ref = parseNativeChatId(chatId);
    if (!ref) throw new Error("Chat not found.");
    const manager = this.requireAgentView();
    if (!manager) return;
    const leaf = await this.activateAgentView();
    if (!leaf) return;

    await manager.loadNativeSessionFromHistory(ref.backendId, ref.sessionId);

    if (this.isCopilotAgentView(leaf.view)) {
      leaf.view.updateView();
    }
  }

  private async loadAgentChatHistory(file: TFile): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    const leaf = await this.activateAgentView();
    if (!leaf) return;

    await manager.loadSessionFromHistory(file);
    void this.touchChatHistoryLastAccessedAt(file);

    if (this.isCopilotAgentView(leaf.view)) {
      leaf.view.updateView();
    }
  }

  async openChatSourceFile(fileId: string): Promise<void> {
    if (isNativeChatId(fileId)) {
      new Notice(
        "This chat has no saved note. Turn on Autosave Chat as Markdown to save chats as notes in your vault."
      );
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    } else if (await this.app.vault.adapter.exists(fileId)) {
      new Notice(
        "Cannot open source files from hidden directories. To open chat notes in the editor, save them to a non-hidden folder in settings."
      );
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          frontmatter.topic = newTitle;
        }
      );

      await new Promise<void>((resolve) => {
        const handler = (updatedFile: TFile) => {
          if (updatedFile.path === fileId) {
            this.app.metadataCache.off("changed", handler);
            window.clearTimeout(timeoutId);
            resolve();
          }
        };

        this.app.metadataCache.on("changed", handler);

        const timeoutId = window.setTimeout(() => {
          this.app.metadataCache.off("changed", handler);
          resolve();
        }, 500);
      });

      new Notice("Chat title updated.");
    } else if (await resolveFileByPath(this.app, fileId)) {
      await patchFrontmatter(this.app, fileId, { topic: newTitle.trim() });
      new Notice("Chat title updated.");
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async deleteChatHistory(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await trashFile(this.app, file);
      new Notice("Chat deleted.");
    } else if (await this.app.vault.adapter.exists(fileId)) {
      await this.app.vault.adapter.remove(fileId);
      new Notice("Chat deleted.");
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async handleNewChat() {
    clearRecordedPromptPayload();
    await logFileManager.clear();

    if (getSettings().enableRecentConversations) {
      try {
        const chainManager = this.chainOwner.getCurrentChainManager();
        const chatModel = chainManager.chatModelManager.getChatModel();
        this.userMemoryManager.addRecentConversation(this.chatUIState.getMessages(), chatModel);
      } catch (error) {
        logInfo("Failed to analyze chat messages for memory:", error);
      }
    }

    await this.autosaveCurrentChat();

    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      const abortEvent = new CustomEvent(EVENT_NAMES.ABORT_STREAM, {
        detail: { reason: ABORT_REASON.NEW_CHAT },
      });
      copilotView.eventTarget.dispatchEvent(abortEvent);
    }

    this.chatUIState.clearMessages();

    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      copilotView.updateView();
    } else {
      await this.activateView();
    }
  }

  async newChat() {
    await this.handleNewChat();
  }
}
