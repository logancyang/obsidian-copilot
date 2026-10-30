import { startReleaseUpdateCheck } from "@/services/releaseUpdateNotice";
import { releaseCursorAssociation } from "@/editor/releaseCursorAssociation";
import { registerNoteHeaderAction } from "@/editor/registerNoteHeaderAction";
import type { AgentSessionManager, SkillManager } from "@/agentMode";
import { isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
import {
  buildChatDeepLink,
  buildChatMarkdownLink,
  findChatFileByDeepLinkId,
  getSavedChatDeepLinkId,
} from "@/utils/chatDeepLink";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import ChainOwner from "@/LLMProviders/chainOwner";
import { clearSelection, reportSelection, subscribeSelection } from "@/selection/selectionStore";
import { watchSelections } from "@/selection/selectionWatcher";
import { registerCommands } from "@/commands";
import CopilotView from "@/components/CopilotView";
import RelevantNotesView from "@/components/RelevantNotesView";
import { ApplyView } from "@/components/composer/ApplyView";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { CopilotFolderMigration } from "@/components/modals/CopilotFolderMigration";
import React from "react";
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
  APPLY_VIEW_TYPE,
  COPILOT_AGENT_ICON_SVG,
  DEFAULT_OPEN_AREA,
  DESKTOP_VIEW_TYPES,
  EVENT_NAMES,
  PLAN_PREVIEW_VIEW_TYPE,
  RELEVANT_NOTES_VIEWTYPE,
  SHARED_VIEW_TYPES,
  TURN_DIFF_VIEW_TYPE,
} from "@/constants";
import { ChatManager } from "@/core/ChatManager";
import { MessageRepository } from "@/core/MessageRepository";
import { logError, logFatalError, logInfo, logWarn } from "@/logger";
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
  getSettings,
  setSettings,
  subscribeToSettingsChange,
  updateSetting,
} from "@/settings/model";
import { ensureCopilotSubfolders, getEffectiveConversationsFolder } from "@/settings/copilotFolder";
import { revealHiddenCopilotFolder } from "@/settings/revealCopilotFolder";
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
  FileSystemAdapter,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  View,
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
  extractChatTitle,
  fileToHistoryItem,
  filterChatHistoryFiles,
} from "@/utils/chatHistoryUtils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { listMarkdownFiles, readFrontmatterViaAdapter, trashFile } from "@/utils/vaultAdapterUtils";
import { withTimeout } from "@/utils";
import { StartupLoadingView, type CopilotStartup } from "@/components/StartupLoadingView";
import { OpenArtifactsPublisher } from "@/openArtifacts/OpenArtifactsPublisher";
import { migrateOpenArtifactsFolder } from "@/openArtifacts/openArtifactsLedger";
import {
  createSelfHostWebSearchAgentBridge,
  type SelfHostWebSearchAgentBridge,
} from "@/LLMProviders/selfHostServices";

const PENDING_TEARDOWN = Symbol.for("obsidian-copilot:pending-teardown");
const PREVIOUS_TEARDOWN_TIMEOUT_MS = 10_000;

interface TeardownHandoff {
  [PENDING_TEARDOWN]?: Promise<void>;
}

export default class CopilotPlugin extends Plugin implements CopilotStartup {
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
  openArtifactsPublisher!: OpenArtifactsPublisher;
  skills?: SkillManager;
  private CopilotAgentView?: typeof import("@/agentMode").CopilotAgentView;
  private PlanPreviewView?: typeof import("@/agentMode").PlanPreviewView;
  private TurnDiffView?: typeof import("@/agentMode").TurnDiffView;
  private agentModelDiscoveryUnsubscriber?: () => void;
  modelManagement!: ModelManagementApi;
  selfHostWebSearchAgentBridge?: Readonly<SelfHostWebSearchAgentBridge>;
  private ribbonIconEl?: HTMLElement;
  userMemoryManager: UserMemoryManager;
  quickAskController: QuickAskController;
  chatSelectionHighlightController: ChatSelectionHighlightController;
  private lastActiveChatViewType: typeof CHAT_VIEWTYPE | typeof CHAT_AGENT_VIEWTYPE = CHAT_VIEWTYPE;
  private webSelectionTracker?: WebSelectionTracker;
  private readonly chatHistoryLastAccessedAtManager = new RecentUsageManager<string>();
  private startupMigrationItems: StartupMigrationItem[] = [];
  private loadedCopilotFolder: unknown;
  private pluginLifecycleActive = true;
  private initialization: Promise<void> = Promise.resolve();
  private readonly startedViewCreators = new Map<string, ViewCreator>();

  public isPluginLifecycleActive(): boolean {
    return this.pluginLifecycleActive;
  }

  whenStarted(): Promise<void> {
    return this.initialization;
  }

