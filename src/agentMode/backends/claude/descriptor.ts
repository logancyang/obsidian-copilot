import { resolveEffort } from "@/lib/model-effort";
import type { ModelSelectionSession } from "@/agentMode/session/types";
import { logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import { requireNodeModule } from "@/utils/desktopRuntime";
import {
  getSettings,
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type ClaudeAutoModePermission,
  type ClaudeBackendSettings,
  type CopilotSettings,
} from "@/settings/model";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { claudeBinarySearchDirs, resolveClaudeBinary } from "./claudeBinaryResolver";
import { CLAUDE_INSTALL_COMMAND } from "./cliSetup";
import { getClaudeAuthStatus, signInToClaude, signOutFromClaude } from "./claudeAuth";
import { assertClaudeVersionSupported } from "./claudeVersion";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { readBackendDefault } from "@/agentMode/session/backendDefaultModel";
import { ClaudeSdkBackendProcess } from "@/agentMode/sdk/ClaudeSdkBackendProcess";
import { getCachedSdkCatalog, synthesizeEffortConfigOption } from "@/agentMode/sdk/effortOption";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  buildBuiltinSkillEnv,
  sanitizeBuiltinSkillEnvOverrides,
} from "@/agentMode/backends/shared/builtinSkillEnv";
import { getVaultBase } from "@/utils/vaultPath";
import { getMiyoFolderName } from "@/miyo/miyoUtils";
import type {
  BackendAuth,
  BackendConfigOption,
  BackendDescriptor,
  BackendProcess,
  EnabledModelEntry,
  InstallState,
  ModeMapping,
  ModelSelection,
  ModelWireCodec,
} from "@/agentMode/session/types";
import { ClaudeInstallModal } from "./ClaudeInstallModal";
import ClaudeLogo from "./logo.svg";
import { ClaudeSettingsPanel } from "./ClaudeSettingsPanel";
import {
  claudeCompatibilityStore,
  type ClaudeCompatibilityInput,
} from "./claudeCompatibilityStore";

const ABSENT_INSTALL_STATE: InstallState = Object.freeze({ kind: "absent" });

export interface ClaudeDescriptor extends BackendDescriptor {
  auth: BackendAuth;
  getResolvedBinaryPath(settings: CopilotSettings): string | null;
}

export function resolveClaudeAutoModePermission(
  settings: CopilotSettings
): ClaudeAutoModePermission {
  return settings.agentMode?.backends?.claude?.autoModePermission ?? "auto";
}

export function updateClaudeFields(partial: Partial<ClaudeBackendSettings>): void {
  updateAgentModeBackendFields("claude", partial);
}

const claudeWire: ModelWireCodec = {
  encode: (selection: ModelSelection) => selection.baseModelId,
  decode: (wireId: string) => ({
    selection: { baseModelId: wireId, effort: null },
    provider: "anthropic",
  }),
  effortConfigFor: (baseModelId: string): BackendConfigOption | null => {
    const catalog = getCachedSdkCatalog(getSettings().agentMode?.backends?.claude?.envOverrides);
    if (!catalog) return null;
    const modelInfo = catalog.find((m) => m.value === baseModelId);
    if (!modelInfo) return null;
    return synthesizeEffortConfigOption(modelInfo, undefined);
  },
};

function claudeResolverEnv(): Omit<Parameters<typeof resolveClaudeBinary>[0], "override"> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
  return {
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      readdirSync: (p) => fs.readdirSync(p),
    },
  };
}

function claudeChildEnv(settings: CopilotSettings): NodeJS.ProcessEnv {
  const overrides = settings.agentMode?.backends?.claude?.envOverrides;
  return overrides && Object.keys(overrides).length > 0
    ? { ...process.env, ...overrides }
    : process.env;
}

function claudeCompatibilityInput(
  settings: CopilotSettings,
  claudePath: string
): ClaudeCompatibilityInput {
  const overrides = settings.agentMode?.backends?.claude?.envOverrides;
  const environmentKey = JSON.stringify(
    Object.entries(overrides ?? {}).sort(([a], [b]) => a.localeCompare(b))
  );
  const source = settings.agentMode?.claudeCli?.path ? "custom" : "managed";
  return {
    cacheKey: `${source}\u0000${claudePath}\u0000${environmentKey}`,
    path: claudePath,
    source,
    env: claudeChildEnv(settings),
  };
}

function resolveClaudeCliPath(settings: CopilotSettings): string | null {
  return resolveClaudeBinary({
    override: settings.agentMode?.claudeCli?.path,
    ...claudeResolverEnv(),
  });
}

