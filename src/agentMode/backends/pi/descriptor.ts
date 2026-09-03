import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  BackendDescriptor,
  BackendProcess,
  EnabledModelEntry,
  InstallState,
  ModelSelection,
  ModelWireCodec,
} from "@/agentMode/session/types";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { PiBackendProcess } from "@/agentMode/sdk/PiBackendProcess";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";
import { getSettings, subscribeToSettingsChange, type CopilotSettings } from "@/settings/model";
import PiLogo from "./logo.svg";
import { PiSettingsPanel } from "./PiSettingsPanel";
import { resolvePiProviderDeps } from "./piProviderDeps";
import { createPiFileStore } from "./piFileStore";
import { createPiToolContext } from "./piToolContext";

/** Ready only while the opt-in toggle is on — the backend is otherwise hidden everywhere. */
const READY: InstallState = { kind: "ready", source: "managed" };
const ABSENT: InstallState = { kind: "absent" };

/**
 * pi model ids travel as-is: the engine has no effort dimension, so there is
 * nothing to pack into or unpack from the wire id.
 */
const piWire: ModelWireCodec = {
  encode: (selection: ModelSelection) => selection.baseModelId,
  decode: (wireId: string) => ({
    selection: { baseModelId: wireId, effort: null },
    provider: null,
  }),
};

/**
 * Pi — the bundled agent. Unlike the other backends there is no binary to
 * install and no CLI to sign into: the engine ships with the plugin and
 * authenticates with the Copilot Plus license key (or the user's own
 * OpenAI-compatible endpoints). It is gated behind an explicit opt-in while it
 * is still being proven, and the toggle is the only gate — install state drives
 * every surface that lists agents.
 */
export const PiBackendDescriptor: BackendDescriptor = {
  id: "pi",
  displayName: "Pi",
  Icon: PiLogo,
  // Routed through the Copilot Plus model proxy by default.
  selfHostable: false,
  routesCopilotModels: true,
  setupDescription:
    "Copilot Plus models, or models from your OpenAI-compatible providers. Built into Copilot with no separate install.",
  skillsProjectDir: ".pi/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  // Provider rows and keys are read when the engine builds its provider
  // collection, which happens once per backend start.
  restartOnProviderConfigChange: true,
  // The system prompt is captured per session, so a new chat already picks up
  // an edited prompt without restarting the backend.
  restartOnSystemPromptChange: false,
  summarizesSessionTitle: false,
  wire: piWire,
  showModelDescriptions: true,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    return [...agentOriginEnabledModelEntries(settings, "pi", (wireId) => piWire.decode(wireId))];
  },

  getInstallState(settings: CopilotSettings): InstallState {
    return settings.agentMode?.backends?.pi?.enabled ? READY : ABSENT;
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      if (prev.agentMode?.backends?.pi?.enabled !== next.agentMode?.backends?.pi?.enabled) {
        cb();
      }
    });
  },

  openInstallUI(): void {
    new Notice("Pi is built in. Enable it under Settings → Copilot → Basic → Agents → Pi.");
  },

  async applySelection(session: AgentSession, selection: ModelSelection): Promise<void> {
    await session.applyModelWireId(piWire.encode(selection));
  },

  SettingsPanel: PiSettingsPanel,

  createBackendProcess({ plugin, descriptor }): BackendProcess {
    return new PiBackendProcess({
      descriptor,
      getProviderDeps: () => resolvePiProviderDeps(plugin),
      getDefaultModelId: () =>
        getSettings().agentMode?.backends?.pi?.defaultModel?.baseModelId ?? undefined,
      getSystemPrompt: () => buildAgentSystemPrompt(),
      toolContext: createPiToolContext(plugin),
      fileStore: createPiFileStore(plugin.app),
    });
  },
};
