import type CopilotPlugin from "@/main";
import { requireNodeModule } from "@/utils/desktopRuntime";
import {
  getSettings,
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type AntigravityBackendSettings,
  type CopilotSettings,
} from "@/settings/model";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { binaryPathInstallState } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  BackendDescriptor,
  BackendProcess,
  EnabledModelEntry,
  InstallState,
  ModelSelection,
  ModelWireCodec,
} from "@/agentMode/session/types";
import { detectBinary } from "@/utils/detectBinary";
import { AntigravityBackendProcess } from "./AntigravityBackendProcess";
import { AntigravityInstallModal } from "./AntigravityInstallModal";
import AntigravityLogo from "./logo.svg";
import { AntigravitySettingsPanel } from "./AntigravitySettingsPanel";
import { antigravityBinarySearchDirs, resolveAntigravityBinary } from "./antigravityBinaryResolver";

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

export function resolveAntigravityCliPath(settings: CopilotSettings): string | null {
  return resolveAntigravityBinary({
    override: settings.agentMode?.backends?.antigravity?.binaryPath,
    ...antigravityResolverEnv(),
  });
}

export async function detectAntigravityCliPath(): Promise<string | null> {
  const detected = resolveAntigravityBinary({ override: undefined, ...antigravityResolverEnv() });
  return detected ?? detectBinary("agy");
}

export function antigravityCliDetectionSearchDirs(): string[] {
  return antigravityBinarySearchDirs({ override: undefined, ...antigravityResolverEnv() });
}

export function getAntigravityInstallState(settings: CopilotSettings): InstallState {
  return binaryPathInstallState(resolveAntigravityCliPath(settings) ?? undefined);
}

const antigravityWire: ModelWireCodec = {
  encode: (selection: ModelSelection) => selection.baseModelId,
  decode: (wireId: string) => ({
    selection: { baseModelId: wireId, effort: null },
    provider: null,
  }),
};

export const AntigravityBackendDescriptor: BackendDescriptor = {
  id: "antigravity",
  displayName: "Antigravity",
  Icon: AntigravityLogo,
  selfHostable: false,
  routesCopilotModels: false,
  setupDescription:
    "Models from your Antigravity account, billed by your Antigravity plan. Runs the official agy CLI on this machine.",
  skillsProjectDir: ".agents/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  restartOnSystemPromptChange: false,
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

  getInstallState(settings: CopilotSettings): InstallState {
    return getAntigravityInstallState(settings);
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return resolveAntigravityCliPath(settings);
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
    const settings = getSettings();
    const binaryPath = resolveAntigravityCliPath(settings);
    if (!binaryPath) {
      throw new Error(
        "Antigravity CLI (agy) not found. Install it from https://antigravity.google/ and configure the binary path."
      );
    }
    return new AntigravityBackendProcess({
      binaryPath,
      defaultModel: settings.agentMode?.backends?.antigravity?.defaultModel?.baseModelId,
      env: settings.agentMode?.backends?.antigravity?.envOverrides,
    });
  },

  SettingsPanel: AntigravitySettingsPanel,
};
