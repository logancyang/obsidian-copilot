import type { AgentSessionManager, SkillManager } from "@/agentMode";
// Deep import (not the barrel): these run on the load path for every
// platform, and the barrel pulls Node-only modules that crash mobile.
import { isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
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
import { syncMiyoSystemExclusions } from "@/miyo/miyoSystemExclusions";
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
  FileSystemAdapter,
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
import {
  createOpenArtifactsAgentBridge,
  type OpenArtifactsAgentBridge,
  OpenArtifactsPublisher,
} from "@/openArtifacts/OpenArtifactsPublisher";
import { OPENARTIFACTS_AGENT_BRIDGE_PROPERTY } from "@/openArtifacts/constants";
import { migrateOpenArtifactsFolder } from "@/openArtifacts/openArtifactsLedger";
import {
  createSelfHostWebSearchAgentBridge,
  type SelfHostWebSearchAgentBridge,
} from "@/LLMProviders/selfHostServices";

// Removed unused FileTrackingState interface

export default class CopilotPlugin extends Plugin {
  // Plugin components
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
  skills?: SkillManager;
  private CopilotAgentView?: typeof import("@/agentMode").CopilotAgentView;
  private PlanPreviewView?: typeof import("@/agentMode").PlanPreviewView;
  private planPreviewViewType?: typeof import("@/agentMode").PLAN_PREVIEW_VIEW_TYPE;
  private agentModelDiscoveryUnsubscriber?: () => void;
  modelManagement!: ModelManagementApi;
  /**
   * Frozen path-only facade available to Agent Mode's Obsidian CLI bridge. The seeded skill
   * scripts reach it by this property name.
   */
  [OPENARTIFACTS_AGENT_BRIDGE_PROPERTY]?: Readonly<OpenArtifactsAgentBridge>;
  /** Provider-credential-free channel available to the managed Agent Chat search skill. */
  selfHostWebSearchAgentBridge?: Readonly<SelfHostWebSearchAgentBridge>;
  private ribbonIconEl?: HTMLElement;
  userMemoryManager: UserMemoryManager;
  quickAskController: QuickAskController;
  chatSelectionHighlightController: ChatSelectionHighlightController;
  // Most-recently-focused chat view, used to route "add … to chat context"
  // commands when both chat views are open. Defaults to legacy so a
  // never-focused-a-chat state is harmless.
  private lastActiveChatViewType: typeof CHAT_VIEWTYPE | typeof CHAT_AGENT_VIEWTYPE = CHAT_VIEWTYPE;
  private selectionDebounceTimer?: number;
  private selectionChangeHandler?: () => void;
  private selectionListenerDocument?: Document;
  private lastSelectionSignature?: string;
  private webSelectionTracker?: WebSelectionTracker;
  private readonly chatHistoryLastAccessedAtManager = new RecentUsageManager<string>();
  private startupMigrationItems: StartupMigrationItem[] = [];

  async onload(): Promise<void> {
    // Patch Node's `events.setMaxListeners` so the Claude Agent SDK's call with
    // a web-realm AbortSignal stops throwing in Electron's renderer. No-ops on
    // mobile (no node:events / no SDK). Must run before any Agent Mode session;
    // doing it here (not as a module-load side effect) keeps mobile from
    // evaluating `node:events` at import and crashing the whole plugin.
    installRendererEventsShim();
    // Reason: clear stale module-level persistence state + KeychainService
    // singleton left over from a previous plugin lifecycle in the same
    // process (disable→enable, dev hot reload, "Open another vault" without
    // restart). Doing this at the START of onload (instead of at the end of
    // onunload) avoids a race: onunload is fire-and-forget from Obsidian's
    // perspective, so its `await flushPersistence()` continuation can fire
    // AFTER the next onload has already initialized — and would then null
    // out the new instance, breaking saves until another full reload.
    resetPersistenceState();
    KeychainService.resetInstance();
    KeychainService.getInstance(this.app);
    await this.loadSettings();
    this.modelManagement = createModelManagement({
      app: this.app,
    });
    // Register/unregister the Copilot Plus provider (and its models) to match
    // Plus state, so Plus models surface in the chat + opencode pickers. The
    // license key is already hydrated from Keychain by the settings boundary.
    // Idempotent, so the redundant initial call below + per-change calls are
    // safe. Serialized through `plusSyncChain` so a fast
    // sign-out→sign-in (each its own settings change) settles in issue order,
    // not in whichever overlapping reconcile happens to finish last.
    let plusSyncChain: Promise<void> = Promise.resolve();
    const syncPlus = (isPaidUser: boolean | undefined, licenseKey: string): void => {
      plusSyncChain = plusSyncChain.then(() =>
        syncCopilotPlusProvider(this.modelManagement, !!isPaidUser, licenseKey)
      );
    };
    // Initial reconcile: an already-signed-in user's `isPaidUser` is restored
    // from disk without firing the subscription, so register on load.
    syncPlus(getSettings().isPaidUser, getSettings().plusLicenseKey);
    this.settingsUnsubscriber = subscribeToSettingsChange((prev, next) => {
      void (async () => {
        try {
          await persistSettings(next, (data) => this.saveData(data), prev);
        } catch (error) {
          // Reason: Do NOT rollback memory state on persist failure.
          // The writeQueue serializes I/O, so a later setSettings() may already
          // be queued. Rolling back memory would create a split where memory is S0
          // but disk ends up at S2 when the later write succeeds.
          // Instead, just notify the user — the in-memory state remains current,
          // and the next successful persist will reconcile disk with memory.
          logError("Failed to persist settings.", error);
          new Notice("Copilot failed to save settings. Check logs and try again.");
        }
        // Sign-in / sign-out (isPaidUser flip) or key rotation while signed in.
        if (plusSyncNeeded(prev, next)) {
          syncPlus(next.isPaidUser, next.plusLicenseKey);
        }
      })();
    });
    // One-time settings migrations. Runs after the persist subscriber is wired
    // (so every mutation is saved) and after createModelManagement, and before
    // agent/model-discovery init below — so migrated BYOK providers are present
    // when OpenCode first enumerates models. Awaited for deterministic ordering;
    // it's a fast, one-time, no-op for already-migrated/fresh vaults.
    await runSettingsMigrations(this.modelManagement);
    // A synced root history can advance while this device is offline. Retry the
    // monotonic Miyo exclusion merge on every enabled load; it is a no-op when
    // already current, and it never replaces Miyo-owned rules.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/284
    const migratedSettings = getSettings();
    if (migratedSettings.enableMiyo) {
      void syncMiyoSystemExclusions(this.app, migratedSettings).catch((error) => {
        logWarn("Failed to sync Miyo system exclusions during startup.", error);
      });
    }
    // Remnants of the retired index pipeline live on this device, not in the
    // synced settings, so they are gated by a device-local marker instead of
    // `settingsVersion`. Not awaited: nothing below reads its result.
    // https://github.com/logancyang/obsidian-copilot/pull/3094#discussion_r3926692787
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

    // Core plugin initialization

    // Initialize built-in tools with app access
    initializeBuiltinTools(this.app);

    // Seed the ContextProcessor singleton with `app` before anything reaches
    // for it via the no-arg getInstance().
    ContextProcessor.getInstance(this.app);
    CustomCommandManager.getInstance(this.app);
    logFileManager.setApp(this.app);

    // Initialize BrevilabsClient
    this.brevilabsClient = BrevilabsClient.getInstance();
    this.brevilabsClient.setPluginVersion(this.manifest.version);
    // Re-verify the cached entitlement token offline so the strict Plus and
    // self-host gates fail closed against an edited data.json until the
    // signature re-proves itself. The network re-validation below overrides
    // with the server's token.
    void verifyCachedEntitlement();
    if (!isLegacyUpgrade) void checkIsPaidUser(this.app, { trigger: "startup" });
    // Entitlement tokens expire (~14 days), and the gates honor that expiry even
    // mid-session. Without a refresh, an Obsidian window left open past `exp`
    // loses self-host — which silently reroutes web search and document parsing
    // through the cloud — despite the user being online and still entitled.
    // Each /license call mints a fresh token, so re-validating daily keeps an
    // online session current; offline users still lapse at `exp`, as intended.
    this.registerInterval(
      window.setInterval(
        () => void checkIsPaidUser(this.app, { trigger: "refresh" }),
        ENTITLEMENT_REFRESH_INTERVAL_MS
      )
    );

    // Initialize the owner of the shared Quick Chat chain
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

    // Initialize Agent Mode coordinator (desktop only — ACP needs subprocess
    // support). Gate on `isDesktopRuntime()`, not `Platform.isDesktopApp`:
    // under `app.emulateMobile(true)` the latter stays true while Node is stubbed,
    // so importing the `@/agentMode` barrel there would crash the plugin at load.
    if (isDesktopRuntime()) {
      const {
        CopilotAgentView,
        PlanPreviewView,
        PLAN_PREVIEW_VIEW_TYPE,
        acpFrameSink,
        createAgentSessionManager,
        setFrameSinkVaultBasePath,
        SkillManager,
      } = await import("@/agentMode");
      const { wireAgentModelDiscovery } = await import("@/agentMode/agentModelDiscovery");
      this.CopilotAgentView = CopilotAgentView;
      this.PlanPreviewView = PlanPreviewView;
      this.planPreviewViewType = PLAN_PREVIEW_VIEW_TYPE;

      // Seed the frame-log sink with the vault base path (desktop FileSystemAdapter only).
      const adapter = this.app.vault.adapter;
      setFrameSinkVaultBasePath(
        adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null
      );
      // A log left permissive by an older build is only reachable here when
      // frame logging is switched off, because nothing else would read it
      // again. https://github.com/logancyang/obsidian-copilot-preview/issues/250
      void acpFrameSink.narrowLegacyLogs();

      this.agentSessionManager = createAgentSessionManager(this.app, this);
      this.skills = SkillManager.getInstance();
      // Enroll agent-reported models on probe settle, even when the settings
      // tab is closed. See `agentModelDiscovery.ts`.
      this.agentModelDiscoveryUnsubscriber = wireAgentModelDiscovery(
        this,
        this.agentSessionManager
      );
    }

    // Initialize VaultDataManager for centralized vault data (notes, folders, tags)
    // Note: VaultDataManager tracks ALL data; hooks filter based on parameters
    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.initialize(this.app);

    // Initialize FileParserManager early with other core services
    this.fileParserManager = new FileParserManager(this.brevilabsClient, this.app.vault);

    // Initialize ChatUIState with new architecture
    const messageRepo = new MessageRepository();
    const chainManager = this.chainOwner.getCurrentChainManager();
    const chatManager = new ChatManager(messageRepo, chainManager, this.fileParserManager, this);
    this.chatUIState = new ChatManagerChatUIState(chatManager);

    // Initialize UserMemoryManager
    this.userMemoryManager = new UserMemoryManager(this.app);

    // Initialize QuickAskController and register CM6 extension
    this.quickAskController = new QuickAskController(this);
    this.registerEditorExtension(this.quickAskController.createExtension());

    // Initialize Chat selection highlight controller
    this.chatSelectionHighlightController = new ChatSelectionHighlightController(this, {
      closeQuickAskOnChatFocus: false,
    });
    this.chatSelectionHighlightController.initialize();

    // Single source of truth for Active Web Tab ({activeWebTab}) state
    // Preserves activeWebTab when switching to Chat view
    // Only run on desktop - Web Viewer is not available on mobile
    if (isDesktopRuntime()) {
      const { activeLeafRef, layoutRef } = startActiveWebTabTracking(this.app, {
        preserveOnViewTypes: [CHAT_VIEWTYPE],
      });
      this.registerEvent(activeLeafRef);
      this.registerEvent(layoutRef);
    }

    // Register the custom Agent Mode icon before any view/ribbon/command references it.
    addIcon(COPILOT_AGENT_ICON_ID, COPILOT_AGENT_ICON_SVG);

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
    const openArtifactsAgentBridge = createOpenArtifactsAgentBridge(openArtifactsPublisher);
    this[OPENARTIFACTS_AGENT_BRIDGE_PROPERTY] = openArtifactsAgentBridge;
    const publishFile = (file: TFile): void => {
      void openArtifactsPublisher
        .open(file)
        .catch((error) => logError("Failed to open OpenArtifacts publishing.", error));
    };
    this.register(() => {
      openArtifactsPublisher.dispose();
      if (this[OPENARTIFACTS_AGENT_BRIDGE_PROPERTY] === openArtifactsAgentBridge) {
        this[OPENARTIFACTS_AGENT_BRIDGE_PROPERTY] = undefined;
      }
    });
    registerCommands(this, publishFile);

    // Tool initialization is now handled automatically in CopilotPlusChainRunner and AutonomousAgentChainRunner

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu) => {
        registerContextMenu(menu, this.app);
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        // Delegate to chat selection highlight controller
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
      // Migration sources initialize independently, but presentation waits until
      // all of them settle so an upgrade produces one complete summary.
      void this.runStartupMigrations(isLegacyUpgrade).catch((error) => {
        logError("Failed to finish startup migrations", error);
        new Notice("Copilot could not finish startup migration. Reload Obsidian to retry.");
      });
    });

    // Initialize automatic selection handler
    this.initSelectionHandler();

    // Initialize web selection watcher (Desktop only)
    this.initWebSelectionWatcher();
  }

  /** Collect one-time manual folder moves without opening a separate modal. */
  private async collectLegacyUpgradeRelocation(): Promise<StartupMigrationItem | null> {
    if (!getSettings().upgradedToV8FromLegacy) return null;

    const entries = buildUpgradeRelocationEntries(getSettings());
    if (entries.length > 0) {
      // Pre-create destinations, while leaving user files untouched as before.
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

  /** Run all layout-dependent migration work before presenting one summary. */
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

  /**
   * Register a view, tolerating a type that is already registered. Obsidian
   * throws "Attempting to register an existing view type" when a prior plugin
   * lifecycle left a stale registration behind (e.g. an `onunload` that threw
   * before its teardown completed). Swallowing here keeps one stale view type
   * from aborting the rest of `onload` and leaving a half-initialized plugin
   * that then crashes on `onunload`. The null-safe `onunload` below is the
   * primary fix that prevents the stale state; this is defense-in-depth.
   */
  private safeRegisterView(type: string, viewCreator: ViewCreator): void {
    try {
      this.registerView(type, viewCreator);
    } catch (error) {
      logWarn(`Copilot: view type "${type}" already registered; skipping re-registration.`, error);
    }
  }

  onunload(): void {
    // Obsidian never awaits onunload, so the async tail of teardown is
    // fire-and-forget by nature; declaring onunload void makes that explicit.
    // teardown() is invoked synchronously, so everything above its first
    // `await` still runs before this call returns, and a failure partway
    // through is logged instead of becoming an unhandled rejection.
    // The audio module is shared across hot-reloaded plugin instances, so an
    // outgoing async teardown must release its context before a successor can
    // create one. https://github.com/logancyang/obsidian-copilot/issues/2987
    disposeNotificationSound();
    this.teardown().catch((error) => {
      logError("Copilot: plugin teardown failed during unload:", error);
    });
  }

  private async teardown(): Promise<void> {
    // Best-effort flush of pending keychain/data.json writes.
    // Reason: Obsidian does not await teardown, but awaiting here keeps the
    // remaining steps ordered after the flush, consistent with the log flush
    // below. (The KeychainService singleton and the persistence module's own
    // state reset at the START of the next onload — see the comment there for
    // the late-write race that motivated it.)
    await flushPersistence();

    // Clear all persistent selection highlights before unload
    // This prevents "stuck" highlights after hot reload (dev environment)
    this.clearAllPersistentSelectionHighlights();

    // Cleanup chat selection highlight controller
    this.chatSelectionHighlightController?.cleanup();

    this.agentModelDiscoveryUnsubscriber?.();
    await this.agentSessionManager?.shutdown();

    // Cleanup VaultDataManager event listeners
    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.cleanup();

    // Optional-chained because `onload` assigns these late: if it threw before
    // reaching their construction, the fields are undefined at unload time and
    // an unguarded `.cleanup()` would throw `Cannot read properties of
    // undefined`, aborting the rest of teardown.
    this.customCommandRegister?.cleanup();
    this.systemPromptRegister?.cleanup();
    this.projectRegister?.cleanup();
    this.settingsUnsubscriber?.();

    // Tear down skills vault watchers + debounce timers. Gate matches onload so
    // we never import the `@/agentMode` barrel on a Node-less runtime (mobile /
    // emulateMobile), which would crash during unload.
    if (isDesktopRuntime()) {
      const { SkillManager } = await import("@/agentMode");
      if (SkillManager.hasInstance()) {
        SkillManager.getInstance().dispose();
      }
    }

    // Cleanup selection handler
    this.cleanupSelectionHandler();
    this.cleanupWebSelectionWatcher();
    this.clearSelectionContext();

    // Cleanup Web Viewer state tracking (webview event listeners)
    try {
      const webViewerService = getWebViewerService(this.app);
      webViewerService.stopActiveWebTabTracking();
    } catch {
      // Ignore errors if service not available
    }

    this.modelManagement?.dispose();

    // Best-effort flush of log file
    await logFileManager.flush();
    logInfo("Copilot plugin unloaded");
  }

  /**
   * Clear all persistent selection highlights across all Markdown editors.
   * Called during plugin unload to prevent "stuck" highlights after hot reload.
   */
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

    // Without the timeout, the view is not yet active
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
    // Both chat views expose a `ChatViewEventTarget`; the React tree focuses the
    // composer in response (CopilotView via Chat.tsx, CopilotAgentView via
    // useChatInputAutoFocus). The instanceof guard skips deferred (unloaded)
    // leaves, whose placeholder view has no eventTarget.
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

  /**
   * Initialize automatic text selection handler
   * Listens to selectionchange events and automatically adds selected text to chat context
   */
  initSelectionHandler() {
    this.selectionChangeHandler = () => {
      // Clear existing debounce timer
      if (this.selectionDebounceTimer) {
        window.clearTimeout(this.selectionDebounceTimer);
      }

      // Debounce selection changes to avoid excessive triggers
      this.selectionDebounceTimer = window.setTimeout(() => {
        this.handleSelectionChange();
      }, 500);
    };

    // Capture the document at registration so removal targets the same one
    // (activeDocument can change if the user focuses a popout window).
    this.selectionListenerDocument = activeDocument;
    this.selectionListenerDocument.addEventListener("selectionchange", this.selectionChangeHandler);
  }

  /**
   * Clean up selection handler on plugin unload
   */
  cleanupSelectionHandler() {
    if (this.selectionDebounceTimer) {
      window.clearTimeout(this.selectionDebounceTimer);
    }
    if (this.selectionChangeHandler && this.selectionListenerDocument) {
      this.selectionListenerDocument.removeEventListener(
        "selectionchange",
        this.selectionChangeHandler
      );
    }
    this.selectionListenerDocument = undefined;
  }

  /**
   * Clears the auto-selected text context if one was previously captured
   */
  private clearSelectionContext() {
    setSelectedTextContexts([]);
  }

  /**
   * Clears the auto-selected web text context for a specific URL.
   * Preserves contexts from other sourceTypes and other URLs.
   */
  private clearWebSelectionContextForUrl(url: string): void {
    const current = getSelectedTextContexts();
    const next = current.filter((c) => c.sourceType !== "web" || c.url !== url);
    if (next.length === current.length) {
      return;
    }
    setSelectedTextContexts(next);
  }

  /**
   * Stores the provided selection as the active selected text context.
   * Only keeps the latest selection - note and web selections are mutually exclusive.
   */
  private setSelectionContext(context: SelectedTextContext) {
    setSelectedTextContexts([context]);
  }

  /**
   * Handle text selection changes
   * Only processes selections from markdown editors
   */
  handleSelectionChange() {
    // Check if auto-inclusion is enabled
    const settings = getSettings();
    if (!settings.autoAddSelectionToContext) {
      return;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.editor) {
      return;
    }

    const editor = activeView.editor;
    const activeFile = this.app.workspace.getActiveFile();

    // Get selection range first to validate it exists
    const selectionRange = editor.listSelections()[0];
    if (!selectionRange) {
      return;
    }

    // Compute selection signature to avoid redundant updates
    const signature = activeFile
      ? `${activeFile.path}:${selectionRange.anchor.line}:${selectionRange.anchor.ch}:${selectionRange.head.line}:${selectionRange.head.ch}`
      : "";

    // Skip if selection hasn't changed
    if (signature === this.lastSelectionSignature) {
      return;
    }
    this.lastSelectionSignature = signature;

    const selectedText = editor.getSelection();

    // If selection is empty, clear note-type contexts
    if (!selectedText || !selectedText.trim()) {
      const currentContexts = getSelectedTextContexts();
      const nonNoteContexts = currentContexts.filter((ctx) => ctx.sourceType !== "note");
      if (currentContexts.length !== nonNoteContexts.length) {
        setSelectedTextContexts(nonNoteContexts);
      }
      return;
    }

    if (!activeFile) {
      return;
    }

    const anchorLine = selectionRange.anchor.line + 1;
    const headLine = selectionRange.head.line + 1;
    const startLine = Math.min(anchorLine, headLine);
    const endLine = Math.max(anchorLine, headLine);

    // Create selected text context
    const selectedTextContext: NoteSelectedTextContext = {
      id: uuidv4(),
      content: selectedText,
      sourceType: "note",
      noteTitle: activeFile.basename,
      notePath: activeFile.path,
      startLine,
      endLine,
    };

    this.setSelectionContext(selectedTextContext);
  }

  /**
   * Initialize web selection watcher for auto-adding web tab selections.
   * Desktop only - uses WebSelectionTracker with self-scheduling pattern.
   */
  initWebSelectionWatcher() {
    // Only run on desktop
    if (!isDesktopRuntime()) {
      return;
    }

    const webViewerService = getWebViewerService(this.app);

    this.webSelectionTracker = new WebSelectionTracker({
      intervalMs: 500,
      emptySelectionDebounceCount: 2,
      isEnabled: () => getSettings().autoAddSelectionToContext,
      getLeaf: () => webViewerService.getActiveLeaf() ?? webViewerService.getLastActiveLeaf(),
      getActiveLeaf: () => webViewerService.getActiveLeaf(),
      onSelectionChange: (context) => {
        // Use symmetric update strategy via setSelectionContext
        this.setSelectionContext(context);
      },
      onSelectionClear: ({ url }) => {
        this.clearWebSelectionContextForUrl(url);
      },
    });

    this.webSelectionTracker.start();
  }

  /**
   * Clean up web selection watcher
   */
  cleanupWebSelectionWatcher() {
    this.webSelectionTracker?.stop();
    this.webSelectionTracker = undefined;
  }

  /**
   * Suppress the current web selection so it won't be auto-captured again until it changes or is cleared.
   * Called by UI when user removes web selection or starts a new chat.
   * @param url - Optional URL to suppress (prevents leaf-binding issues when lastActiveLeaf has changed)
   */
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
        // Default to the entire active file if no selection
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
    // Small delay to ensure React component is ready to receive the focus event
    window.setTimeout(() => {
      this.emitChatIsVisible();
    }, 50);
  }

  /**
   * Which chat view "add … to chat" actions should target:
   *   - both chat views open → the one focused most recently (`lastActiveChatViewType`)
   *   - exactly one open      → that one
   *   - none open             → the agent chat when usable, else the legacy chat
   */
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

  /**
   * The "add … to chat context" commands write into a shared atom that both chat
   * views render, so this only picks which chat to bring into focus (see
   * `pickContextChatViewType`).
   */
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

  async activateAgentView(): Promise<WorkspaceLeaf | null> {
    if (!this.requireAgentView()) return null;
    const leaf = await this.openOrRevealView(CHAT_AGENT_VIEWTYPE);
    // Focus the composer on open. Latching the request on the view's event bus
    // (rather than a setTimeout) means a freshly-opened view drains it once its
    // React tree mounts and an already-open view focuses immediately — no
    // mount-timing guess. Also covers the already-open-and-active case, where
    // revealLeaf fires no active-leaf-change to drive focus.
    const view = leaf?.view;
    if (this.isCopilotAgentView(view)) {
      view.eventTarget.queueVisible();
    }
    return leaf;
  }

  async deactivateAgentView() {
    this.app.workspace.detachLeavesOfType(CHAT_AGENT_VIEWTYPE);
  }

  async activateRelevantNotesView(): Promise<WorkspaceLeaf | null> {
    return this.openOrRevealView(RELEVANT_NOTES_VIEWTYPE);
  }

  /**
   * Insert text (a `[[wikilink]]` from the Relevant Notes pane) into the chat view
   * the user last focused (see `pickContextChatViewType`), opening that view if none
   * is open. Routes via the target view's `eventTarget`, the same seam
   * `processText`/`emitChatIsVisible` use, so the standalone pane never needs the
   * chat's Lexical editor directly.
   */
  async insertTextIntoActiveChat(text: string): Promise<void> {
    const viewType = this.pickContextChatViewType();
    let leaf = this.app.workspace.getLeavesOfType(viewType)[0] ?? null;
    if (!leaf) {
      if (viewType === CHAT_AGENT_VIEWTYPE) {
        await this.activateAgentView();
      } else {
        await this.activateView();
      }
      leaf = this.app.workspace.getLeavesOfType(viewType)[0] ?? null;
    }
    if (!leaf) return;

    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    // The bus latches the text if the view's React tree hasn't mounted its
    // listener yet, so a freshly-opened view drains it on mount — delivery no
    // longer depends on guessing how long mounting takes.
    if (view instanceof CopilotView || this.isCopilotAgentView(view)) {
      view.eventTarget.queueInsertText(text);
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

  /** Open a fresh global Agent chat with reviewable text left unsent in its composer. */
  async newAgentChatWithDraft(initialDraft: string): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    try {
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
      // Create the drafted session before mounting the Agent view. A first-time
      // mount otherwise auto-creates an empty session before this one exists.
      await manager.createGlobalSessionWithDraft(initialDraft);
      await this.activateAgentView();
    } catch (error) {
      logWarn("[CopilotPlugin] Failed to create agent session with draft", error);
      new Notice("Failed to create agent session. Check Copilot logs.");
    }
  }

  private async openOrRevealView(viewType: string): Promise<WorkspaceLeaf | null> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return leaves[0];
    }
    const leaf =
      getSettings().defaultOpenArea === DEFAULT_OPEN_AREA.VIEW
        ? this.app.workspace.getRightLeaf(false)
        : this.app.workspace.getLeaf(true);
    if (!leaf) return null;
    await leaf.setViewState({ type: viewType, active: true });
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
    // and delete this device's `deviceProfiles` segment (GitHub #2539).
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
    // Mirror this device's `agentMode.deviceProfiles` segment into the flat
    // agent fields the rest of the code reads (GitHub #2539). `saveData` below
    // performs the inverse on the way out.
    setSettings(hydrateDeviceProfile(settings, getDeviceId(this.app)));
  }

  /**
   * Move device-specific agent fields into `agentMode.deviceProfiles[deviceId]`
   * and strip the global flat copies before writing, so a synced `data.json`
   * never carries one device's binary paths as a global value (GitHub #2539).
   *
   * Overriding here is the single choke point for every persisted write of the
   * hydrated in-memory settings — the settings subscriber and the keychain
   * transactions all route through `this.saveData`. The one deliberate
   * exception is the load-time keychain bootstrap, which persists a raw on-disk
   * snapshot via `super.saveData` (see `loadSettings`) so it isn't dehydrated.
   */
  async saveData(data: unknown): Promise<void> {
    return super.saveData(dehydrateDeviceProfile(data as CopilotSettings, getDeviceId(this.app)));
  }

  mergeActiveModels(
    existingActiveModels: CustomModel[],
    builtInModels: CustomModel[]
  ): CustomModel[] {
    const modelMap = new Map<string, CustomModel>();

    // Create a unique key for each model, it's model (name + provider)

    // Add or update existing models in the map
    existingActiveModels.forEach((model) => {
      const key = getModelKeyFromModel(model);
      const existingModel = modelMap.get(key);
      if (existingModel) {
        // If it's a built-in model, preserve the built-in status
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

    // Reason: pass all files to filterChatHistoryFiles which checks frontmatter projectId.
    // A prefix prefilter would miss renamed or legacy files that still have correct frontmatter.
    return filterChatHistoryFiles(this.app, folderFiles);
  }

  async getChatHistoryItems(): Promise<ChatHistoryItem[]> {
    const files = await this.getChatHistoryFiles();
    return files.map((file) =>
      fileToHistoryItem(this.app, file, this.chatHistoryLastAccessedAtManager)
    );
  }

  /**
   * Record that a chat history file was accessed by updating its `lastAccessedAt`
   * YAML frontmatter field (epoch ms), with in-memory tracking and throttled persistence.
   *
   * Memory is always updated immediately (for UI sorting), but disk writes are throttled and monotonic.
   */
  private async touchChatHistoryLastAccessedAt(file: TFile): Promise<void> {
    try {
      // Always update memory for immediate UI feedback
      this.chatHistoryLastAccessedAtManager.touch(file.path);

      // Check if we should persist to disk (throttled)
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
            // Monotonic protection: ensure we never write an older timestamp
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

      // Mark persistence successful for throttling purposes
      this.chatHistoryLastAccessedAtManager.markPersisted(file.path, persistedAtMs);
    } catch (error) {
      logWarn(`[CopilotPlugin] Failed to update chat lastAccessedAt for ${file.path}`, error);
    }
  }

  /**
   * Get the chat history last accessed at manager for use in sorting.
   * This allows UI components to use in-memory values for immediate feedback.
   */
  getChatHistoryLastAccessedAtManager(): RecentUsageManager<string> {
    return this.chatHistoryLastAccessedAtManager;
  }

  async loadChatHistory(file: TFile) {
    // First autosave the current chat if the setting is enabled
    await this.autosaveCurrentChat();

    // Check if the Copilot view is already active
    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (!existingView) {
      // Only activate the view if it's not already open
      await this.activateView();
    }

    // Load messages using ChatUIState (which now uses ChatPersistenceManager internally)
    await this.chatUIState.loadChatHistory(file);

    // Touch "lastAccessedAt" timestamp (throttled to avoid frequent writes)
    void this.touchChatHistoryLastAccessedAt(file);

    // Update the view
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

    // Hidden-folder notes (e.g. a dot-folder save location) aren't indexed by
    // metadataCache, so fall back to an adapter read before deciding this
    // isn't an agent chat — otherwise a hidden agent note that Recent Chats
    // surfaces would misroute to the legacy chat loader instead of resuming
    // the agent session.
    const cachedMode = this.app.metadataCache.getFileCache(file)?.frontmatter?.mode;
    let mode = typeof cachedMode === "string" ? cachedMode : undefined;
    if (!mode) {
      try {
        const fm = await readFrontmatterViaAdapter(this.app, file.path);
        if (typeof fm?.mode === "string") mode = fm.mode;
      } catch {
        // Leave mode undefined; routes to the legacy loader below.
      }
    }
    if (mode === AGENT_CHAT_MODE) {
      await this.loadAgentChatHistory(file);
      return;
    }
    await this.loadChatHistory(file);
  }

  /**
   * Open a chat that lives only in a backend's native session store (recent
   * chats entry with no markdown note). Resumes through the agent manager;
   * recency tracking is handled by the session index rather than file
   * frontmatter.
   */
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

      // Wait for metadata cache to update with improved error handling
      // This ensures that subsequent calls to extractChatTitle will get the updated data
      await new Promise<void>((resolve) => {
        const handler = (updatedFile: TFile) => {
          if (updatedFile.path === fileId) {
            this.app.metadataCache.off("changed", handler);
            window.clearTimeout(timeoutId);
            resolve();
          }
        };

        this.app.metadataCache.on("changed", handler);

        // Fallback timeout with shorter duration and better error handling
        const timeoutId = window.setTimeout(() => {
          this.app.metadataCache.off("changed", handler);
          // Don't reject, just resolve - the frontmatter update might have worked
          // even if we didn't catch the event
          resolve();
        }, 500); // Reduced timeout for better performance
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

    // Analyze chat messages for memory if enabled
    if (getSettings().enableRecentConversations) {
      try {
        // Get the current chat model from the chain manager
        const chainManager = this.chainOwner.getCurrentChainManager();
        const chatModel = chainManager.chatModelManager.getChatModel();
        this.userMemoryManager.addRecentConversation(this.chatUIState.getMessages(), chatModel);
      } catch (error) {
        logInfo("Failed to analyze chat messages for memory:", error);
      }
    }

    // First autosave the current chat if the setting is enabled
    await this.autosaveCurrentChat();

    // Abort any ongoing streams before clearing chat
    const existingView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0];
    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      // Dispatch abort event to stop any ongoing streams
      const abortEvent = new CustomEvent(EVENT_NAMES.ABORT_STREAM, {
        detail: { reason: ABORT_REASON.NEW_CHAT },
      });
      copilotView.eventTarget.dispatchEvent(abortEvent);
    }

    // Clear messages through ChatUIState (which also clears chain memory)
    this.chatUIState.clearMessages();

    // Update view if it exists
    if (existingView) {
      const copilotView = existingView.view as CopilotView;
      copilotView.updateView();
    } else {
      // If view doesn't exist, open it
      await this.activateView();
    }

    // Note: UI-specific state like includeActiveNote setting is handled in the Chat component
    // This ensures proper separation of concerns between plugin logic and UI state
  }

  async newChat() {
    // Just delegate to the shared method
    await this.handleNewChat();
  }
}
