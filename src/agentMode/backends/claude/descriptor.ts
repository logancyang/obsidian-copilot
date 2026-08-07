import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
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
import { getClaudeAuthStatus, signInToClaude } from "./claudeAuth";
import { assertClaudeVersionSupported } from "./claudeVersion";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { ClaudeSdkBackendProcess } from "@/agentMode/sdk/ClaudeSdkBackendProcess";
import { getCachedSdkCatalog, synthesizeEffortConfigOption } from "@/agentMode/sdk/effortOption";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { buildBuiltinSkillEnv } from "@/agentMode/backends/shared/builtinSkillEnv";
import { getVaultBase } from "@/utils/vaultPath";
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

/** Claude's descriptor contract, whose binary-resolution and auth capabilities are unconditional. */
export interface ClaudeDescriptor extends BackendDescriptor {
  auth: BackendAuth;
  getResolvedBinaryPath(settings: CopilotSettings): string | null;
}

/**
 * The native permission mode Claude enters when the user picks the canonical
 * `auto` pill. Copilot's three-mode picker can't express Claude's full
 * permission vocabulary, so this preference decides how much the pill hands
 * over. Unconfigured, it is Claude's own classifier-driven `auto`: it approves
 * routine requests and still escalates the risky ones, the closest match to
 * what "Auto" promises in the picker.
 *
 * @param settings Settings snapshot from which to resolve the persisted Claude permission.
 */
export function resolveClaudeAutoModePermission(
  settings: CopilotSettings
): ClaudeAutoModePermission {
  return settings.agentMode?.backends?.claude?.autoModePermission ?? "auto";
}

export function updateClaudeFields(partial: Partial<ClaudeBackendSettings>): void {
  updateAgentModeBackendFields("claude", partial);
}

/**
 * Wire-format codec for Claude — bare base id only. Effort is dispatched
 * via `setSessionConfigOption`, not encoded in the model id, so `encode`
 * drops `effort` and `effortConfigFor` provides the config option spec.
 */
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

/**
 * Build the environment input shared by both override-aware resolution and
 * fresh auto-detection. Pulls `os.homedir()`, `process.platform`, the full
 * `process.env` (the shared dir resolver reads NVM/FNM/asdf/Volta/n/npm vars),
 * and real `fs` accessors.
 */
