import type CopilotPlugin from "@/main";
import {
  setSettings,
  subscribeToSettingsChange,
  type ClaudeCodeBackendSettings,
  type CopilotSettings,
} from "@/settings/model";
import { ClaudeCodeBackend } from "./ClaudeCodeBackend";
import { ClaudeCodeInstallModal } from "./ClaudeCodeInstallModal";
import { ClaudeCodeSettingsPanel } from "./ClaudeCodeSettingsPanel";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";

export const CLAUDE_CODE_BINARY_NAME = "claude-agent-acp";
export const CLAUDE_CODE_INSTALL_COMMAND = "npm install -g @agentclientprotocol/claude-agent-acp";

/**
 * Read-modify-write helper for the `agentMode.backends["claude-code"]` slice.
 * Centralizes the nested spread so callers don't repeat the four-level onion.
 */
export function updateClaudeCodeFields(partial: Partial<ClaudeCodeBackendSettings>): void {
  setSettings((cur) => ({
    agentMode: {
      ...cur.agentMode,
      backends: {
        ...cur.agentMode.backends,
        "claude-code": {
          ...(cur.agentMode.backends?.["claude-code"] ?? {}),
          ...partial,
        },
      },
    },
  }));
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

  // No probeSessionId persistence: claude-agent-acp only writes session JSONL
  // after a prompt exchange, so a models-only probe never persists — storing
  // the id would log "Resource not found" on every reload's session/load.
};
