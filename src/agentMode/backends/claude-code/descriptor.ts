import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { z } from "zod";
import { logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import {
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type ClaudeCodeBackendSettings,
  type CopilotSettings,
} from "@/settings/model";
import { ClaudeCodeBackend } from "./ClaudeCodeBackend";
import { ClaudeCodeInstallModal } from "./ClaudeCodeInstallModal";
import { ClaudeCodeSettingsPanel } from "./ClaudeCodeSettingsPanel";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import { binaryPathInstallState } from "@/agentMode/backends/_shared/simpleBinaryBackend";
import type { BackendMetaParser, NormalizedToolCallMeta } from "@/agentMode/session/backendMeta";
import type { CopilotMode, ModeMapping } from "@/agentMode/session/modeAdapter";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";

// Wire shape of `_meta` on Claude Code's session/update notifications. All
// fields are optional — not every frame carries every key (e.g.
// `parentToolUseId` only appears on sub-tool calls spawned by `Task`).
const ClaudeCodeMetaSchema = z.object({
  claudeCode: z.object({
    toolName: z.string().optional(),
    parentToolUseId: z.string().optional(),
    toolResponse: z.unknown().optional(),
  }),
});

const claudeCodeMetaParser: BackendMetaParser = {
  parseToolCallMeta(meta): NormalizedToolCallMeta | null {
    const parsed = ClaudeCodeMetaSchema.safeParse(meta);
    if (!parsed.success) return null;
    const cc = parsed.data.claudeCode;
    return {
      vendorToolName: cc.toolName,
      isPlanProposal: cc.toolName === "ExitPlanMode",
      parentToolCallId: cc.parentToolUseId,
    };
  },
};

export const CLAUDE_CODE_BINARY_NAME = "claude-agent-acp";
export const CLAUDE_CODE_INSTALL_COMMAND = "npm install -g @agentclientprotocol/claude-agent-acp";

export function updateClaudeCodeFields(partial: Partial<ClaudeCodeBackendSettings>): void {
  updateAgentModeBackendFields("claude-code", partial);
}

/**
 * Claude Code backend — wraps `@agentclientprotocol/claude-agent-acp`, which
 * inherits auth from the local `claude` CLI login. Independent of Copilot's
 * `activeModels` / BYOK keys, so the picker is fed entirely by live
 * `availableModels` (active session or preloader cache).
 */
export const ClaudeCodeBackendDescriptor: BackendDescriptor = {
  id: "claude-code",
  displayName: "Claude Code",
  meta: claudeCodeMetaParser,

  getInstallState(settings: CopilotSettings): InstallState {
    return binaryPathInstallState(settings.agentMode?.backends?.["claude-code"]?.binaryPath);
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      if (
        prev.agentMode?.backends?.["claude-code"]?.binaryPath !==
        next.agentMode?.backends?.["claude-code"]?.binaryPath
      ) {
        cb();
      }
    });
  },

  openInstallUI(plugin: CopilotPlugin): void {
    new ClaudeCodeInstallModal(plugin.app).open();
  },

  createBackend(): ClaudeCodeBackend {
    return new ClaudeCodeBackend();
  },

  SettingsPanel: ClaudeCodeSettingsPanel,

  getPreferredModelId(settings: CopilotSettings): string | undefined {
    const key = settings.agentMode?.backends?.["claude-code"]?.selectedModelKey;
    return key && key.length > 0 ? key : undefined;
  },

  async persistModelSelection(modelId: string, _plugin: CopilotPlugin): Promise<void> {
    updateClaudeCodeFields({ selectedModelKey: modelId });
  },

  /**
   * Claude-code-acp emits effort as a `SessionConfigOption` with
   * `id: "effort"` and `category: "effort"`. The reserved spec category for
   * the same concept is `"thought_level"` — accept both so future
   * spec-conformant agents Just Work.
   */
  findEffortConfigOption(opts: SessionConfigOption[] | null): SessionConfigOption | null {
    if (!opts) return null;
    const match = opts.find(
      (o) =>
        o.type === "select" &&
        (o.id === "effort" || o.category === "thought_level" || o.category === "effort")
    );
    return match ?? null;
  },

  async persistEffortSelection(value: string, _plugin: CopilotPlugin): Promise<void> {
    updateClaudeCodeFields({ selectedEffort: value });
  },

  /**
   * Map Copilot's canonical modes onto Claude Code's permission modes.
   * `acceptEdits` exists upstream but is intentionally hidden — callers
   * asked for a 3-mode picker. The mode adapter filters against the agent's
   * advertised list, so we just return the static mapping here.
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
    updateClaudeCodeFields({ selectedMode: value });
  },

  /**
   * Replay persisted effort + mode on a freshly created session. The two
   * concerns are independent, so they run in parallel — halving cold-start
   * latency when both are set.
   */
  async applyInitialSessionConfig(session: AgentSession, settings: CopilotSettings): Promise<void> {
    const claudeSettings = settings.agentMode?.backends?.["claude-code"];
    await Promise.all([
      replayPersistedEffort(session, claudeSettings?.selectedEffort),
      replayPersistedMode(session, claudeSettings?.selectedMode ?? "default"),
    ]);
  },

  // No probeSessionId persistence: claude-agent-acp only writes session JSONL
  // after a prompt exchange, so a models-only probe never persists — storing
  // the id would log "Resource not found" on every reload's session/load.
};

async function replayPersistedEffort(
  session: AgentSession,
  persistedEffort: string | undefined
): Promise<void> {
  if (!persistedEffort) return;
  const opt = ClaudeCodeBackendDescriptor.findEffortConfigOption?.(session.getConfigOptions());
  if (!opt || opt.type !== "select") return;
  if (String(opt.currentValue) === persistedEffort) return;
  // Validate the persisted value is still offered; the catalog can change
  // (e.g. switched to a non-reasoning model that no longer offers it).
  const flat = opt.options.flatMap((o) => ("options" in o ? o.options : [o]));
  if (!flat.some((o) => o.value === persistedEffort)) return;
  try {
    await session.setConfigOption(opt.id, persistedEffort);
  } catch (e) {
    if (e instanceof MethodUnsupportedError) return;
    logWarn(`[AgentMode] could not apply preferred effort ${persistedEffort}`, e);
  }
}

async function replayPersistedMode(
  session: AgentSession,
  persistedMode: CopilotMode
): Promise<void> {
  const modeState = session.getModeState();
  if (!modeState) return;
  const mapping = ClaudeCodeBackendDescriptor.getModeMapping?.(
    modeState,
    session.getConfigOptions()
  );
  const native = mapping?.canonical[persistedMode];
  if (!native || modeState.currentModeId === native) return;
  try {
    await session.setMode(native);
  } catch (e) {
    if (e instanceof MethodUnsupportedError) return;
    logWarn(`[AgentMode] could not apply preferred mode ${persistedMode}`, e);
  }
}
