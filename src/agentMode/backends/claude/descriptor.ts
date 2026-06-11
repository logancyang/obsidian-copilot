import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import {
  getSettings,
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type ClaudeBackendSettings,
  type CopilotSettings,
} from "@/settings/model";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { claudeBinarySearchDirs, resolveClaudeBinary } from "./claudeBinaryResolver";
import { getClaudeAuthStatus, signInToClaude } from "./claudeAuth";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { ClaudeSdkBackendProcess } from "@/agentMode/sdk/ClaudeSdkBackendProcess";
import { getCachedSdkCatalog, synthesizeEffortConfigOption } from "@/agentMode/sdk/effortOption";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { buildCopilotPlusEnv } from "@/agentMode/backends/shared/copilotPlusEnv";
import type {
  BackendConfigOption,
  EnabledModelEntry,
  ModeMapping,
  ModelSelection,
  ModelWireCodec,
} from "@/agentMode/session/types";
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";
import { ClaudeInstallModal } from "./ClaudeInstallModal";
import ClaudeLogo from "./logo.svg";
import { ClaudeSettingsPanel } from "./ClaudeSettingsPanel";

export const CLAUDE_INSTALL_COMMAND =
  process.platform === "win32"
    ? "irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex"
    : "npm install -g @anthropic-ai/claude-code";

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
export const ClaudeBackendDescriptor: BackendDescriptor = {
  id: "claude",
  displayName: "Claude",
  Icon: ClaudeLogo,
  skillsProjectDir: ".claude/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  // The Claude SDK adapter re-reads the composed system prompt per
  // `newSession()`, so a new chat picks up prompt changes without a restart.
  restartOnSystemPromptChange: false,
  wire: claudeWire,
  showModelDescriptions: true,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    // All Claude Code models are agent-origin.
    return [
      ...agentOriginEnabledModelEntries(settings, "claude", (wireId) => claudeWire.decode(wireId)),
    ];
  },

  getInstallState(settings: CopilotSettings): InstallState {
    const path = resolveClaudeCliPath(settings);
    if (!path) return { kind: "absent" };
    return {
      kind: "ready",
      source: settings.agentMode?.claudeCli?.path ? "custom" : "managed",
    };
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return resolveClaudeCliPath(settings);
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      if (prev.agentMode?.claudeCli?.path !== next.agentMode?.claudeCli?.path) {
        cb();
      }
    });
  },

  openInstallUI(plugin: CopilotPlugin): void {
    new ClaudeInstallModal(plugin.app).open();
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

  async applySelection(session: AgentSession, selection: ModelSelection): Promise<void> {
    // Claude's wire id is just the baseModelId — effort travels through
    // `setConfigOption`, not the model id. Skip the model round-trip when
    // the base hasn't changed, otherwise effort-only ticks would fire a
    // pointless `setSessionModel` on every slider drag.
    const currentBase = session.getState()?.model?.current.baseModelId;
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
      // Decrypted Copilot Plus license for builtin skill scripts. Passed as a
      // callback so `sdk/` need not import `backends/` (lint boundary).
      getManagedEnv: () => buildCopilotPlusEnv(args.clientVersion),
      checkAuth: async () =>
        (await getClaudeAuthStatus(claudePath, claudeChildEnv(getSettings()))).loggedIn,
      isPlanModePlanFilePath: isClaudePlanModePlanFilePath,
      getDefaultModelId: () => getSettings().agentMode?.backends?.claude?.defaultModel?.baseModelId,
      // Forward the shared composed system prompt — the Copilot base framing
      // (unless the user disabled it), the pill-syntax directive, and the
      // user's custom prompt. The SDK appends it to its `claude_code` preset
      // (see `ClaudeSdkBackendProcess`), so Claude keeps its tool/planning
      // framing while gaining the Obsidian-vault identity. Re-read per
      // `newSession()`, so a prompt change applies to the next session.
      //
      // Claude discovers skills natively from `.claude/skills/`, so the payload
      // carries no SKILL.md authoring instructions. Claude has no
      // cross-discovery surface — it only loads `.claude/skills/`, and the
      // symlink fanout already enforces visibility (no link = not seen). If the
      // Claude Agent SDK ever grows a per-skill deny hook, wire
      // `composeDenyList(getManagedSkills(), "claude")` in here.
      getSystemPromptAppend: () => buildAgentSystemPrompt(),
    });
  },

  SettingsPanel: ClaudeSettingsPanel,

  /**
   * Map Copilot's canonical modes onto the SDK's `PermissionMode` strings.
   * `acceptEdits` / `dontAsk` exist upstream but stay hidden — the picker is
   * a 3-mode UI (default / plan / auto). The session adapter normalizes
   * unknown ids to `default`.
   */
  getModeMapping(): ModeMapping {
    return {
      kind: "setMode",
      canonical: {
        default: "default",
        plan: "plan",
        auto: "bypassPermissions",
      },
    };
  },

  /**
   * Replay the persisted effort on a freshly created session. The Claude
   * SDK adapter probes the model catalog asynchronously, so the effort
   * `SessionConfigOption` may not be present yet when this runs;
   * `replayPersistedEffort` subscribes to the session and applies once the
   * option arrives (with a timeout guard to avoid leaking listeners on
   * agents that never report effort). Mode is never persisted — the
   * Claude SDK's natural starting mode is already canonical `default`.
   */
  async applyInitialSessionConfig(session: AgentSession, settings: CopilotSettings): Promise<void> {
    const persistedEffort = settings.agentMode?.backends?.claude?.defaultModel?.effort ?? null;
    await replayPersistedEffort(session, persistedEffort ?? undefined);
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
