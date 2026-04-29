import { logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import {
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type CodexBackendSettings,
  type CopilotMode,
  type CopilotSettings,
} from "@/settings/model";
import { CodexBackend } from "./CodexBackend";
import { CodexInstallModal } from "./CodexInstallModal";
import { CodexSettingsPanel } from "./CodexSettingsPanel";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/acp/types";
import type { ModeMapping } from "@/agentMode/session/modeAdapter";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";

export const CODEX_BINARY_NAME = "codex-acp";
export const CODEX_INSTALL_COMMAND = "npm install -g @zed-industries/codex-acp";

/**
 * Vocabulary mirrors codex-acp's advertised efforts. `minimal` is included
 * for forward-compat — codex CLI accepts it as a reasoning level even though
 * codex-acp doesn't currently advertise it.
 */
const KNOWN_CODEX_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

export function updateCodexFields(partial: Partial<CodexBackendSettings>): void {
  updateAgentModeBackendFields("codex", partial);
}

/**
 * Codex backend — wraps `@zed-industries/codex-acp`, which inherits auth
 * from the local `codex` CLI login. Independent of Copilot's
 * `activeModels` / BYOK keys, so the picker is fed entirely by live
 * `availableModels` (active session or preloader cache).
 *
 * Effort is surfaced via opencode-style model-id parsing — codex-acp
 * advertises one model per (base × effort) combination, and we collapse
 * them into a single picker row plus a sibling effort dropdown.
 */
export const CodexBackendDescriptor: BackendDescriptor = {
  id: "codex",
  displayName: "Codex",

  getInstallState(settings: CopilotSettings): InstallState {
    const binaryPath = settings.agentMode?.backends?.codex?.binaryPath;
    if (!binaryPath) return { kind: "absent" };
    return { kind: "ready", version: "custom", source: "custom" };
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      if (
        prev.agentMode?.backends?.codex?.binaryPath !== next.agentMode?.backends?.codex?.binaryPath
      ) {
        cb();
      }
    });
  },

  openInstallUI(plugin: CopilotPlugin): void {
    new CodexInstallModal(plugin.app).open();
  },

  createBackend(): CodexBackend {
    return new CodexBackend();
  },

  SettingsPanel: CodexSettingsPanel,

  getPreferredModelId(settings: CopilotSettings): string | undefined {
    const key = settings.agentMode?.backends?.codex?.selectedModelKey;
    return key && key.length > 0 ? key : undefined;
  },

  async persistModelSelection(modelId: string, _plugin: CopilotPlugin): Promise<void> {
    updateCodexFields({ selectedModelKey: modelId });
  },

  parseEffortFromModelId(modelId: string): { baseId: string; effort: string | null } | null {
    if (!modelId) return null;
    const segments = modelId.split("/");
    if (segments.length === 1) return { baseId: modelId, effort: null };
    if (segments.length === 2 && KNOWN_CODEX_EFFORTS.has(segments[1])) {
      return { baseId: segments[0], effort: segments[1] };
    }
    return null;
  },

  composeModelId(baseId: string, effort: string | null): string {
    return effort ? `${baseId}/${effort}` : baseId;
  },

  /**
   * Codex exposes only sandbox/approval presets via ACP setMode: `read-only`,
   * `auto`, and `full-access`. Map the two we care about and skip plan. The
   * mode adapter filters against the agent's advertised list.
   *
   * NOTE: Codex CLI has a real `ModeKind::Plan` reachable via its app-server
   * JSON-RPC (`turn/start.collaborationMode`), but `@zed-industries/codex-acp`
   * links codex_core as a Rust library and translates ACP modes to
   * `Op::OverrideTurnContext { approval_policy, sandbox_policy }` — there's
   * no `collaborationMode` field in `Op`. Plan is unreachable through this
   * adapter. Tracking issue: depends on upstream codex-acp adoption of
   * collaboration modes.
   */
  getModeMapping(): ModeMapping {
    return {
      kind: "setMode",
      canonical: { build: "auto", "auto-build": "full-access" },
    };
  },

  async persistModeSelection(value: CopilotMode, _plugin: CopilotPlugin): Promise<void> {
    updateCodexFields({ selectedMode: value });
  },

  /**
   * Replay the persisted mode on a freshly created session. Skipped when
   * the agent doesn't advertise modes. Plan is silently dropped (Codex
   * adapter doesn't expose it; see `getModeMapping`).
   */
  async applyInitialSessionConfig(session: AgentSession, settings: CopilotSettings): Promise<void> {
    const persistedMode = settings.agentMode?.backends?.codex?.selectedMode;
    if (!persistedMode) return;
    const modeState = session.getModeState();
    if (!modeState) return;
    const native = CodexBackendDescriptor.getModeMapping?.(modeState, session.getConfigOptions())
      ?.canonical[persistedMode];
    if (!native || modeState.currentModeId === native) return;
    try {
      await session.setMode(native);
    } catch (e) {
      if (e instanceof MethodUnsupportedError) return;
      logWarn(`[AgentMode] could not apply preferred mode ${persistedMode}`, e);
    }
  },
};
