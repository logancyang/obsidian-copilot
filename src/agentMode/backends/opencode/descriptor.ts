import { Notice } from "obsidian";
import { OPENCODE_PINNED_VERSION, OPENCODE_MIN_VERSION } from "./ui/opencodeVersion";
import { resolveEffort } from "@/lib/model-effort";
import { OpencodeInstallModal } from "@/agentMode/backends/opencode/OpencodeInstallModal";
import OpencodeLogo from "@/agentMode/backends/opencode/logo.svg";
import type CopilotPlugin from "@/main";
import { prefetchConfigEfforts } from "@/agentMode/backends/shared/prefetchConfigEfforts";
import {
  getSettings,
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type CopilotSettings,
} from "@/settings/model";
import {
  OPENCODE_CANONICAL_MODE_AGENT_IDS,
  OpencodeBackend,
  OPENCODE_PROVIDER_MAP,
} from "./OpencodeBackend";
import {
  computeInstallState,
  OpencodeBinaryManager,
  toOpencodeInstallState,
} from "./OpencodeBinaryManager";
import { opencodeEnabledModelEntries, opencodeWireBaseIdFor } from "./opencodeModelResolve";
import { OpencodeSettingsPanel } from "./OpencodeSettingsPanel";
import { mapNodeArch, mapNodePlatform } from "./platformResolver";
import { cacheRoot } from "@/context/conversionsLocation";
import type { ModelSelectionSession } from "@/agentMode/session/types";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  EnabledModelEntry,
  ModeMapping,
  ModelSelection,
  ModelWireCodec,
} from "@/agentMode/session/types";
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";
import { EFFORT_LEVELS_ASCENDING } from "@/agentMode/session/types";
import { findModelEntry } from "@/agentMode/session/translateBackendState";
import type { ManagedInstallActionState } from "@/agentMode/session/types";

const OPENCODE_MODE_CONFIG_OPTION_ID = "mode";

let managerRef: OpencodeBinaryManager | null = null;

const KNOWN_OPENCODE_EFFORTS = new Set(EFFORT_LEVELS_ASCENDING);

const opencodeWire: ModelWireCodec = {
  encode: (selection: ModelSelection) =>
    selection.effort ? `${selection.baseModelId}/${selection.effort}` : selection.baseModelId,
  decode: (wireId: string) => {
    if (!wireId) return { selection: { baseModelId: wireId, effort: null }, provider: null };
    const segments = wireId.split("/");
    const provider = segments.length >= 2 ? opencodeProviderToCopilot(segments[0]) : null;
    const last = segments[segments.length - 1];
    if (segments.length >= 3 && KNOWN_OPENCODE_EFFORTS.has(last)) {
      return {
        selection: { baseModelId: segments.slice(0, -1).join("/"), effort: last },
        provider,
      };
    }
    return { selection: { baseModelId: wireId, effort: null }, provider };
  },
};

export function getOpencodeBinaryManager(plugin: CopilotPlugin): OpencodeBinaryManager {
  if (!managerRef) managerRef = new OpencodeBinaryManager(plugin);
  return managerRef;
}

export { detectOpencodeCliPath } from "./opencodeCliDetector";

