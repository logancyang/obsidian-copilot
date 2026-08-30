import type CopilotPlugin from "@/main";
import { requireNodeModule } from "@/utils/desktopRuntime";
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
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  EnabledModelEntry,
  ModelSelection,
  ModelWireCodec,
  PermissionOption,
} from "@/agentMode/session/types";
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";
import { codexAcpSearchDirs, resolveCodexAcpBinary } from "./codexBinaryResolver";
import { buildCodexModeMapping } from "./codexModeMapping";
import { isSupportedCodexAcpPath, resolveSupportedCodexAcpEntry } from "./codexVersion";

/**
 * Vocabulary mirrors codex-acp's advertised efforts. `minimal` is included
 * for forward-compat — codex CLI accepts it as a reasoning level even though
 * codex-acp doesn't currently advertise it.
 */
const KNOWN_CODEX_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

export function updateCodexFields(partial: Partial<CodexBackendSettings>): void {
  updateAgentModeBackendFields("codex", partial);
}

function codexAcpResolverEnv(): Parameters<typeof resolveCodexAcpBinary>[0] {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
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

export async function detectCodexAcpPath(): Promise<string | null> {
  return resolveCodexAcpBinary(codexAcpResolverEnv(), (candidate) => {
    try {
      resolveSupportedCodexAcpEntry(candidate);
      return true;
    } catch {
      return false;
    }
  });
}

export function codexAcpDetectionSearchDirs(): string[] {
  return codexAcpSearchDirs(codexAcpResolverEnv());
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
 * Codex backend — wraps the configured `codex-acp`, which inherits auth from
 * the Codex CLI login. Auth is CLI-owned (no Copilot-side keys),
 * so the candidate models come entirely from the CLI's live `availableModels`
 * (active session or preloader cache); curation is the model-management
 * `backends.codex.enabledModels` set surfaced via `getEnabledModelEntries`.
 *
 * Effort is surfaced via opencode-style model-id parsing — codex-acp
 * advertises one model per (base × effort) combination, and we collapse
 * them into a single picker row plus a sibling effort dropdown.
 */
export const CodexBackendDescriptor: BackendDescriptor = {
  id: "codex",
  displayName: "Codex",
  Icon: CodexLogo,
  // Cloud agent — flagged with a cloud-egress warning while Self-Host Mode is on.
  selfHostable: false,
  routesCopilotModels: false,
  setupDescription:
    "OpenAI models, billed to your ChatGPT subscription. Runs the codex-acp adapter on your machine.",
  skillsProjectDir: ".agents/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  restartOnSystemPromptChange: true,
  // codex names a session after the raw first prompt (which leaks the injected
  // context envelope), so the session derives the tab title client-side instead.
  summarizesSessionTitle: false,
  wire: codexWire,
  showModelDescriptions: true,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    // All Codex models are agent-origin.
    return [
      ...agentOriginEnabledModelEntries(settings, "codex", (wireId) => codexWire.decode(wireId)),
    ];
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

  presentPermissionOption(option: PermissionOption, metadata: unknown): PermissionOption {
    const decision = codexPermissionDecision(metadata);
    const isExecpolicyAmendment =
      decision === "acceptWithExecpolicyAmendment" && option.kind === "allow_always";
    const isNetworkPolicyAmendment =
      decision === "applyNetworkPolicyAmendment" &&
      (option.kind === "allow_always" || option.kind === "reject_always");
    if (!isExecpolicyAmendment && !isNetworkPolicyAmendment) return option;

    return {
      ...option,
      name: option.kind === "reject_always" ? "Block Always" : "Allow Always",
      description: option.name,
    };
  },

  getInstallState(settings: CopilotSettings): InstallState {
    return isSupportedCodexAcpPath(settings.agentMode?.backends?.codex?.binaryPath)
      ? { kind: "ready", source: "custom" }
      : { kind: "absent" };
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return settings.agentMode?.backends?.codex?.binaryPath ?? null;
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
    await session.applyModelWireId(codexWire.encode(selection));
  },

  createBackendProcess(args): BackendProcess {
    // Codex sees managed skills only via the `.agents/skills/<name>`
    // symlink. The per-agent toggle drives whether the symlink exists; no
    // deny synthesis is needed because Codex does not cross-discover from
    // `.claude/skills/` or `.opencode/skills/`.
    return simpleBinaryBackendProcess(args, new CodexBackend(args.clientVersion));
  },

  SettingsPanel: CodexSettingsPanel,

  getModeMapping(modeState) {
    return buildCodexModeMapping(modeState);
  },
};

function codexPermissionDecision(metadata: unknown): unknown {
  if (metadata === null || typeof metadata !== "object") return undefined;
  const codex = (metadata as Record<string, unknown>).codex;
  if (codex === null || typeof codex !== "object") return undefined;
  return (codex as Record<string, unknown>).decision;
}