  isStarted(): boolean {
    return this.pluginLifecycleActive && this.startedViewCreators.size > 0;
  }

  createStartedView(viewType: string, leaf: WorkspaceLeaf): View | undefined {
    if (!this.pluginLifecycleActive) return undefined;
    return this.startedViewCreators.get(viewType)?.(leaf);
  }

  // Obsidian awaits onload before opening the vault and never waits for it before unloading, so
  // startup work runs in the background and registers what needs loaded settings only after its
  // last await. https://github.com/logancyang/obsidian-copilot/issues/3518
  onload(): void {
    this.brevilabsClient = BrevilabsClient.getInstance();
    this.brevilabsClient.setPluginVersion(this.manifest.version);
    installRendererEventsShim();
    this.initialization = this.initialize().catch((error) => {
      // logError prints only when the debug setting is on, which a failed settings load never
      // reads, and this catch keeps Obsidian from logging the failure itself.
      // https://github.com/logancyang/obsidian-copilot/issues/3518
      logFatalError("Copilot failed to start.", error);
      new Notice("Copilot failed to start. Check the Copilot log for details.");
      // Obsidian keeps a plugin enabled when work after onload fails, so release whatever
      // startup registered before the failure. https://github.com/logancyang/obsidian-copilot/issues/3518
      this.unload();
    });
    // Restored tabs and the settings tab exist from the start so they show startup progress
    // instead of disappearing. https://github.com/logancyang/obsidian-copilot/issues/3518
    const viewTypes = isDesktopRuntime() ? DESKTOP_VIEW_TYPES : SHARED_VIEW_TYPES;
    for (const viewType of viewTypes) {
      this.safeRegisterView(
        viewType,
        (leaf: WorkspaceLeaf) =>
          this.createStartedView(viewType, leaf) ?? new StartupLoadingView(leaf, viewType, this)
      );
    }
    this.addSettingTab(new CopilotSettingTab(this.app, this));
    // Obsidian dispatches the URI that launched it once its layout loads, which can precede
    // initialization, so the handler exists from the start and waits for the chat managers.
    // https://github.com/logancyang/obsidian-copilot/issues/3271
    this.registerObsidianProtocolHandler("copilot-chat", (params) => {
      void this.initialization.then(() => {
        if (this.pluginLifecycleActive) void this.openChatDeepLink(params);
      });
    });
  }

