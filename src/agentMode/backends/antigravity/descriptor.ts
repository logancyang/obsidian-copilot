import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { prefetchConfigEfforts } from "@/agentMode/backends/shared/prefetchConfigEfforts";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  BackendDescriptor,
  BackendProcess,
  EnabledModelEntry,
  InstallState,
  ModeMapping,
  ModelSelection,
  ModelSelectionSession,
  ModelWireCodec,
} from "@/agentMode/session/types";
import { resolveEffort } from "@/lib/model-effort";
import type CopilotPlugin from "@/main";
import { subscribeToSettingsChange, type CopilotSettings } from "@/settings/model";
import { AntigravityBackend } from "./AntigravityBackend";
import { antigravityInstallState, resolveAntigravityBinaryPath } from "./antigravityCli";
import { AntigravityInstallModal } from "./AntigravityInstallModal";
import { AntigravitySettingsPanel } from "./AntigravitySettingsPanel";
import AntigravityLogo from "./logo.svg";

const antigravityWire: ModelWireCodec = {
  encode: (selection: ModelSelection) => selection.baseModelId,
  decode: (wireId: string) => ({
    selection: { baseModelId: wireId, effort: null },
    provider: null,
  }),
};

const ANTIGRAVITY_MODE_MAPPING: ModeMapping = Object.freeze({
  kind: "setMode",
  canonical: Object.freeze({ default: "default", plan: "plan", auto: "auto" }),
});

export const AntigravityBackendDescriptor: BackendDescriptor = {
  id: "antigravity",
  displayName: "Antigravity",
  Icon: AntigravityLogo,
  selfHostable: false,
  routesCopilotModels: false,
  setupDescription:
    "Gemini and other models from your Google Antigravity plan. Runs the Antigravity CLI on your machine.",
  skillsProjectDir: ".agent/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  restartOnSystemPromptChange: false,
  summarizesSessionTitle: false,
  reportsPartialModelLists: true,
  savesChatSelection: true,
  wire: antigravityWire,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    return [
      ...agentOriginEnabledModelEntries(settings, "antigravity", (wireId) =>
        antigravityWire.decode(wireId)
      ),
    ];
  },

  dataDestination() {
    return { kind: "cloud", label: "Google" };
  },

  getInstallState(settings: CopilotSettings): InstallState {
    return antigravityInstallState(resolveAntigravityBinaryPath(settings));
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return resolveAntigravityBinaryPath(settings);
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

  async applySelection(session: ModelSelectionSession, selection: ModelSelection): Promise<void> {
    const offered = session
      .getState()
      ?.model?.availableModels.find((entry) => entry.baseModelId === selection.baseModelId);
    if (!offered) return;
    if (session.getState()?.model?.current.baseModelId !== selection.baseModelId) {
      await session.applyModelWireId(antigravityWire.encode(selection));
    }
    const model = session.getState()?.model;
    const effort = resolveEffort(
      selection.effort,
      model?.availableModels.find((entry) => entry.baseModelId === selection.baseModelId)
        ?.effortOptions
    );
    if (
      model?.apply.kind === "setConfigOption" &&
      model.apply.effortConfigId &&
      effort !== null &&
      effort !== model.current.effort
    ) {
      await session.setConfigOption(model.apply.effortConfigId, effort);
    }
  },

  prefetchEffortCatalog: prefetchConfigEfforts,

  createBackendProcess(args): BackendProcess {
    return simpleBinaryBackendProcess(args, new AntigravityBackend(args.app, args.clientVersion));
  },

  SettingsPanel: AntigravitySettingsPanel,

  getModeMapping(): ModeMapping {
    return ANTIGRAVITY_MODE_MAPPING;
  },
};
