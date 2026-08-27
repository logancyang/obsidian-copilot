import type CopilotPlugin from "@/main";
import { requireNodeModule } from "@/utils/desktopRuntime";
import {
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type AntigravityBackendSettings,
  type CopilotSettings,
} from "@/settings/model";
import { AntigravityBackend } from "./AntigravityBackend";
import { AntigravityInstallModal } from "./AntigravityInstallModal";
import AntigravityLogo from "./logo.svg";
import { AntigravitySettingsPanel } from "./AntigravitySettingsPanel";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import {
  binaryPathInstallState,
  simpleBinaryBackendProcess,
} from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  EnabledModelEntry,
  ModelSelection,
  ModelWireCodec,
  BackendDescriptor,
  BackendProcess,
  InstallState,
} from "@/agentMode/session/types";
import { detectBinary } from "@/utils/detectBinary";
import { antigravityAcpSearchDirs, resolveAntigravityAcpBinary } from "./antigravityBinaryResolver";
import { ANTIGRAVITY_BINARY_NAME } from "./cliSetup";

const KNOWN_ANTIGRAVITY_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

export function updateAntigravityFields(partial: Partial<AntigravityBackendSettings>): void {
  updateAgentModeBackendFields("antigravity", partial);
}

function antigravityAcpResolverEnv(): Parameters<typeof resolveAntigravityAcpBinary>[0] {
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

export async function detectAntigravityAcpPath(): Promise<string | null> {
  const fromResolver = resolveAntigravityAcpBinary(antigravityAcpResolverEnv());
  if (fromResolver) return fromResolver;
  return detectBinary(ANTIGRAVITY_BINARY_NAME);
}

export function antigravityAcpDetectionSearchDirs(): string[] {
  return antigravityAcpSearchDirs(antigravityAcpResolverEnv());
}

/**
 * Wire-format codec for Antigravity — `<base>[/<effort>]`.
 */
export const antigravityWire: ModelWireCodec = {
  encode: (selection: ModelSelection) =>
    selection.effort ? `${selection.baseModelId}/${selection.effort}` : selection.baseModelId,
  decode: (wireId: string) => {
    if (!wireId) return { selection: { baseModelId: wireId, effort: null }, provider: null };
    const segments = wireId.split("/");
    if (segments.length === 1) {
      return { selection: { baseModelId: wireId, effort: null }, provider: null };
    }
    if (segments.length === 2 && KNOWN_ANTIGRAVITY_EFFORTS.has(segments[1])) {
      return {
        selection: { baseModelId: segments[0], effort: segments[1] },
        provider: null,
      };
    }
    return { selection: { baseModelId: wireId, effort: null }, provider: null };
  },
};

export const AntigravityBackendDescriptor: BackendDescriptor = {
  id: "antigravity",
  displayName: "Antigravity",
  Icon: AntigravityLogo,
  selfHostable: false,
  routesCopilotModels: false,
  setupDescription:
    "Google Antigravity models via the agy CLI, billed to your Google account. Runs the agy-acp adapter on your machine.",
  skillsProjectDir: ".agents/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  restartOnSystemPromptChange: true,
  summarizesSessionTitle: false,
  wire: antigravityWire,
  showModelDescriptions: true,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    return [
      ...agentOriginEnabledModelEntries(settings, "antigravity", (wireId) =>
        antigravityWire.decode(wireId)
      ),
    ];
  },

  normalizeModelName(name: string): string {
    return name;
  },

  getInstallState(settings: CopilotSettings): InstallState {
    const configuredPath = settings.agentMode?.backends?.antigravity?.binaryPath;
    if (!configuredPath) {
      const autoPath = resolveAntigravityAcpBinary(antigravityAcpResolverEnv());
      if (autoPath) return { kind: "ready", source: "custom" };
    }
    return binaryPathInstallState(configuredPath);
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    const configuredPath = settings.agentMode?.backends?.antigravity?.binaryPath;
    if (configuredPath) return configuredPath;
    return resolveAntigravityAcpBinary(antigravityAcpResolverEnv());
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      if (
        prev.agentMode?.backends?.antigravity?.binaryPath !==
        next.agentMode?.backends?.antigravity?.binaryPath
      ) {
        cb();
      }
    });
  },

  openInstallUI(plugin: CopilotPlugin): void {
    new AntigravityInstallModal(plugin.app).open();
  },

  async applySelection(session: AgentSession, selection: ModelSelection): Promise<void> {
    await session.applyModelWireId(antigravityWire.encode(selection));
  },

  createBackendProcess(args): BackendProcess {
    return simpleBinaryBackendProcess(args, new AntigravityBackend(args.clientVersion));
  },

  SettingsPanel: AntigravitySettingsPanel,
};