  private async initialize(): Promise<void> {
    await this.waitForPreviousTeardown();
    if (!this.pluginLifecycleActive) return;
    resetPersistenceState();
    KeychainService.resetInstance();
    KeychainService.getInstance(this.app);
    await this.loadSettings();
    if (!this.pluginLifecycleActive) return;
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
          new Notice("Copilot failed to save settings. Check the Copilot log, then try again.");
        }
        if (plusSyncNeeded(prev, next)) {
          syncPlus(next.isPaidUser, next.plusLicenseKey);
        }
      })();
    });
    await runSettingsMigrations(this.modelManagement);
    const folderMigration = await revealHiddenCopilotFolder(
      this.app.vault,
      this.loadedCopilotFolder,
      getSettings().copilotFolder
    );
    // The dialog tells the user what to move by hand, so the visible root is saved even when the move failed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/712
    if (folderMigration) {
      setSettings({ copilotFolder: getSettings().copilotFolder });
      this.app.workspace.onLayoutReady(() => {
        new ConfirmModal(
          this.app,
          () => {},
          React.createElement(CopilotFolderMigration, { migration: folderMigration }),
          "Copilot folder migration",
          "OK",
          ""
        ).open();
      });
    }
    const agentMode = isDesktopRuntime()
      ? await Promise.all([import("@/agentMode"), import("@/agentMode/agentModelDiscovery")])
      : null;
    // Awaited so no publish can create .openartifacts before the old folder moves; a
    // destination that already exists would strand the legacy history for good.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/337
    try {
      await migrateOpenArtifactsFolder(this.app.vault);
    } catch (error) {
      logError("Failed to move the Symposium publishing folder to .openartifacts.", error);
    }
    if (!this.pluginLifecycleActive) return;

    this.register(
      startReleaseUpdateCheck(
        this.app,
        this.manifest.version,
        getSettings().lastShownStartupVersion,
        (version) => updateSetting("lastShownStartupVersion", version)
      )
    );
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
    initializeBuiltinTools(this.app);

    ContextProcessor.getInstance(this.app);
    CustomCommandManager.getInstance(this.app);
    logFileManager.setApp(this.app);

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

    const openArtifactsPublisher = new OpenArtifactsPublisher(this.app);
    this.openArtifactsPublisher = openArtifactsPublisher;
    this.register(() => openArtifactsPublisher.dispose());

    if (agentMode) {
      const [
        {
          CopilotAgentView,
          PlanPreviewView,
          TurnDiffView,
          closeRestoredTurnDiffs,
          registerTurnDiffCommands,
          acpFrameSink,
          createAgentSessionManager,
          setFrameSinkVaultBasePath,
          SkillManager,
        },
        { wireAgentModelDiscovery },
      ] = agentMode;
      this.CopilotAgentView = CopilotAgentView;
      this.PlanPreviewView = PlanPreviewView;
      this.TurnDiffView = TurnDiffView;
      closeRestoredTurnDiffs(this.app.workspace);
      registerTurnDiffCommands(this);

      const adapter = this.app.vault.adapter;
      setFrameSinkVaultBasePath(
        adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null
      );
      // A log left permissive by an older build is only reachable here when
      // frame logging is off. https://github.com/logancyang/obsidian-copilot-preview/issues/250
      void acpFrameSink.narrowLegacyLogs();

      this.agentSessionManager = createAgentSessionManager(this.app, this);
      this.skills = SkillManager.getInstance();
      this.agentModelDiscoveryUnsubscriber = wireAgentModelDiscovery(
        this,
        this.agentSessionManager
      );
    }

    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.initialize(this.app);

    this.fileParserManager = new FileParserManager();

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
    this.register(
      subscribeSelection((contexts) =>
        this.chatSelectionHighlightController.clearIfNoNoteContexts(contexts)
      )
    );

    if (isDesktopRuntime()) {
      const { activeLeafRef, layoutRef } = startActiveWebTabTracking(this.app, {
        preserveOnViewTypes: [CHAT_VIEWTYPE, CHAT_AGENT_VIEWTYPE],
      });
      this.registerEvent(activeLeafRef);
      this.registerEvent(layoutRef);
    }

    addIcon(COPILOT_AGENT_ICON_ID, COPILOT_AGENT_ICON_SVG);

    if (isDesktopRuntime()) registerNoteHeaderAction(this);

    this.startedViewCreators.set(CHAT_VIEWTYPE, (leaf) => new CopilotView(leaf, this));
    this.startedViewCreators.set(APPLY_VIEW_TYPE, (leaf) => new ApplyView(leaf));
    this.startedViewCreators.set(
      RELEVANT_NOTES_VIEWTYPE,
      (leaf) => new RelevantNotesView(leaf, this)
    );
    if (this.CopilotAgentView && this.PlanPreviewView && this.TurnDiffView) {
      const AgentView = this.CopilotAgentView;
      const PreviewView = this.PlanPreviewView;
      const DiffView = this.TurnDiffView;
      this.startedViewCreators.set(CHAT_AGENT_VIEWTYPE, (leaf) => new AgentView(leaf, this));
      this.startedViewCreators.set(PLAN_PREVIEW_VIEW_TYPE, (leaf) => new PreviewView(leaf));
      this.startedViewCreators.set(TURN_DIFF_VIEW_TYPE, (leaf) => new DiffView(leaf));
    }

    this.initActiveLeafChangeHandler();

    const agentReady = this.canUseAgentView();
    this.ribbonIconEl = this.addRibbonIcon(
      agentReady ? COPILOT_AGENT_ICON_ID : "message-square",
      agentReady ? "Open Copilot Agent Chat" : "Open Copilot Chat",
      () => (this.canUseAgentView() ? this.activateAgentView() : this.activateView())
    );

    const publishFile = (file: TFile): void => {
      void openArtifactsPublisher
        .open(file)
        .catch((error) => logError("Failed to open OpenArtifacts publishing.", error));
    };
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
    this.systemPromptRegister = new SystemPromptRegister(this.app);
    this.projectRegister = new ProjectRegister(this.app);

    this.app.workspace.onLayoutReady(() => {
      void this.runStartupMigrations(isLegacyUpgrade).catch((error) => {
        logError("Failed to finish startup migrations", error);
        new Notice("Copilot could not finish startup migration. Reload Obsidian to retry.");
      });
    });

    this.initSelectionHandler();

    this.initWebSelectionWatcher();
  }

  // A disabled or updated copy may still be writing data.json or stopping Agent Mode backends;
  // a hung shutdown must not keep this copy, or any later one, from starting.
  // https://github.com/logancyang/obsidian-copilot/issues/3518
  private async waitForPreviousTeardown(): Promise<void> {
    const handoff = window as TeardownHandoff;
    const previousTeardown = handoff[PENDING_TEARDOWN];
    if (!previousTeardown) return;
    try {
      await withTimeout(
        () => previousTeardown,
        PREVIOUS_TEARDOWN_TIMEOUT_MS,
        "Previous Copilot shutdown"
      );
    } catch (error) {
      logWarn("Copilot started before its previous copy finished shutting down.", error);
    }
    if (handoff[PENDING_TEARDOWN] === previousTeardown) delete handoff[PENDING_TEARDOWN];
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
      this.customCommandRegister
        .initialize()
        .then(() => this.runUnlessUnloaded(() => migrateCommands(this.app))),
      {
        id: "custom-commands",
        title: "Custom commands",
        status: "error",
        summary: "Custom commands could not be loaded or migrated. Reload Obsidian to retry.",
      }
    );
    const promptsTask = task(
      this.systemPromptRegister
        .initialize()
        .then(() => this.runUnlessUnloaded(() => migrateSystemPromptsFromSettings(this.app))),
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

  // Startup migrations outlive an unload, and a legacy migration finishing in the unloaded copy
  // would write the same files and settings as its successor's.
  // https://github.com/logancyang/obsidian-copilot/issues/3518
  private async runUnlessUnloaded(
    migrate: () => Promise<StartupMigrationItem | null>
  ): Promise<StartupMigrationItem | null> {
    return this.pluginLifecycleActive ? migrate() : null;
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
    const handoff = window as TeardownHandoff;
    const teardown = this.teardown().catch((error) => {
      logError("Copilot: plugin teardown failed during unload:", error);
    });
    // A copy unloaded mid-startup tears down instantly while its own settings load, and its
    // startup still waits on any older copy's shutdown, so the handoff covers both.
    // https://github.com/logancyang/obsidian-copilot/issues/3518
    handoff[PENDING_TEARDOWN] = Promise.all([this.initialization, teardown]).then(() => undefined);
  }

  private async teardown(): Promise<void> {
    this.clearAllPersistentSelectionHighlights();

    this.chatSelectionHighlightController?.cleanup();

    this.agentModelDiscoveryUnsubscriber?.();
    await this.agentSessionManager?.shutdown();

    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.cleanup();

    this.customCommandRegister?.cleanup();
    this.systemPromptRegister?.cleanup();
    this.projectRegister?.cleanup();
    // The handoff releases the next copy once teardown resolves, so the drain must come after
    // the last settings change can queue a write. https://github.com/logancyang/obsidian-copilot/issues/3518
    this.settingsUnsubscriber?.();
    await flushPersistence();

    if (isDesktopRuntime()) {
      const { SkillManager } = await import("@/agentMode");
      if (SkillManager.hasInstance()) {
        SkillManager.getInstance().dispose();
      }
    }

    this.cleanupWebSelectionWatcher();
    clearSelection();

    try {
      const webViewerService = getWebViewerService(this.app);
      webViewerService.stopActiveWebTabTracking();
    } catch (error) {
      logWarn("Could not stop web tab tracking", error);
    }

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
    watchSelections(this);
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
        reportSelection({
          location: context.url,
          key: `web:${context.url}:${context.content}`,
          context,
        });
      },
      onSelectionClear: ({ url }) => {
        reportSelection({ location: url, key: `web:${url}`, context: null });
      },
    });

    this.webSelectionTracker.start();
  }

  cleanupWebSelectionWatcher() {
    this.webSelectionTracker?.stop();
    this.webSelectionTracker = undefined;
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
      new Notice("Could not add the note to Agent Chat. Check the Copilot log.");
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
      new Notice("Failed to start a new chat. Check the Copilot log.");
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
      new Notice("Failed to start a new chat. Check the Copilot log.");
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
    this.loadedCopilotFolder = (rawData as { copilotFolder?: unknown } | null)?.copilotFolder;
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
    const folderFiles = listMarkdownFiles(this.app, getEffectiveConversationsFolder());
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
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (!(file instanceof TFile)) throw new Error("Chat file not found.");

    const cachedMode = this.app.metadataCache.getFileCache(file)?.frontmatter?.mode;
    let mode = typeof cachedMode === "string" ? cachedMode : undefined;
    if (!mode) {
      try {
        const fm = await readFrontmatterViaAdapter(this.app, file.path);
        if (typeof fm?.mode === "string") mode = fm.mode;
      } catch (error) {
        logWarn("Could not read the chat mode from frontmatter", error);
      }
    }
    if (mode === AGENT_CHAT_MODE) {
      await this.loadAgentChatHistory(file);
      return;
    }
    await this.loadChatHistory(file);
  }

  async copyChatLink(resolveNotePath: () => Promise<string>): Promise<void> {
    try {
      const path = await resolveNotePath();
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      const id = file instanceof TFile ? await getSavedChatDeepLinkId(this.app, file.path) : null;
      if (!(file instanceof TFile) || !id) throw new Error(`No saved chat note to link: "${path}"`);
      const url = buildChatDeepLink(this.app.vault.getName(), id);
      await navigator.clipboard.writeText(
        buildChatMarkdownLink(extractChatTitle(this.app, file), url)
      );
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
        "This chat has no saved note. Turn on Autosave chats as Markdown to save chats as notes in your vault."
      );
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
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
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async deleteChatHistory(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await trashFile(this.app, file);
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
