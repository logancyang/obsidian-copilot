import * as fs from "node:fs";
import * as os from "node:os";
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
import { opencodeEnabledModelEntries } from "./opencodeModelResolve";
import { OpencodeSettingsPanel } from "./OpencodeSettingsPanel";
import { resolveOpencodeBinary } from "./opencodeBinaryResolver";
import { mapNodeArch, mapNodePlatform } from "./platformResolver";
import { detectBinary } from "@/utils/detectBinary";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  EnabledModelEntry,
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
 * Run an auto-detect for an externally-installed `opencode`, ignoring any
 * stale custom-path override (e.g. a POSIX path synced from a macOS profile
 * onto Windows). Walks well-known native-install layouts (`~/.opencode/bin`,
 * `~/.bun/bin`, `~/.local/bin`, `%LOCALAPPDATA%\opencode\bin`, ProgramFiles)
 * plus the shared node-tool dirs, then falls back to a PATH walk via
 * `detectBinary` so users with a non-standard install dir on PATH still match.
 * Independent of the managed binary.
 */
export async function detectOpencodeCliPath(): Promise<string | null> {
  const fromResolver = resolveOpencodeBinary({
    override: undefined,
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      readdirSync: (p) => fs.readdirSync(p),
    },
  });
  if (fromResolver) return fromResolver;
  return detectBinary("opencode");
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
  restartOnProviderConfigChange: true,
  restartOnSystemPromptChange: true,
  wire: opencodeWire,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    return [...opencodeEnabledModelEntries(settings)];
  },

  getInstallState(settings: CopilotSettings): InstallState {
    const raw = computeInstallState(settings.agentMode?.backends?.opencode);
    if (raw.kind === "absent") return { kind: "absent" };
    return { kind: "ready", source: raw.source };
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return settings.agentMode?.backends?.opencode?.binaryPath ?? null;
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      const p = prev.agentMode?.backends?.opencode;
      const n = next.agentMode?.backends?.opencode;
      // Only the binary/install fields affect install state; model selection
      // and probe-session writes on the same object must not trigger a restart.
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

  async applySelection(session: AgentSession, selection: ModelSelection): Promise<void> {
    await session.setModel(opencodeWire.encode(selection));
  },

  createBackendProcess(args): BackendProcess {
    const { providerRegistry, backendConfigRegistry } = args.plugin.modelManagement;
    return simpleBinaryBackendProcess(
      args,
      new OpencodeBackend({ providerRegistry, backendConfigRegistry })
    );
  },

  SettingsPanel: OpencodeSettingsPanel,

  async onPluginLoad(plugin: CopilotPlugin): Promise<void> {
    await getOpencodeBinaryManager(plugin).refreshInstallState();
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
