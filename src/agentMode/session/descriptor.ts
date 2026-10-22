import type { App } from "obsidian";
import type React from "react";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { Destination } from "@/types/destination";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  BackendConfigOption,
  BackendId,
  BackendProcess,
  BackendState,
  EffortOption,
  EnabledModelEntry,
  ModelSelection,
  ModelState,
  ModelWireCodec,
  ModeMapping,
  PermissionOption,
  RawModeState,
  SessionId,
} from "./types";

export interface ModelSelectionSession {
  getState(): BackendState | null;
  applyModelWireId(wireId: string): Promise<void>;
  setConfigOption(configId: string, value: string): Promise<void>;
}

export type InstallState =
  | { kind: "absent" }
  | { kind: "checking"; source: "managed" | "custom" }
  | { kind: "ready"; source: "managed" | "custom" }
  | {
      kind: "incompatible";
      source: "managed" | "custom";
      currentVersion: string;
      minVersion: string;
      message: string;
    }
  | { kind: "error"; message: string };

export type ManagedInstallActionState =
  | { kind: "idle" }
  | { kind: "running"; label: string; percent?: number }
  | { kind: "error"; message: string };

export interface ManagedInstallAction {
  getState(plugin: CopilotPlugin): ManagedInstallActionState;
  subscribe(plugin: CopilotPlugin, onChange: () => void): () => void;
  run(plugin: CopilotPlugin): Promise<void>;
}

export interface BackendAuthStatus {
  signedIn: boolean;
  label?: string;
}

export interface BackendSignInHandlers {
  signal?: AbortSignal;
  onUrl?: (url: string) => void;
  onLine?: (line: string) => void;
}

export interface BackendAuth {
  getProbeKey?(settings: CopilotSettings): string;
  getStatus(settings: CopilotSettings): Promise<BackendAuthStatus>;
  signIn(settings: CopilotSettings, handlers?: BackendSignInHandlers): Promise<BackendAuthStatus>;
  signOut?(
    settings: CopilotSettings,
    options?: { signal?: AbortSignal }
  ): Promise<BackendAuthStatus>;
}

export interface BackendDescriptor {
  readonly id: BackendId;
  readonly displayName: string;

  readonly Icon: React.ComponentType<{ className?: string }>;

  readonly selfHostable: boolean;

  readonly routesCopilotModels: boolean;

  readonly setupDescription: string;

  readonly skillsProjectDir: string;

  readonly crossDiscoveredAgents: ReadonlyArray<BackendId>;

  readonly restartOnManagedSkillsChange: boolean;

  readonly restartOnProviderConfigChange: boolean;

  readonly restartOnSystemPromptChange: boolean;

  readonly summarizesSessionTitle: boolean;

  // OpenCode registers a session's MCP servers on the instance for its folder, so every chat there shares one connection per server name.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  readonly sharesMcpServersAcrossSessions?: boolean;

  readonly agentProductName?: string;

  readonly planFeedbackDelivery?: "permission" | "next_turn";

  // A backend that takes input while its agent works gets each message at the agent's next step instead of Copilot holding it until the turn ends.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/509
  readonly midTurnDelivery?: boolean;

  // A backend that can take back a message the agent has not read yet withdraws every such message at Stop and offers to withdraw each one.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/747
  readonly withdraw?: boolean;

  // A backend that can end one background task on its own offers a stop control on each running task, leaving the main agent and other tasks running.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/748
  readonly stopTask?: boolean;

  // A backend that runs one agent process per chat keeps it alive while the chat is hidden, so only a few idle hidden chats stay open and the rest reopen from their transcripts.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/175
  readonly processPerChat?: boolean;

  getInstallState(settings: CopilotSettings): InstallState;

  getResolvedBinaryPath?(settings: CopilotSettings): string | null;

  subscribeInstallState(plugin: CopilotPlugin, cb: () => void): () => void;

  openInstallUI(plugin: CopilotPlugin): void;

  managedInstall?: ManagedInstallAction;

  auth?: BackendAuth;

  createBackendProcess(args: {
    plugin: CopilotPlugin;
    app: App;
    clientVersion: string;
    descriptor: BackendDescriptor;
  }): BackendProcess;

  SettingsPanel?: React.FC<{ plugin: CopilotPlugin; app: App }>;

  onPluginLoad?(plugin: CopilotPlugin): Promise<void>;

  readonly wire: ModelWireCodec;

  normalizeModelName?(name: string): string;

  presentPermissionOption?(option: PermissionOption, metadata: unknown): PermissionOption;

  // Agents whose own CLI picks the server name it in their settings tab.
  // https://github.com/logancyang/obsidian-copilot/issues/2889
  dataDestination?(settings: CopilotSettings, vaultBase: string | null): Destination;

  readonly showModelDescriptions?: boolean;

  applySelection(session: ModelSelectionSession, selection: ModelSelection): Promise<void>;

  getModeMapping?(
    modeState: RawModeState | null,
    configOptions: BackendConfigOption[] | null
  ): ModeMapping | null;

  getModeState?(
    modeState: RawModeState | null,
    configOptions: BackendConfigOption[] | null
  ): BackendState["mode"];

  applyInitialSessionConfig?(
    session: AgentSession,
    settings: CopilotSettings,
    seededSelection?: ModelSelection
  ): Promise<void>;

  isPlanModePlanFilePath?(absolutePath: string, cwd: string | null | undefined): boolean;

  getProbeSessionId?(settings: CopilotSettings): string | undefined;

  getEnabledModelEntries?(settings: CopilotSettings): EnabledModelEntry[] | null;

  getWireBaseId?(configuredModelId: string, settings: CopilotSettings): string | null;

  persistProbeSessionId?(sessionId: string, plugin: CopilotPlugin): Promise<void>;

  prefetchEffortCatalog?(args: {
    proc: BackendProcess;
    sessionId: SessionId;
    modelState: ModelState;
    enabledModels: ReadonlyArray<EnabledModelEntry>;
    isAborted: () => boolean;
  }): Promise<Record<string, EffortOption[]>>;
}
