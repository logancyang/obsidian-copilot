import type CopilotPlugin from "@/main";
import {
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type CodexBackendSettings,
  type CopilotSettings,
} from "@/settings/model";
import { CodexBackend } from "./CodexBackend";
import { CodexInstallModal } from "./CodexInstallModal";
import CodexLogo from "./logo.svg";
import { CodexSettingsPanel } from "./CodexSettingsPanel";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { agentOriginEnabledWireIds } from "@/agentMode/backends/shared/agentEnabledModels";
import {
  binaryPathInstallState,
  simpleBinaryBackendProcess,
} from "@/agentMode/backends/shared/simpleBinaryBackend";
import type { ModeMapping, ModelSelection, ModelWireCodec } from "@/agentMode/session/types";
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";

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
 * Wire-format codec for Codex — `<base>[/<effort>]`. No provider segment
 * (Codex's catalog isn't routed through Copilot BYOK keys, so
 * `decode().provider` stays `null`).
 */
const codexWire: ModelWireCodec = {
  encode: (selection: ModelSelection) =>
    selection.effort ? `${selection.baseModelId}/${selection.effort}` : selection.baseModelId,
  decode: (wireId: string) => {
    if (!wireId) return { selection: { baseModelId: wireId, effort: null }, provider: null };
    const segments = wireId.split("/");
    if (segments.length === 1) {
      return { selection: { baseModelId: wireId, effort: null }, provider: null };
    }
    if (segments.length === 2 && KNOWN_CODEX_EFFORTS.has(segments[1])) {
      return {
        selection: { baseModelId: segments[0], effort: segments[1] },
        provider: null,
      };
    }
    return { selection: { baseModelId: wireId, effort: null }, provider: null };
  },
};

/**
 * Codex backend — wraps `@zed-industries/codex-acp`, which inherits auth
 * from the local `codex` CLI login. Auth is CLI-owned (no Copilot-side keys),
 * so the candidate models come entirely from the CLI's live `availableModels`
 * (active session or preloader cache); curation is the model-management
 * `backends.codex.enabledModels` set surfaced via `getEnabledBaseModelIds`.
 *
 * Effort is surfaced via opencode-style model-id parsing — codex-acp
 * advertises one model per (base × effort) combination, and we collapse
 * them into a single picker row plus a sibling effort dropdown.
 */
export const CodexBackendDescriptor: BackendDescriptor = {
  id: "codex",
  displayName: "Codex",
  Icon: CodexLogo,
  skillsProjectDir: ".agents/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  restartOnSystemPromptChange: true,
  wire: codexWire,
  showModelDescriptions: true,

  getEnabledBaseModelIds(settings: CopilotSettings): ReadonlySet<string> {
    // All Codex models are agent-origin.
    return agentOriginEnabledWireIds(settings, "codex", (wireId) => codexWire.decode(wireId));
  },

  /**
   * codex-acp reports inconsistently-cased names (`GPT-5.5` but also
   * `gpt-5.4`, `gpt-5.3-codex`). Uppercase only the anchored `gpt` prefix so
   * the column reads consistently — no family/token guessing, so the wire
   * ids and any mid-string tokens are left untouched.
   */
  normalizeModelName(name: string): string {
    return name.replace(/^gpt/i, "GPT");
  },

  getInstallState(settings: CopilotSettings): InstallState {
    return binaryPathInstallState(settings.agentMode?.backends?.codex?.binaryPath);
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

  async applySelection(session: AgentSession, selection: ModelSelection): Promise<void> {
    await session.setModel(codexWire.encode(selection));
  },

  createBackendProcess(args): BackendProcess {
    // Codex sees managed skills only via the `.agents/skills/<name>`
    // symlink. The per-agent toggle drives whether the symlink exists; no
    // deny synthesis is needed because Codex does not cross-discover from
    // `.claude/skills/` or `.opencode/skills/`.
    return simpleBinaryBackendProcess(args, new CodexBackend());
  },

  SettingsPanel: CodexSettingsPanel,

  /**
   * Codex exposes sandbox/approval presets via ACP setMode: `read-only`,
   * `auto`, and `full-access`. We surface all three:
   *   - build       → "auto"           (workspace-write, on-request approvals)
   *   - plan        → "read-only"      (no writes, no exec; closest ACP analog)
   *   - auto-build  → "full-access"    (no sandbox, no approvals)
   *
   * Note: this is a sandbox restriction, not Codex CLI's real `ModeKind::Plan`
   * (which would draft a plan artifact). That mode lives behind the app-server
   * `turn/start.collaborationMode` field, which `@zed-industries/codex-acp`
   * does not forward — it translates ACP modes to
   * `Op::OverrideTurnContext { approval_policy, sandbox_policy }` only.
   * Read-only is the closest available analog: the agent can read and reason
   * but cannot mutate the vault, which matches user intent for "Plan".
   */
  getModeMapping(): ModeMapping {
    return {
      kind: "setMode",
      canonical: { default: "auto", plan: "read-only", auto: "full-access" },
    };
  },
};
