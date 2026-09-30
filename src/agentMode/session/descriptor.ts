import type { App } from "obsidian";
import type React from "react";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
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
  /** Await release of managed files before cleanup. https://github.com/Brevilabs/obsidian-copilot-private/issues/379 */
  subscribeCustomSelection?(plugin: CopilotPlugin, refresh: () => Promise<void>): () => void;
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

export interface ApplySelectionContext {
  backendReportedCurrent: ModelSelection | null;
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

  readonly planFeedbackDelivery?: "permission" | "next_turn";

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

  readonly showModelDescriptions?: boolean;

  applySelection(
    session: ModelSelectionSession,
    selection: ModelSelection,
    context?: ApplySelectionContext
  ): Promise<void>;

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
