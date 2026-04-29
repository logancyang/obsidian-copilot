import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import {
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type ClaudeCodeBackendSettings,
  type CopilotMode,
  type CopilotSettings,
} from "@/settings/model";
import { ClaudeCodeBackend } from "./ClaudeCodeBackend";
import { ClaudeCodeInstallModal } from "./ClaudeCodeInstallModal";
import { ClaudeCodeSettingsPanel } from "./ClaudeCodeSettingsPanel";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import type { ModeMapping } from "@/agentMode/session/modeAdapter";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";

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

  getInstallState(settings: CopilotSettings): InstallState {
    const binaryPath = settings.agentMode?.backends?.["claude-code"]?.binaryPath;
    if (!binaryPath) return { kind: "absent" };
    return { kind: "ready", source: "custom" };
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
        build: "default",
        plan: "plan",
        "auto-build": "bypassPermissions",
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
      replayPersistedMode(session, claudeSettings?.selectedMode),
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
  persistedMode: CopilotMode | undefined
): Promise<void> {
  if (!persistedMode) return;
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
