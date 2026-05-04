import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
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
import { resolveClaudeBinary } from "./claudeBinaryResolver";
import { ClaudeSdkBackendProcess } from "@/agentMode/sdk/ClaudeSdkBackendProcess";
import {
  probeClaudeSdkCatalog,
  resolveSeedModelId,
  synthesizeEffortConfigOption,
} from "@/agentMode/sdk/effortOption";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { BackendMetaParser, NormalizedToolCallMeta } from "@/agentMode/session/backendMeta";
import type { CopilotMode, ModeMapping } from "@/agentMode/session/modeAdapter";
import type {
  BackendDescriptor,
  BackendInitialState,
  BackendProcess,
  InstallState,
} from "@/agentMode/session/types";
import { ClaudeInstallModal } from "./ClaudeInstallModal";
import { ClaudeSettingsPanel } from "./ClaudeSettingsPanel";
import { openAskUserQuestionModal } from "./AskUserQuestionModal";

/**
 * Wire shape of `_meta` we synthesize on translator-emitted tool_call
 * notifications. The SDK adapter mints these so existing
 * `permissionPrompter.isExitPlanModePermission` and the action-card trail
 * routing work without changes.
 */
const ClaudeMetaSchema = z.object({
  claude: z.object({
    toolName: z.string().optional(),
    parentToolUseId: z.string().optional(),
  }),
});

const claudeMetaParser: BackendMetaParser = {
  parseToolCallMeta(meta): NormalizedToolCallMeta | null {
    const parsed = ClaudeMetaSchema.safeParse(meta);
    if (!parsed.success) return null;
    const cc = parsed.data.claude;
    return {
      vendorToolName: cc.toolName,
      isPlanProposal: cc.toolName === "ExitPlanMode",
      parentToolCallId: cc.parentToolUseId,
    };
  },
};

export const CLAUDE_INSTALL_COMMAND = "npm install -g @anthropic-ai/claude-code";

export function updateClaudeFields(partial: Partial<ClaudeBackendSettings>): void {
  updateAgentModeBackendFields("claude", partial);
}

function readPreferredClaudeModel(settings: CopilotSettings): string | undefined {
  const key = settings.agentMode?.backends?.claude?.selectedModelKey;
  return key && key.length > 0 ? key : undefined;
}

/**
 * Resolve the `claude` CLI path from settings + auto-detection. Mirrors the
 * `getInstallState` logic: explicit override wins, otherwise the resolver
 * walks Volta/asdf/NVM/Homebrew/npm-global.
 */
export function resolveClaudeCliPath(settings: CopilotSettings): string | null {
  const override = settings.agentMode?.claudeCli?.path;
  return resolveClaudeBinary({
    override,
    homeDir: os.homedir(),
    platform: process.platform,
    env: {
      NVM_BIN: process.env.NVM_BIN,
      npm_config_prefix: process.env.npm_config_prefix,
      APPDATA: process.env.APPDATA,
    },
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
    },
  });
}

/**
 * Static slice of the descriptor's initial state. **Models live in the SDK,
 * not here** — we never hardcode their names/ids because the bundled
 * `claude` CLI ships new models on its own cadence; baking ids into the
 * plugin would silently break compatibility on every CLI release.
 *
 * What stays static: the canonical permission modes (default / plan /
 * bypassPermissions). These map to the SDK's `PermissionMode` enum,
 * which is part of the SDK *type* contract — stable across CLI revs.
 *
 * Models + effort `configOptions` are populated dynamically by
 * `probeInitialState` (preload phase) and surfaced through
 * `AgentModelPreloader`'s cache.
 */
const STATIC_MODES_AND_CONFIG: BackendInitialState = {
  models: null,
  modes: {
    currentModeId: "default",
    availableModes: [
      { id: "default", name: "Default" },
      { id: "plan", name: "Plan" },
      { id: "bypassPermissions", name: "Auto" },
    ],
  },
  configOptions: null,
};

/**
 * Plugin-lifetime cache of the SDK's model catalog. Populated by
 * `probeInitialState` during the preload phase (typically once per
 * plugin load) and read by `createBackendProcess` so each session
 * starts with a known catalog instead of triggering its own probe.
 */
