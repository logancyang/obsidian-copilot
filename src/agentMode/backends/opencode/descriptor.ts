import { OpencodeInstallModal } from "@/agentMode/backends/opencode/OpencodeInstallModal";
import OpencodeLogo from "@/agentMode/backends/opencode/logo.svg";
import type CopilotPlugin from "@/main";
import {
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type CopilotSettings,
} from "@/settings/model";
import {
  OPENCODE_CANONICAL_MODE_AGENT_IDS,
  OpencodeBackend,
  OPENCODE_PROVIDER_MAP,
} from "./OpencodeBackend";
import { computeInstallState, OpencodeBinaryManager } from "./OpencodeBinaryManager";
import { OpencodeSettingsPanel } from "./OpencodeSettingsPanel";
import { mapNodeArch, mapNodePlatform } from "./platformResolver";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { applyPersistedMode } from "@/agentMode/session/applyPersistedMode";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  CopilotMode,
  ModeMapping,
  ModelSelection,
  ModelWireCodec,
} from "@/agentMode/session/types";
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";

/** Config option id OpenCode uses to switch the active agent at runtime. */
const OPENCODE_MODE_CONFIG_OPTION_ID = "mode";

// Lazy-created singleton manager. The first plugin to ask for it wins; in a
// running Obsidian instance there's exactly one CopilotPlugin so this is safe.
let managerRef: OpencodeBinaryManager | null = null;

/**
 * Effort suffixes opencode appends to model ids. Used to disambiguate
 * genuine effort variants from ids whose trailing segment is part of
 * the model name (e.g. `openrouter/anthropic/claude-3.5-haiku` — the
 * last segment `claude-3.5-haiku` is the model, not an effort).
 */
const KNOWN_OPENCODE_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/**
 * Wire-format codec for Opencode. Native providers emit
 * `<provider>/<model>[/<effort>]` (3 segments with effort); umbrella
 * providers like OpenRouter emit `<provider>/<sub>/<model>[/<effort>]`
 * (4 segments with effort). The leading segment is always the opencode
 * provider id, mapped onto a Copilot `ChatModelProviders` value via
 * `OPENCODE_PROVIDER_MAP` for picker section grouping. We classify the
 * trailing segment as effort iff it's in the known effort vocabulary —
 * that gates out 3-seg umbrella ids whose last segment is part of the
 * model name (e.g. `openrouter/anthropic/claude-3.5-haiku`).
 */
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

/**
 * Resolve the lazy `OpencodeBinaryManager` instance owned by this descriptor.
 * The plugin no longer holds a top-level reference — ownership lives next to
 * the backend that uses it.
 */
export function getOpencodeBinaryManager(plugin: CopilotPlugin): OpencodeBinaryManager {
  if (!managerRef) managerRef = new OpencodeBinaryManager(plugin);
  return managerRef;
}

/**
 * Descriptor for the OpenCode backend. This is the contract `session/` and
 * `ui/` consume — the rest of Agent Mode never imports `OpencodeBackend`,
 * `OpencodeBinaryManager`, or `OpencodeInstallModal` directly.
 */
export const OpencodeBackendDescriptor: BackendDescriptor = {
  id: "opencode",
  displayName: "opencode",
  Icon: OpencodeLogo,
  skillsProjectDir: ".opencode/skills",
  crossDiscoveredAgents: ["claude", "codex"],
  restartOnManagedSkillsChange: true,
  wire: opencodeWire,

  getInstallState(settings: CopilotSettings): InstallState {
    const raw = computeInstallState(settings.agentMode?.backends?.opencode);
    if (raw.kind === "absent") return { kind: "absent" };
    return { kind: "ready", source: raw.source };
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      if (prev.agentMode?.backends?.opencode !== next.agentMode?.backends?.opencode) {
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

  async applySelection(session: AgentSession, selection: ModelSelection): Promise<void> {
    await session.setModel(opencodeWire.encode(selection));
  },

  createBackendProcess(args): BackendProcess {
    return simpleBinaryBackendProcess(args, new OpencodeBackend());
  },

  SettingsPanel: OpencodeSettingsPanel,

  async onPluginLoad(plugin: CopilotPlugin): Promise<void> {
    await getOpencodeBinaryManager(plugin).refreshInstallState();
  },

  isModelEnabledByDefault(model) {
    // Default-enable only "Big Pickle"; users widen the catalog via the
    // per-model toggles in the Agents tab.
    const re = /big[\s_-]*pickle/i;
    return re.test(model.name) || re.test(model.modelId);
  },

  getProbeSessionId(settings: CopilotSettings): string | undefined {
    const id = settings.agentMode?.backends?.opencode?.probeSessionId;
    return id && id.length > 0 ? id : undefined;
  },

  async persistProbeSessionId(sessionId: string, _plugin: CopilotPlugin): Promise<void> {
    updateAgentModeBackendFields("opencode", { probeSessionId: sessionId });
  },

  /**
   * OpenCode doesn't use ACP `availableModes` — its "modes" are agents,
   * switched at runtime via `session/set_config_option` with `configId:
   * "mode"`. The `copilot-build` agent is provisioned in the spawn-time
   * config (see `OpencodeBackend.buildOpencodeConfig`); `build` is the
   * OpenCode built-in we surface as canonical `auto`. Plan mode is not
   * exposed for opencode (no ACP-visible plan finalization tool).
   */
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

  async persistModeSelection(value: CopilotMode, _plugin: CopilotPlugin): Promise<void> {
    updateAgentModeBackendFields("opencode", { selectedMode: value });
  },

  /**
   * Defense-in-depth replay of the persisted mode on a freshly created
   * session. The primary path is `default_agent` baked into the spawn-time
   * `OPENCODE_CONFIG_CONTENT` (see `OpencodeBackend.buildOpencodeConfig`),
   * which guarantees the very first turn runs in the right agent. This
   * runtime call only fires if the spawn-time default didn't take and the
   * `mode` configOption is already registered.
   */
  async applyInitialSessionConfig(session: AgentSession, settings: CopilotSettings): Promise<void> {
    const persistedMode = settings.agentMode?.backends?.opencode?.selectedMode ?? "default";
    await applyPersistedMode(session, persistedMode);
  },
};

/**
 * Map an OpenCode provider id (the leading segment of a wire-form modelId)
 * back to its Copilot `ChatModelProviders` value, or `null` for OpenCode-
 * native providers that don't correspond to any Copilot provider.
 */
function opencodeProviderToCopilot(opencodeProviderId: string): string | null {
  for (const [copilotProvider, oId] of Object.entries(OPENCODE_PROVIDER_MAP)) {
    if (oId === opencodeProviderId) return copilotProvider;
  }
  return null;
}
