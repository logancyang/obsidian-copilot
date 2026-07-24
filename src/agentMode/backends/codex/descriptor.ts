import * as fs from "node:fs";
import * as os from "node:os";
import { CODEX_ACP_INSTALL_COMMAND, CODEX_ACP_MIGRATION_COMMAND } from "@/constants";
import { logError } from "@/logger";
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
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type { EnabledModelEntry, ModelSelection, ModelWireCodec } from "@/agentMode/session/types";
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";
import { detectBinary } from "@/utils/detectBinary";
import { CodexBinaryManager, codexProbeSettingsFingerprint } from "./CodexBinaryManager";
import {
  codexAcpSearchDirs,
  resolveCodexAcpBinary,
  resolveCodexAcpLauncher,
  type CodexAcpBinaryResolverInput,
} from "./codexBinaryResolver";
import { buildCodexModeMapping } from "./codexModeMapping";

export const CODEX_BINARY_NAME = "codex-acp";
export const CODEX_INSTALL_COMMAND = CODEX_ACP_INSTALL_COMMAND;
export const CODEX_MIGRATION_COMMAND = CODEX_ACP_MIGRATION_COMMAND;

let managerRef: CodexBinaryManager | null = null;
let managerNodePath: string | undefined;

/**
 * Vocabulary mirrors codex-acp's advertised efforts. `minimal` is included
 * for forward-compat — codex CLI accepts it as a reasoning level even though
 * codex-acp doesn't currently advertise it.
 */
const KNOWN_CODEX_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

export function updateCodexFields(partial: Partial<CodexBackendSettings>): void {
  updateAgentModeBackendFields("codex", partial);
}

function codexAcpResolverEnv(): CodexAcpBinaryResolverInput {
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

export function resolveCodexNodePath(input: CodexAcpBinaryResolverInput): string | undefined {
  const launcher = resolveCodexAcpLauncher(input);
  return launcher?.kind === "node" ? launcher.command : undefined;
}

export function getCodexBinaryManager(): CodexBinaryManager {
  const resolverEnv = codexAcpResolverEnv();
  const nodePath = resolveCodexNodePath(resolverEnv);
  if (!managerRef || managerNodePath !== nodePath) {
    managerRef = new CodexBinaryManager({
      platform: resolverEnv.platform,
      nodePath,
    });
    managerNodePath = nodePath;
  }
  return managerRef;
}

export function subscribeCodexInstallState(
  getManager: () => Pick<CodexBinaryManager, "refreshInstallState">,
  cb: () => void
): () => void {
  return subscribeToSettingsChange((prev, next) => {
    const previous = prev.agentMode?.backends?.codex;
    const current = next.agentMode?.backends?.codex;
    if (codexProbeSettingsFingerprint(previous) !== codexProbeSettingsFingerprint(current)) {
      void getManager()
        .refreshInstallState(current)
        .catch((error) => logError("[AgentMode] Codex install-state refresh failed", error));
      return;
    }
    if (previous?.probe !== current?.probe) cb();
  });
}

export async function detectCodexAcpPath(): Promise<string | null> {
  const fromResolver = resolveCodexAcpBinary(codexAcpResolverEnv());
  if (fromResolver) return fromResolver;
  if (process.platform === "win32") return null;
  return detectBinary(CODEX_BINARY_NAME);
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
 * Codex backend — wraps `@agentclientprotocol/codex-acp`, which inherits auth
 * from the local `codex` CLI login. Auth is CLI-owned (no Copilot-side keys),
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

  getInstallState(settings: CopilotSettings): InstallState {
    return getCodexBinaryManager().getInstallState(settings.agentMode?.backends?.codex);
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return settings.agentMode?.backends?.codex?.binaryPath ?? null;
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeCodexInstallState(getCodexBinaryManager, cb);
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
    return simpleBinaryBackendProcess(
      args,
      new CodexBackend({
        platform: process.platform,
        nodePath: resolveCodexNodePath(codexAcpResolverEnv()),
      })
    );
  },

  SettingsPanel: CodexSettingsPanel,

  async onPluginLoad(_plugin: CopilotPlugin): Promise<void> {
    await getCodexBinaryManager().refreshInstallState();
  },

  getModeMapping(modeState) {
    return buildCodexModeMapping(modeState);
  },
};