let cachedSdkCatalog: ModelInfo[] | null = null;

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
  meta: claudeMetaParser,

  getInstallState(settings: CopilotSettings): InstallState {
    const path = resolveClaudeCliPath(settings);
    if (!path) return { kind: "absent" };
    return {
      kind: "ready",
      source: settings.agentMode?.claudeCli?.path ? "custom" : "managed",
    };
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

  isPlanModePlanFilePath(absolutePath: string): boolean {
    return isClaudePlanModePlanFilePath(absolutePath);
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
      askUserQuestion: (questions) => openAskUserQuestionModal(args.app, questions),
      getEnableThinking: () => Boolean(getSettings().agentMode?.backends?.claude?.enableThinking),
      isPlanModePlanFilePath: isClaudePlanModePlanFilePath,
      getCachedCatalog: () => cachedSdkCatalog,
      getPreferredModelId: () => readPreferredClaudeModel(getSettings()),
    });
  },

  SettingsPanel: ClaudeSettingsPanel,

  getStaticInitialState(): BackendInitialState | null {
    return STATIC_MODES_AND_CONFIG;
  },

  /**
   * Run the SDK's `initializationResult()` handshake to fetch the live
   * model catalog (the bundled `claude` CLI is the source of truth) and
   * synthesize an effort `SessionConfigOption` for the user's preferred
   * (or catalog-default) model. Result feeds the preloader cache so the
   * picker has both populated immediately when the chat UI mounts.
   *
   * The catalog is also retained in `cachedSdkCatalog` so
   * `createBackendProcess` can hand it to `ClaudeSdkBackendProcess`
   * without re-probing per session.
   */
  async probeInitialState(_plugin: CopilotPlugin): Promise<BackendInitialState | null> {
    const claudePath = resolveClaudeCliPath(getSettings());
    if (!claudePath) return STATIC_MODES_AND_CONFIG;
    const catalog = await probeClaudeSdkCatalog(claudePath);
    if (catalog.length === 0) return STATIC_MODES_AND_CONFIG;
    cachedSdkCatalog = catalog;

    const currentModelId =
      resolveSeedModelId(catalog, readPreferredClaudeModel(getSettings())) ?? catalog[0].value;
    const modelInfo = catalog.find((m) => m.value === currentModelId);
    const effortOpt = synthesizeEffortConfigOption(modelInfo, undefined);

    return {
      models: {
        currentModelId,
        availableModels: catalog.map((m) => ({ modelId: m.value, name: m.displayName })),
      },
      modes: STATIC_MODES_AND_CONFIG.modes,
      configOptions: effortOpt ? [effortOpt] : null,
    };
  },

  getPreferredModelId(settings: CopilotSettings): string | undefined {
    return readPreferredClaudeModel(settings);
  },

  async persistModelSelection(modelId: string, _plugin: CopilotPlugin): Promise<void> {
    updateClaudeFields({ selectedModelKey: modelId });
  },

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

  async persistModeSelection(value: CopilotMode, _plugin: CopilotPlugin): Promise<void> {
    updateClaudeFields({ selectedMode: value });
  },

  /**
   * The Claude SDK adapter synthesizes a single-select effort
   * `SessionConfigOption` from the SDK's per-model
   * `ModelInfo.supportedEffortLevels`. We accept either the spec-conformant
   * `category: "thought_level"` (preferred) or `category: "effort"` /
   * `id: "effort"` (legacy claude-code-acp parity), so the picker keeps
   * working if the SDK adapter is later replaced or if the spec category
   * changes upstream.
   */
  findEffortConfigOption(opts) {
    if (!opts) return null;
    return (
      opts.find(
        (o) =>
          o.type === "select" &&
          (o.id === "effort" || o.category === "thought_level" || o.category === "effort")
      ) ?? null
    );
  },

  async persistEffortSelection(value: string, _plugin: CopilotPlugin): Promise<void> {
    updateClaudeFields({ selectedEffort: value });
  },

  /**
   * Replay persisted mode + effort on a freshly created session. The
   * Claude SDK adapter probes the model catalog asynchronously, so the
   * effort `SessionConfigOption` may not be present yet when this runs;
   * `replayPersistedEffort` subscribes to the session and applies once the
   * option arrives (with a timeout guard to avoid leaking listeners on
   * agents that never report effort).
   */
  async applyInitialSessionConfig(session: AgentSession, settings: CopilotSettings): Promise<void> {
    const claudeSettings = settings.agentMode?.backends?.claude;
    await Promise.all([
      replayPersistedMode(session, claudeSettings?.selectedMode ?? "default"),
      replayPersistedEffort(session, claudeSettings?.selectedEffort),
    ]);
  },
};

async function replayPersistedEffort(
  session: AgentSession,
  persistedEffort: string | undefined
): Promise<void> {
  if (!persistedEffort) return;
  const tryApply = async (opt: ReturnType<AgentSession["getConfigOptions"]>): Promise<boolean> => {
    const found = ClaudeBackendDescriptor.findEffortConfigOption?.(opt);
    if (!found || found.type !== "select") return false;
    if (String(found.currentValue) === persistedEffort) return true;
    const flat = found.options.flatMap((o) => ("options" in o ? o.options : [o]));
    if (!flat.some((o) => o.value === persistedEffort)) return true;
    try {
      await session.setConfigOption(found.id, persistedEffort);
    } catch (e) {
      if (e instanceof MethodUnsupportedError) return true;
      logWarn(`[AgentMode] could not apply preferred effort ${persistedEffort}`, e);
    }
    return true;
  };

  if (await tryApply(session.getConfigOptions())) return;

  // Probe is still in flight — wait for the first config_option_update.
  // Bound the wait so we don't keep a listener alive on agents that never
  // emit an effort option.
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      unsub();
      clearTimeout(timer);
      resolve();
    };
    const unsub = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: () => {},
      onModelChanged: () => {
        void tryApply(session.getConfigOptions()).then((applied) => {
          if (applied) finish();
        });
      },
    });
    const timer = setTimeout(finish, 10_000);
  });
}

async function replayPersistedMode(
  session: AgentSession,
  persistedMode: CopilotMode
): Promise<void> {
  const modeState = session.getModeState();
  if (!modeState) return;
  const mapping = ClaudeBackendDescriptor.getModeMapping?.(modeState, session.getConfigOptions());
  const native = mapping?.canonical[persistedMode];
  if (!native || modeState.currentModeId === native) return;
  try {
    await session.setMode(native);
  } catch (e) {
    if (e instanceof MethodUnsupportedError) return;
    logWarn(`[AgentMode] could not apply preferred mode ${persistedMode}`, e);
  }
}
