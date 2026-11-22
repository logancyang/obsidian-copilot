import type { App, PluginManifest } from "obsidian";
import type React from "react";
import type { ModelManagementApi } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import type { Destination } from "@/types/destination";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { CopilotMcpServer } from "@/agentMode/session/copilotMcpServer";
import type {
  BackendConfigOption,
  BackendId,
  BackendProcess,
  BackendState,
  BlockedModels,
  EffortOption,
  EnabledModelEntry,
  ModelEntry,
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
  getState(app: App, manifest: PluginManifest): ManagedInstallActionState;
  subscribe(app: App, manifest: PluginManifest, onChange: () => void): () => void;
  run(app: App, manifest: PluginManifest): Promise<void>;
}

export type ApprovedRuleScope = { kind: "folder"; path: string } | { kind: "file"; path: string };

export interface ApprovedRule {
  readonly id: string;
  readonly allows: string;
  readonly appliesTo: ApprovedRuleScope;
}

export interface ApprovedRuleStore {
  list(app: App): Promise<ReadonlyArray<ApprovedRule>>;
  remove(app: App, rule: ApprovedRule): Promise<void | { undo(): Promise<void> }>;
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

export interface BackendStartServices {
  readonly clientVersion: string;
  readonly modelManagement: Pick<ModelManagementApi, "providerRegistry" | "backendConfigRegistry">;
  readonly getSelfHostWebSearchChannel: () => Promise<Readonly<{ url: string; token: string }>>;
}

export interface BackendStartArgs extends BackendStartServices {
  readonly app: App;
  readonly descriptor: BackendDescriptor;
  readonly copilotMcpServer?: CopilotMcpServer;
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

  getInstallState(settings: CopilotSettings): InstallState;

  getResolvedBinaryPath?(settings: CopilotSettings): string | null;

  subscribeInstallState(cb: () => void): () => void;

  openInstallUI(app: App, manifest: PluginManifest): void;

  managedInstall?: ManagedInstallAction;

  auth?: BackendAuth;

  approvedRules?: ApprovedRuleStore;

  createBackendProcess(args: BackendStartArgs): BackendProcess;

  SettingsPanel?: React.FC<{ app: App; manifest: PluginManifest }>;

  onPluginLoad?(app: App, manifest: PluginManifest): Promise<void>;

  // A backend that keeps an agent's prompt in a file outside the vault removes it when the agent is deleted.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/991
  forgetAgent?(app: App, slug: string): Promise<void>;

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

  getBlockedModels?(
    settings: CopilotSettings,
    reportedModels: ReadonlyArray<ModelEntry>
  ): BlockedModels | null;

  getWireBaseId?(configuredModelId: string, settings: CopilotSettings): string | null;

  persistProbeSessionId?(sessionId: string): Promise<void>;

  prefetchEffortCatalog?(args: {
    proc: BackendProcess;
    sessionId: SessionId;
    modelState: ModelState;
    enabledModels: ReadonlyArray<EnabledModelEntry>;
    isAborted: () => boolean;
  }): Promise<Record<string, EffortOption[]>>;
}