export const OpencodeBackendDescriptor: BackendDescriptor = {
  id: "opencode",
  displayName: "opencode",
  Icon: OpencodeLogo,
  selfHostable: true,
  routesCopilotModels: true,
  setupDescription:
    "Copilot Plus models, or any model on your own provider key. Copilot can download and manage the binary for you.",
  skillsProjectDir: ".opencode/skills",
  crossDiscoveredAgents: ["claude", "codex"],
  restartOnManagedSkillsChange: true,
  restartOnProviderConfigChange: true,
  restartOnSystemPromptChange: true,
  summarizesSessionTitle: true,
  wire: opencodeWire,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    return [...opencodeEnabledModelEntries(settings)];
  },

  getWireBaseId(configuredModelId: string, settings: CopilotSettings): string | null {
    return opencodeWireBaseIdFor(configuredModelId, settings);
  },

  getInstallState(settings: CopilotSettings): InstallState {
    return toOpencodeInstallState(computeInstallState(settings.agentMode?.backends?.opencode));
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return settings.agentMode?.backends?.opencode?.binaryPath ?? null;
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      const p = prev.agentMode?.backends?.opencode;
      const n = next.agentMode?.backends?.opencode;
      if (
        p?.binaryPath !== n?.binaryPath ||
        p?.binaryVersion !== n?.binaryVersion ||
        p?.binarySource !== n?.binarySource
      ) {
        cb();
      }
    });
  },

  openInstallUI(plugin: CopilotPlugin): void {
    new OpencodeInstallModal(plugin.app, getOpencodeBinaryManager(plugin), {
      platform: mapNodePlatform(process.platform) ?? process.platform,
      arch: mapNodeArch(process.arch) ?? process.arch,
    }).open();
  },

  managedInstall: {
    getState(plugin: CopilotPlugin): ManagedInstallActionState {
      return getOpencodeBinaryManager(plugin).getActionState();
    },

    subscribe(plugin: CopilotPlugin, onChange: () => void): () => void {
      return getOpencodeBinaryManager(plugin).subscribeRuntimeState(onChange);
    },

    async run(plugin: CopilotPlugin): Promise<void> {
      const manager = getOpencodeBinaryManager(plugin);
      const state = computeInstallState(getSettings().agentMode?.backends?.opencode);
      if (state.kind !== "installed") return;
      if (state.source === "custom") {
        await manager.upgradeCustomBinary();
      } else {
        await manager.upgradeManaged();
      }
    },
  },

  async applySelection(session: ModelSelectionSession, selection: ModelSelection): Promise<void> {
    const apply = session.getState()?.model?.apply;
    // A config-option catalog takes bare model ids only. Effort travels through
    // its own option when the model publishes one and is dropped otherwise; a
    // saved level the model does not offer must never become a `/<effort>`
    // suffix, which opencode rejects, and that rejection leaves the chat on
    // the agent's own default model. https://github.com/Brevilabs/obsidian-copilot-private/issues/364
    if (apply?.kind === "setConfigOption") {
      const currentBase = session.getState()?.model?.current.baseModelId;
      if (currentBase !== selection.baseModelId) {
        await session.applyModelWireId(
          opencodeWire.encode({ baseModelId: selection.baseModelId, effort: null })
        );
      }
      const refreshed = session.getState()?.model;
      const refreshedApply = refreshed?.apply;
      const effortConfigId =
        refreshedApply?.kind === "setConfigOption" ? refreshedApply.effortConfigId : undefined;
      const effort = resolveEffort(
        selection.effort,
        findModelEntry(refreshed, selection.baseModelId)?.effortOptions
      );
      if (effortConfigId && effort !== null) await session.setConfigOption(effortConfigId, effort);
      return;
    }
    const options = findModelEntry(session.getState()?.model, selection.baseModelId)?.effortOptions;
    await session.applyModelWireId(
      opencodeWire.encode({ ...selection, effort: resolveEffort(selection.effort, options) })
    );
  },

  prefetchEffortCatalog: prefetchConfigEfforts,

  createBackendProcess(args): BackendProcess {
    const { providerRegistry, backendConfigRegistry } = args.plugin.modelManagement;
    return simpleBinaryBackendProcess(
      args,
      new OpencodeBackend({
        providerRegistry,
        backendConfigRegistry,
        clientVersion: args.clientVersion,
        getCacheRoot: () => cacheRoot(args.plugin.app),
        getSelfHostWebSearchChannel: () => {
          const bridge = args.plugin.selfHostWebSearchAgentBridge;
          if (!bridge) {
            throw new Error("Copilot self-host web search channel is unavailable.");
          }
          return bridge.getChannel();
        },
      })
    );
  },

  SettingsPanel: OpencodeSettingsPanel,

  async onPluginLoad(plugin: CopilotPlugin): Promise<void> {
    const manager = getOpencodeBinaryManager(plugin);
    manager.adoptPlugin(plugin);
    manager.forgetSettledError();
    await manager.refreshInstallState();
    await manager.autoUpgrade(OPENCODE_PINNED_VERSION, OPENCODE_MIN_VERSION, (message) => {
      new Notice(message);
    });
  },

  getProbeSessionId(settings: CopilotSettings): string | undefined {
    const id = settings.agentMode?.backends?.opencode?.probeSessionId;
    return id && id.length > 0 ? id : undefined;
  },

  async persistProbeSessionId(sessionId: string, _plugin: CopilotPlugin): Promise<void> {
    updateAgentModeBackendFields("opencode", { probeSessionId: sessionId });
  },

  getModeMapping(_modeState, configOptions): ModeMapping | null {
    if (!configOptions) return null;
    const opt = configOptions.find((o) => o.id === OPENCODE_MODE_CONFIG_OPTION_ID);
    if (!opt) return null;
    return {
      kind: "configOption",
      configId: OPENCODE_MODE_CONFIG_OPTION_ID,
      canonical: { ...OPENCODE_CANONICAL_MODE_AGENT_IDS },
    };
  },
};

function opencodeProviderToCopilot(opencodeProviderId: string): string | null {
  for (const [copilotProvider, oId] of Object.entries(OPENCODE_PROVIDER_MAP)) {
    if (oId === opencodeProviderId) return copilotProvider;
  }
  return null;
}
