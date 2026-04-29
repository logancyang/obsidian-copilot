import type { SessionConfigOption } from "@agentclientprotocol/sdk";
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
    return { kind: "ready", version: "custom", source: "custom" };
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
   * Replay the persisted effort on a freshly created session. Skipped when
   * the agent doesn't expose an effort option yet (effort options can be
   * model-dependent — they only appear after the model resolves).
   */
  async applyInitialSessionConfig(session: AgentSession, settings: CopilotSettings): Promise<void> {
    const persisted = settings.agentMode?.backends?.["claude-code"]?.selectedEffort;
    if (!persisted) return;
    const opt = ClaudeCodeBackendDescriptor.findEffortConfigOption?.(session.getConfigOptions());
    if (!opt || opt.type !== "select") return;
    if (String(opt.currentValue) === persisted) return;
    // Validate that the persisted value is still offered by the agent;
    // skip silently if the catalog changed (e.g. switched to a non-reasoning
    // model that no longer offers the previously-picked effort).
    const flat = opt.options.flatMap((o) => ("options" in o ? o.options : [o]));
    if (!flat.some((o) => o.value === persisted)) return;
    try {
      await session.setConfigOption(opt.id, persisted);
    } catch (e) {
      if (e instanceof MethodUnsupportedError) return;
      logWarn(`[AgentMode] could not apply preferred effort ${persisted}`, e);
    }
  },

  // No probeSessionId persistence: claude-agent-acp only writes session JSONL
  // after a prompt exchange, so a models-only probe never persists — storing
  // the id would log "Resource not found" on every reload's session/load.
};