export function detectClaudeCliPath(): string | null {
  return resolveClaudeBinary({ override: undefined, ...claudeResolverEnv() });
}

export function claudeCliDetectionSearchDirs(): string[] {
  return claudeBinarySearchDirs({ override: undefined, ...claudeResolverEnv() });
}

export function getClaudeInstallState(settings: CopilotSettings): InstallState {
  const claudePath = resolveClaudeCliPath(settings);
  if (!claudePath) return ABSENT_INSTALL_STATE;
  return claudeCompatibilityStore.get(claudeCompatibilityInput(settings, claudePath));
}

export async function refreshClaudeInstallState(
  settings: CopilotSettings,
  force = false
): Promise<InstallState> {
  const claudePath = resolveClaudeCliPath(settings);
  if (!claudePath) return ABSENT_INSTALL_STATE;
  return claudeCompatibilityStore.refresh(claudeCompatibilityInput(settings, claudePath), {
    force,
  });
}

export function subscribeClaudeInstallState(listener: () => void): () => void {
  return claudeCompatibilityStore.subscribe(listener);
}

function isClaudePlanModePlanFilePath(absolutePath: string): boolean {
  const path = requireNodeModule<typeof import("node:path")>("path");
  if (!path.isAbsolute(absolutePath)) return false;
  if (!absolutePath.endsWith(".md")) return false;
  const dir = path.dirname(absolutePath);
  return dir.endsWith(path.join(".claude", "plans"));
}

