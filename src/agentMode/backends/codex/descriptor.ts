import * as fs from "node:fs";
import * as os from "node:os";
import type CopilotPlugin from "@/main";
import {
  getSettings,
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
import { detectBinary } from "@/utils/detectBinary";
import { codexAcpSearchDirs, resolveCodexAcpBinary } from "./codexBinaryResolver";
import {
  CODEX_INSTALL_COMMAND,
  getCodexCompatibility,
  refreshCodexCompatibility,
  subscribeCodexCompatibility,
} from "./codexCompatibility";
import { buildCodexModeMapping } from "./codexModeMapping";

export const CODEX_BINARY_NAME = "codex-acp";
export { CODEX_INSTALL_COMMAND };

const ABSENT_INSTALL_STATE: InstallState = Object.freeze({ kind: "absent" });

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
  const envOverrides = getSettings().agentMode?.backends?.codex?.envOverrides;
  return {
    homeDir: os.homedir(),
    platform: process.platform,
    env: mergeCodexResolverEnvironment(process.env, envOverrides, process.platform),
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      readdirSync: (p) => fs.readdirSync(p),
    },
  };
}

function mergeCodexResolverEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  envOverrides: Record<string, string> = {},
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  if (platform !== "win32") return { ...baseEnv, ...envOverrides };

  const env = { ...baseEnv };
  let effectivePath = Object.entries(baseEnv).find(([key]) => key.toLowerCase() === "path")?.[1];
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") delete env[key];
  }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (key.toLowerCase() === "path") {
      effectivePath = value;
    } else {
      env[key] = value;
    }
  }
  if (effectivePath !== undefined) env.PATH = effectivePath;
  return env;
}

export async function detectCodexAcpPath(): Promise<string | null> {
  const fromResolver = resolveCodexAcpBinary(codexAcpResolverEnv());
  if (fromResolver) return fromResolver;
  return detectBinary(CODEX_BINARY_NAME);
}

export function codexAcpDetectionSearchDirs(): string[] {
  return codexAcpSearchDirs(codexAcpResolverEnv());
}

/**
 * Reads the selected Codex adapter's device-local compatibility state.
 * @param settings - The settings that select the adapter executable.
 * @param fileExists - The filesystem check used to reject synced paths missing on this device.
 */
export function getCodexInstallState(
  settings: CopilotSettings,
  fileExists: (binaryPath: string) => boolean = (binaryPath) => fs.existsSync(binaryPath)
): InstallState {
  const binaryPath = settings.agentMode?.backends?.codex?.binaryPath;
  if (!binaryPath || !fileExists(binaryPath)) return ABSENT_INSTALL_STATE;
  return getCodexCompatibility(binaryPath, settings.agentMode?.backends?.codex?.envOverrides);
}

/**
 * Rechecks the selected adapter after configuration or plugin lifecycle changes.
 * @param settings - The settings that select the adapter executable.
 * @param force - Whether a settled result should be checked again.
 * @param fileExists - The filesystem check used to reject missing executables before probing.
 */
export function refreshCodexInstallState(
  settings: CopilotSettings,
  force = false,
  fileExists: (binaryPath: string) => boolean = (binaryPath) => fs.existsSync(binaryPath)
): Promise<InstallState> {
  const binaryPath = settings.agentMode?.backends?.codex?.binaryPath;
  if (!binaryPath || !fileExists(binaryPath)) return Promise.resolve(ABSENT_INSTALL_STATE);
  return refreshCodexCompatibility(binaryPath, {
    force,
    envOverrides: settings.agentMode?.backends?.codex?.envOverrides,
  });
}

export function subscribeCodexInstallState(listener: () => void): () => void {
  return subscribeCodexCompatibility(() => {
    const codex = getSettings().agentMode?.backends?.codex;
    return codex?.binaryPath
      ? { binaryPath: codex.binaryPath, envOverrides: codex.envOverrides }
      : null;
  }, listener);
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
    return getCodexInstallState(settings);
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return settings.agentMode?.backends?.codex?.binaryPath ?? null;
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    const unsubscribeSettings = subscribeToSettingsChange((prev, next) => {
      if (
        prev.agentMode?.backends?.codex?.binaryPath !==
          next.agentMode?.backends?.codex?.binaryPath ||
        prev.agentMode?.backends?.codex?.envOverrides !==
          next.agentMode?.backends?.codex?.envOverrides
      ) {
        const refresh = refreshCodexInstallState(next, true);
        cb();
        void refresh;
      }
    });
    const unsubscribeCompatibility = subscribeCodexInstallState(cb);
    return () => {
      unsubscribeSettings();
      unsubscribeCompatibility();
    };
  },

  async onPluginLoad(): Promise<void> {
    await refreshCodexInstallState(getSettings(), true);
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
    return simpleBinaryBackendProcess(args, new CodexBackend());
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