function claudeResolverEnv(): Omit<Parameters<typeof resolveClaudeBinary>[0], "override"> {
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

/**
 * Environment for spawning the `claude` CLI for auth checks: `process.env`
 * plus the user's Claude env overrides. Mirrors how `prompt()` composes env so
 * `claude auth status` resolves the same credentials the SDK turn would.
 */
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

/**
 * Resolve the `claude` CLI path from settings + auto-detection. Mirrors the
 * `getInstallState` logic: explicit override wins, otherwise the resolver
 * walks Volta/asdf/NVM/Homebrew/npm-global.
 */
export function resolveClaudeCliPath(settings: CopilotSettings): string | null {
  return resolveClaudeBinary({
    override: settings.agentMode?.claudeCli?.path,
    ...claudeResolverEnv(),
  });
}

/**
 * Run a fresh auto-detect, ignoring any previously saved override. Used by
 * the settings panel's "Auto-detect" button so users get the resolver's full
 * candidate list (Volta/asdf/NVM/Homebrew/npm-global/`~/.local/bin`) instead
 * of the generic `which`-based fallback that only sees `PATH`.
 */
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

/**
 * Refreshes compatibility knowledge after runtime configuration changes so readiness does not remain stale.
 * @param settings - The settings that select the executable and its runtime environment.
 * @param force - Whether an already-settled compatibility result should be checked again.
 */
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

/**
 * Plan mode writes its proposal to `<claude-config-dir>/plans/<slug>.md`
 * (typically `~/.claude/plans/`, but `CLAUDE_CONFIG_DIR` / `XDG_CONFIG_HOME`
 * can relocate it). We suffix-match on `.claude/plans` rather than prefix-
 * matching `os.homedir()` so the predicate stays correct under those env
 * overrides and across platforms — `path.dirname` + `path.join` produce
 * native separators on macOS/Linux/Windows.
 */
function isClaudePlanModePlanFilePath(absolutePath: string): boolean {
  if (!path.isAbsolute(absolutePath)) return false;
  if (!absolutePath.endsWith(".md")) return false;
  const dir = path.dirname(absolutePath);
  return dir.endsWith(path.join(".claude", "plans"));
}

/**
 * Claude backend backed by the official `@anthropic-ai/claude-agent-sdk`.
 * Replaces the legacy `claude-code-acp` shim. Auth is inherited from the
 * user-installed `claude` CLI's login state (or `ANTHROPIC_API_KEY` /
 * Bedrock / Vertex env if configured) — the SDK handles credential
 * resolution through the spawned CLI; we never see or pass the secret.
 */
export const ClaudeBackendDescriptor: ClaudeDescriptor = {
  id: "claude",
  displayName: "Claude",
  Icon: ClaudeLogo,
  // Cloud agent — flagged with a cloud-egress warning while Self-Host Mode is on.
  selfHostable: false,
  setupDescription:
    "Anthropic models, billed to your Claude Code subscription. Runs the claude CLI already on your machine.",
  skillsProjectDir: ".claude/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  // The Claude SDK adapter re-reads the composed system prompt per
  // `newSession()`, so a new chat picks up prompt changes without a restart.
  restartOnSystemPromptChange: false,
  // The Claude SDK exposes no session-title API, so the session derives the tab
  // title client-side from the user's first message.
  summarizesSessionTitle: false,
  wire: claudeWire,
  showModelDescriptions: true,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    // All Claude Code models are agent-origin.
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
    async getStatus(settings) {
      const claudePath = resolveClaudeCliPath(settings);
      if (!claudePath) return { signedIn: false };
      const status = await getClaudeAuthStatus(claudePath, claudeChildEnv(settings));
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

  async applySelection(session: AgentSession, selection: ModelSelection, context): Promise<void> {
    // Claude's wire id is just the baseModelId — effort travels through
    // `setConfigOption`, not the model id. Skip the model round-trip when
    // the base hasn't changed, otherwise effort-only ticks would fire a
    // pointless `setSessionModel` on every slider drag.
    const currentBase = context
      ? context.backendReportedCurrent?.baseModelId
      : session.getState()?.model?.current.baseModelId;
    if (currentBase !== selection.baseModelId) {
      await session.applyModelWireId(claudeWire.encode(selection));
    }
    if (selection.effort === null) return;
    const cfgOpt = claudeWire.effortConfigFor?.(selection.baseModelId);
    if (!cfgOpt) return;
    try {
      await session.setConfigOption(cfgOpt.id, selection.effort);
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
      getEnvOverrides: () => getSettings().agentMode?.backends?.claude?.envOverrides,
      // Plugin-managed runtime paths and credentials for builtin skills.
      // Passed as a callback so `sdk/` need not import `backends/` (lint boundary).
      getManagedEnv: () => buildBuiltinSkillEnv(args.clientVersion, getVaultBase(args.app) ?? ""),
      checkAuth: async () =>
        (await getClaudeAuthStatus(claudePath, claudeChildEnv(getSettings()))).loggedIn,
      checkCompatibility: () =>
        assertClaudeVersionSupported(claudePath, claudeChildEnv(getSettings())),
      isPlanModePlanFilePath: isClaudePlanModePlanFilePath,
      getDefaultModelId: () => getSettings().agentMode?.backends?.claude?.defaultModel?.baseModelId,
      // Compose the shared system prompt — the Copilot base framing (unless the
      // user disabled it), the pill-syntax directive, and the user's custom
      // prompt — plus the owning project's instructions when the session is
      // project-scoped. The SDK resolves the project instructions per session
      // (via the manager-injected profile provider) and passes the opaque body
      // here; `backends/shared` never imports the `projects/` layer. The
      // result appends to Claude's `claude_code` preset (see
      // `ClaudeSdkBackendProcess`), so Claude keeps its tool/planning framing
      // while gaining the Obsidian-vault identity. Re-read per `newSession()`,
      // so a prompt change applies to the next session. A global (no-project)
      // session passes `undefined`, yielding the byte-identical global prompt.
      //
      // Claude discovers skills natively from `.claude/skills/`, so the payload
      // carries no SKILL.md authoring instructions. Claude has no
      // cross-discovery surface — it only loads `.claude/skills/`, and the
      // symlink fanout already enforces visibility (no link = not seen). If the
      // Claude Agent SDK ever grows a per-skill deny hook, wire
      // `composeDenyList(getManagedSkills(), "claude")` in here.
      getSystemPromptAppend: (opts) => buildAgentSystemPrompt(opts),
    });
  },

  SettingsPanel: ClaudeSettingsPanel,

  /**
   * Map Copilot's canonical modes onto the SDK's `PermissionMode` strings.
   * The picker is a 3-mode UI (default / plan / auto), so the several native
   * modes that trade prompts for autonomy collapse onto `auto` — which one
   * is the user's choice. `dontAsk` stays hidden. The session adapter
   * normalizes unknown ids to `default`.
   */
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

  /**
   * Replay the intended effort on a freshly created session. The Claude
   * SDK adapter probes the model catalog asynchronously, so the effort
   * `SessionConfigOption` may not be present yet when this runs;
   * `replayPersistedEffort` subscribes to the session and applies once the
   * option arrives (with a timeout guard to avoid leaking listeners on
   * agents that never report effort). Mode is never persisted — the
   * Claude SDK's natural starting mode is already canonical `default`.
   *
   * A transient cross-backend pick seeds the session with the user's drafted
   * effort via `seededSelection`; that intent wins over the persisted default,
   * which would otherwise overwrite it on startup.
   */
  async applyInitialSessionConfig(
    session: AgentSession,
    settings: CopilotSettings,
    seededSelection?: ModelSelection
  ): Promise<void> {
    const persistedEffort = settings.agentMode?.backends?.claude?.defaultModel?.effort ?? null;
    const effort = seededSelection ? seededSelection.effort : persistedEffort;
    await replayPersistedEffort(session, effort ?? undefined);
  },
};

async function replayPersistedEffort(
  session: AgentSession,
  persistedEffort: string | undefined
): Promise<void> {
  if (!persistedEffort) return;
  const tryApply = async (): Promise<boolean> => {
    const state = session.getState();
    const current = state?.model?.current;
    if (!current) return false;
    if (current.effort === persistedEffort) return true;
    const entry = state?.model?.availableModels.find((e) => e.baseModelId === current.baseModelId);
    if (!entry?.effortOptions.some((o) => o.value === persistedEffort)) return true;
    const cfgOpt = ClaudeBackendDescriptor.wire.effortConfigFor?.(current.baseModelId);
    if (!cfgOpt) return true;
    try {
      await session.setConfigOption(cfgOpt.id, persistedEffort);
    } catch (e) {
      if (e instanceof MethodUnsupportedError) return true;
      logWarn(`[AgentMode] could not apply default effort ${persistedEffort}`, e);
    }
    return true;
  };

  if (await tryApply()) return;

  // Effort hasn't been advertised yet — wait for the first
  // config_option_update. Bound the wait so we don't keep a listener alive
  // on agents that never emit an effort option.
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
