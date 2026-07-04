import * as fs from "node:fs";
import * as os from "node:os";
import { OpencodeInstallModal } from "@/agentMode/backends/opencode/OpencodeInstallModal";
import OpencodeLogo from "@/agentMode/backends/opencode/logo.svg";
import type CopilotPlugin from "@/main";
import { OPENCODE_MIN_ACP_VERSION } from "@/constants";
import { logWarn } from "@/logger";
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
  isOpencodeVersionOutdated,
  OpencodeBinaryManager,
} from "./OpencodeBinaryManager";
import { opencodeEnabledModelEntries } from "./opencodeModelResolve";
import { OpencodeSettingsPanel } from "./OpencodeSettingsPanel";
import { resolveOpencodeBinary } from "./opencodeBinaryResolver";
import { mapNodeArch, mapNodePlatform } from "./platformResolver";
import { detectBinary } from "@/utils/detectBinary";
import { cacheRoot } from "@/context/conversionsLocation";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  EffortOption,
  EnabledModelEntry,
  ModeMapping,
  ModelSelection,
  ModelState,
  ModelWireCodec,
  SessionId,
} from "@/agentMode/session/types";
import type {
  BackendDescriptor,
  BackendProcess,
  BackendUpgradeInfo,
  InstallState,
} from "@/agentMode/session/types";

/** Config option id OpenCode uses to switch the active agent at runtime. */
const OPENCODE_MODE_CONFIG_OPTION_ID = "mode";

/** Frozen empty effort catalog — referential stability for the "no effort" case. */
const EMPTY_EFFORT_CATALOG: Record<string, EffortOption[]> = Object.freeze({});

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
  // opencode runs a title-summarizer agent and returns clean session titles.
  summarizesSessionTitle: true,
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

  getUpgradeInfo(settings: CopilotSettings): BackendUpgradeInfo | null {
    const state = computeInstallState(settings.agentMode?.backends?.opencode);
    if (state.kind !== "installed" || !isOpencodeVersionOutdated(state.version)) return null;
    return {
      currentVersion: state.version,
      minVersion: OPENCODE_MIN_ACP_VERSION,
      source: state.source,
    };
  },

  async upgrade(plugin: CopilotPlugin): Promise<void> {
    const manager = getOpencodeBinaryManager(plugin);
    const state = computeInstallState(getSettings().agentMode?.backends?.opencode);
    if (state.kind !== "installed") return;
    if (state.source === "custom") {
      await manager.upgradeCustomBinary();
    } else {
      await manager.upgradeManaged();
    }
  },

  async applySelection(session: AgentSession, selection: ModelSelection): Promise<void> {
    const apply = session.getState()?.model?.apply;
    if (apply?.kind === "setConfigOption" && apply.effortConfigId) {
      // The effort option is model-specific, so activate the bare model first
      // and use the option id from the refreshed state.
      const currentBase = session.getState()?.model?.current.baseModelId;
      if (currentBase !== selection.baseModelId) {
        await session.applyModelWireId(
          opencodeWire.encode({ baseModelId: selection.baseModelId, effort: null })
        );
      }
      if (selection.effort !== null) {
        const refreshedApply = session.getState()?.model?.apply;
        const effortConfigId =
          refreshedApply?.kind === "setConfigOption" ? refreshedApply.effortConfigId : undefined;
        if (effortConfigId) {
          await session.setConfigOption(effortConfigId, selection.effort);
        }
      }
      return;
    }
    await session.applyModelWireId(opencodeWire.encode(selection));
  },

  async prefetchEffortCatalog({
    proc,
    sessionId,
    modelState,
    enabledModels,
    isAborted,
  }: {
    proc: BackendProcess;
    sessionId: SessionId;
    modelState: ModelState;
    enabledModels: ReadonlyArray<EnabledModelEntry>;
    isAborted: () => boolean;
  }): Promise<Record<string, EffortOption[]>> {
    // opencode ≥ 1.15.13 advertises its catalog via a `category:"model"` config
    // option; effort is a sibling `category:"thought_level"` option opencode only
    // surfaces for the active model. Switch to each enabled model in turn and read
    // the effort options the refreshed state reports for it.
    if (modelState.apply.kind !== "setConfigOption") return EMPTY_EFFORT_CATALOG;
    const configId = modelState.apply.configId;
    const originalWire = opencodeWire.encode({
      baseModelId: modelState.current.baseModelId,
      effort: null,
    });
    const out: Record<string, EffortOption[]> = {};
    try {
      for (const model of enabledModels) {
        if (isAborted()) break;
        // Skip models the agent can't serve — switching to them just errors.
        if (model.credentialState !== "ok") continue;
        try {
          const next = await proc.setSessionConfigOption({
            sessionId,
            configId,
            value: opencodeWire.encode({ baseModelId: model.baseModelId, effort: null }),
          });
          const entry = next.model?.availableModels.find(
            (e) => e.baseModelId === model.baseModelId
          );
          if (entry && entry.effortOptions.length > 0) {
            out[model.baseModelId] = entry.effortOptions;
          }
        } catch (e) {
          logWarn(`[AgentMode] opencode effort prefetch for ${model.baseModelId} failed`, e);
        }
      }
    } finally {
      // Restore the probe session's model so the adopted session isn't left on
      // the last probed model.
      try {
        await proc.setSessionConfigOption({ sessionId, configId, value: originalWire });
      } catch (e) {
        logWarn("[AgentMode] opencode effort prefetch: restore failed", e);
      }
    }
    return Object.keys(out).length > 0 ? out : EMPTY_EFFORT_CATALOG;
  },

  createBackendProcess(args): BackendProcess {
    const { providerRegistry, backendConfigRegistry } = args.plugin.modelManagement;
    return simpleBinaryBackendProcess(
      args,
      new OpencodeBackend({
        providerRegistry,
        backendConfigRegistry,
        // Activates the opencode external_directory allow rule for the off-vault
        // shared conversions cache. vaultId/path derivation lives entirely in
        // conversionsLocation — this backend never duplicates it.
        getCacheRoot: () => cacheRoot(args.plugin.app),
      })
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