export const ClaudeBackendDescriptor: ClaudeDescriptor = {
  id: "claude",
  displayName: "Claude",
  Icon: ClaudeLogo,
  selfHostable: false,
  routesCopilotModels: false,
  setupDescription:
    "Anthropic models, billed to your Claude Code subscription. Runs the claude CLI already on your machine.",
  skillsProjectDir: ".claude/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  restartOnSystemPromptChange: false,
  summarizesSessionTitle: false,
  wire: claudeWire,
  showModelDescriptions: true,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    return [
      ...agentOriginEnabledModelEntries(settings, "claude", (wireId) => claudeWire.decode(wireId)),
    ];
  },

  getInstallState(settings: CopilotSettings): InstallState {
    return getClaudeInstallState(settings);
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return resolveClaudeCliPath(settings);
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    const unsubscribeSettings = subscribeToSettingsChange((prev, next) => {
      if (
        prev.agentMode?.claudeCli?.path !== next.agentMode?.claudeCli?.path ||
        prev.agentMode?.backends?.claude?.envOverrides !==
          next.agentMode?.backends?.claude?.envOverrides
      ) {
        cb();
        void refreshClaudeInstallState(next, true);
      }
    });
    const unsubscribeCompatibility = subscribeClaudeInstallState(cb);
    return () => {
      unsubscribeSettings();
      unsubscribeCompatibility();
    };
  },

  async onPluginLoad(): Promise<void> {
    await refreshClaudeInstallState(getSettings(), true);
  },

  openInstallUI(plugin: CopilotPlugin): void {
    new ClaudeInstallModal(plugin.app, ClaudeBackendDescriptor).open();
  },

  auth: {
    getProbeKey(settings) {
      // CLI credentials can come from a profile or an environment-selected provider.
      // Hash the effective environment so account changes cancel stale authentication
      // operations without exposing credentials in the shared UI identity.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
      return requireNodeModule<typeof import("node:crypto")>("crypto")
        .createHash("sha256")
        .update(
          JSON.stringify([
            resolveClaudeCliPath(settings),
            Object.entries(claudeChildEnv(settings)).sort(([a], [b]) => a.localeCompare(b)),
          ])
        )
        .digest("hex");
    },
    async getStatus(settings) {
      const claudePath = resolveClaudeCliPath(settings);
      if (!claudePath) return { signedIn: false };
      const status = await getClaudeAuthStatus(claudePath, claudeChildEnv(settings));
      return { signedIn: status.loggedIn, label: status.label };
    },
    async signOut(settings, options) {
      const claudePath = resolveClaudeCliPath(settings);
      if (!claudePath) throw new Error("Install Claude Code before signing out.");
      const status = await signOutFromClaude(claudePath, claudeChildEnv(settings), options);
      return { signedIn: status.loggedIn, label: status.label };
    },
    async signIn(settings, handlers) {
      const claudePath = resolveClaudeCliPath(settings);
      if (!claudePath) return { signedIn: false };
      const status = await signInToClaude(claudePath, claudeChildEnv(settings), handlers).done;
      return { signedIn: status.loggedIn, label: status.label };
    },
  },

  isPlanModePlanFilePath(absolutePath: string): boolean {
    return isClaudePlanModePlanFilePath(absolutePath);
  },

  async applySelection(
    session: ModelSelectionSession,
    selection: ModelSelection,
    context
  ): Promise<void> {
    const currentBase = context
      ? context.backendReportedCurrent?.baseModelId
      : session.getState()?.model?.current.baseModelId;
    if (currentBase !== selection.baseModelId) {
      await session.applyModelWireId(claudeWire.encode(selection));
    }
    const cfgOpt = claudeWire.effortConfigFor?.(selection.baseModelId);
    if (!cfgOpt) return;
    const options = session
      .getState()
      ?.model?.availableModels.find(
        (model) => model.baseModelId === selection.baseModelId
      )?.effortOptions;
    const effort = resolveEffort(selection.effort, options);
    if (effort === null) return;
    try {
      await session.setConfigOption(cfgOpt.id, effort);
    } catch (e) {
      if (!(e instanceof MethodUnsupportedError)) throw e;
    }
  },

  createBackendProcess(args): BackendProcess {
    const claudePath = resolveClaudeCliPath(getSettings());
    if (!claudePath) {
      throw new Error(
        `Claude CLI not found. Install with: ${CLAUDE_INSTALL_COMMAND}, ` +
          `or set agentMode.claudeCli.path in settings.`
      );
    }
    return new ClaudeSdkBackendProcess({
      pathToClaudeCodeExecutable: claudePath,
      app: args.app,
      clientVersion: args.clientVersion,
      descriptor: args.descriptor,
      getEnableThinking: () => Boolean(getSettings().agentMode?.backends?.claude?.enableThinking),
      getEnvOverrides: () =>
        sanitizeBuiltinSkillEnvOverrides(getSettings().agentMode?.backends?.claude?.envOverrides),
      getManagedEnv: () =>
        buildBuiltinSkillEnv(
          args.clientVersion,
          getVaultBase(args.app) ?? "",
          getMiyoFolderName(args.app)
        ),
      checkAuth: async () =>
        (await getClaudeAuthStatus(claudePath, claudeChildEnv(getSettings()))).loggedIn,
      checkCompatibility: () =>
        assertClaudeVersionSupported(claudePath, claudeChildEnv(getSettings())),
      isPlanModePlanFilePath: isClaudePlanModePlanFilePath,
      getDefaultModelId: () =>
        readBackendDefault(ClaudeBackendDescriptor, getSettings())?.baseModelId,
      getSystemPromptAppend: () => buildAgentSystemPrompt("claude"),
    });
  },

  SettingsPanel: ClaudeSettingsPanel,

  getModeMapping(): ModeMapping {
    return {
      kind: "setMode",
      canonical: {
        default: "default",
        plan: "plan",
        auto: resolveClaudeAutoModePermission(getSettings()),
      },
    };
  },

  async applyInitialSessionConfig(
    session: AgentSession,
    settings: CopilotSettings,
    seededSelection?: ModelSelection
  ): Promise<void> {
    const persistedEffort = settings.backends?.claude?.default?.effort ?? null;
    const effort = seededSelection ? seededSelection.effort : persistedEffort;
    await replayPersistedEffort(session, effort ?? undefined);
  },
};

async function replayPersistedEffort(
  session: AgentSession,
  persistedEffort: string | undefined
): Promise<void> {
  const tryApply = async (): Promise<boolean> => {
    const state = session.getState();
    const current = state?.model?.current;
    if (!current) return false;
    const entry = state?.model?.availableModels.find((e) => e.baseModelId === current.baseModelId);
    if (!entry) return false;
    const effort = resolveEffort(persistedEffort ?? current.effort, entry.effortOptions);
    if (effort === null || current.effort === effort) return true;
    const cfgOpt = ClaudeBackendDescriptor.wire.effortConfigFor?.(current.baseModelId);
    if (!cfgOpt) return true;
    try {
      await session.setConfigOption(cfgOpt.id, effort);
    } catch (e) {
      if (e instanceof MethodUnsupportedError) return true;
      logWarn(`[AgentMode] could not apply default effort ${persistedEffort}`, e);
    }
    return true;
  };

  if (await tryApply()) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      unsub();
      window.clearTimeout(timer);
      resolve();
    };
    const unsub = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: () => {},
      onModelChanged: () => {
        void tryApply().then((applied) => {
          if (applied) finish();
        });
      },
    });
    const timer = window.setTimeout(finish, 10_000);
  });
}
