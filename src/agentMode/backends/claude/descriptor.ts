import * as fs from "node:fs";
import * as os from "node:os";
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
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import { resolveClaudeBinary } from "@/agentMode/sdk/claudeBinaryResolver";
import { ClaudeSdkBackendProcess } from "@/agentMode/sdk/ClaudeSdkBackendProcess";
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
 * Static catalog of SDK-supported Claude models. The picker uses this so it
 * has something to show before the first turn populates the live list.
 *
 * TODO: Refresh this from `query.supportedModels()` once a session exists so
 * the list stays in sync with whatever the spawned `claude` CLI actually
 * supports. For v1 we keep the catalog small and static so onboarding works
 * without a network round-trip.
 */
const STATIC_MODELS: BackendInitialState = {
  models: {
    currentModelId: "claude-opus-4-7",
    availableModels: [
      { modelId: "claude-opus-4-7", name: "Claude Opus 4.7" },
      { modelId: "claude-opus-4-6", name: "Claude Opus 4.6" },
      { modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { modelId: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ],
  },
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
    });
  },

  SettingsPanel: ClaudeSettingsPanel,

  getStaticInitialState(): BackendInitialState | null {
    return STATIC_MODELS;
  },

  getPreferredModelId(settings: CopilotSettings): string | undefined {
    const key = settings.agentMode?.backends?.claude?.selectedModelKey;
    return key && key.length > 0 ? key : undefined;
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
   * Replay persisted mode on a freshly created session. Effort is not
   * surfaced as a `SessionConfigOption` for the SDK adapter (the underlying
   * concept is `thinking: { type: "adaptive" }` set at query time), so only
   * mode is replayed here.
   */
  async applyInitialSessionConfig(session: AgentSession, settings: CopilotSettings): Promise<void> {
    const claudeSettings = settings.agentMode?.backends?.claude;
    await replayPersistedMode(session, claudeSettings?.selectedMode ?? "default");
  },
};

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
