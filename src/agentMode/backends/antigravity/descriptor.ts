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
  BackendDescriptor,
  BackendProcess,
  EnabledModelEntry,
  InstallState,
  ModelSelection,
  ModelWireCodec,
} from "@/agentMode/session/types";
import { detectBinary } from "@/utils/detectBinary";
import { antigravitySearchDirs, resolveAntigravityBinary } from "./antigravityBinaryResolver";
import { ANTIGRAVITY_BINARY_NAME } from "./cliSetup";
import { buildAntigravityModeMapping } from "./antigravityModeMapping";

export function updateAntigravityFields(partial: Partial<AntigravityBackendSettings>): void {
  updateAgentModeBackendFields("antigravity", partial);
}

function antigravityResolverEnv(): Parameters<typeof resolveAntigravityBinary>[0] {
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

export async function detectAntigravityPath(): Promise<string | null> {
  return (
    resolveAntigravityBinary(antigravityResolverEnv()) ?? detectBinary(ANTIGRAVITY_BINARY_NAME)
  );
}

export function antigravityDetectionSearchDirs(): string[] {
  return antigravitySearchDirs(antigravityResolverEnv());
}

const KNOWN_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "thinking"]);

const antigravityWire: ModelWireCodec = {
  encode: (s: ModelSelection) => {
    if (!s.effort) return s.baseModelId;
    if (s.baseModelId.endsWith(`-${s.effort}`) || s.baseModelId.endsWith(`/${s.effort}`)) {
      return s.baseModelId;
    }
    return `${s.baseModelId}-${s.effort}`;
  },
  decode: (wireId: string) => {
    if (!wireId) return { selection: { baseModelId: "", effort: null }, provider: "google" };
    if (wireId.includes("/")) {
      const [base, effort] = wireId.split("/");
      if (effort && KNOWN_EFFORTS.has(effort)) {
        return { selection: { baseModelId: base, effort }, provider: "google" };
      }
      return { selection: { baseModelId: wireId, effort: null }, provider: "google" };
    }
    const lastDash = wireId.lastIndexOf("-");
    if (lastDash > 0) {
      const effort = wireId.slice(lastDash + 1);
      if (KNOWN_EFFORTS.has(effort)) {
        return {
          selection: { baseModelId: wireId.slice(0, lastDash), effort },
          provider: "google",
        };
      }
    }
    return { selection: { baseModelId: wireId, effort: null }, provider: "google" };
  },
};

export const AntigravityBackendDescriptor: BackendDescriptor = {
  id: "antigravity",
  displayName: "Antigravity",
  Icon: AntigravityLogo,
  selfHostable: false,
  routesCopilotModels: false,
  setupDescription: "Google Gemini models via antigravity-acp adapter.",
  skillsProjectDir: ".gemini/skills",
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
    return name
      .replace(/^gemini/i, "Gemini")
      .replace(/^claude/i, "Claude")
      .replace(/^gpt/i, "GPT");
  },

  getInstallState(settings: CopilotSettings): InstallState {
    return binaryPathInstallState(settings.agentMode?.backends?.antigravity?.binaryPath);
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return settings.agentMode?.backends?.antigravity?.binaryPath ?? null;
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

  getModeMapping(modeState) {
    return buildAntigravityModeMapping(modeState);
  },
};
