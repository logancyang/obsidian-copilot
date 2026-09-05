import { OpencodeInstallModal } from "@/agentMode/backends/opencode/OpencodeInstallModal";
import { OpencodeAbsentInstallActions } from "@/agentMode/backends/opencode/OpencodeInlineInstall";
import OpencodeLogo from "@/agentMode/backends/opencode/logo.svg";
import type CopilotPlugin from "@/main";
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
  OpencodeBinaryManager,
  toOpencodeInstallState,
} from "./OpencodeBinaryManager";
import { opencodeEnabledModelEntries, opencodeWireBaseIdFor } from "./opencodeModelResolve";
import { OpencodeSettingsPanel } from "./OpencodeSettingsPanel";
import { mapNodeArch, mapNodePlatform } from "./platformResolver";
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
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";
import { EFFORT_LEVELS_ASCENDING } from "@/agentMode/session/types";
import { findModelEntry } from "@/agentMode/session/translateBackendState";
import { phaseLabel, phaseProgress } from "./installProgress";
import type { ManagedInstallActionState } from "@/agentMode/session/types";

/** Config option id OpenCode uses to switch the active agent at runtime. */
const OPENCODE_MODE_CONFIG_OPTION_ID = "mode";

/** Frozen empty effort catalog — referential stability for the "no effort" case. */
const EMPTY_EFFORT_CATALOG: Record<string, EffortOption[]> = Object.freeze({});

// Lazy-created singleton manager, kept across plugin lifecycles so an install
// started in one is still running in the next. The instance is reused but its
// plugin handle is not: `onPluginLoad` rebinds it, see `adoptPlugin`.
let managerRef: OpencodeBinaryManager | null = null;

/**
 * Effort suffixes opencode appends to model ids. Used to disambiguate
 * genuine effort variants from ids whose trailing segment is part of
 * the model name (e.g. `openrouter/anthropic/claude-3.5-haiku` — the
 * last segment `claude-3.5-haiku` is the model, not an effort).
 */
const KNOWN_OPENCODE_EFFORTS = new Set(EFFORT_LEVELS_ASCENDING);

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
 *
 * Resolving does not rebind: callers can outlive the lifecycle they captured
 * their `plugin` in, and the manager's binding is read at operation time by
 * whoever holds it. `onPluginLoad` is the one rebinder.
 */
export function getOpencodeBinaryManager(plugin: CopilotPlugin): OpencodeBinaryManager {
  if (!managerRef) managerRef = new OpencodeBinaryManager(plugin);
  return managerRef;
}

/**
 * Re-exported so existing importers keep their path. The implementation lives
 * in `opencodeCliDetector` because the manager needs it too, and importing it
 * from here would close a descriptor↔manager cycle.
 */
export { detectOpencodeCliPath } from "./opencodeCliDetector";

const IDLE_MANAGED_INSTALL_ACTION = Object.freeze({
  kind: "idle" as const,
}) satisfies ManagedInstallActionState;

function managedInstallActionState(manager: OpencodeBinaryManager): ManagedInstallActionState {
  const state = manager.getRuntimeState();
  if (state.kind === "installing") {
    return {
      kind: "running",
      label: phaseLabel(state.progress),
      percent: phaseProgress(state.progress) ?? 0,
    };
  }
  if (state.kind === "detecting" || state.kind === "busy") {
    return { kind: "running", label: "Upgrading…", percent: 0 };
  }
  if (state.kind === "error") return state;
  return IDLE_MANAGED_INSTALL_ACTION;
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
  // opencode routes through user-controlled / self-hosted endpoints, so it
  // stays available in Self-Host Mode.
  selfHostable: true,
  routesCopilotModels: true,
  setupDescription:
    "Copilot Plus models, or any model on your own provider key. Copilot can download and manage the binary for you.",
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

  AbsentInstallActions: OpencodeAbsentInstallActions,

  managedInstall: {
    getState(plugin: CopilotPlugin): ManagedInstallActionState {
      return managedInstallActionState(getOpencodeBinaryManager(plugin));
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

    cancel(plugin: CopilotPlugin): void {
      getOpencodeBinaryManager(plugin).cancelCurrentOperation();
    },
  },

  async applySelection(session: AgentSession, selection: ModelSelection, context): Promise<void> {
    const apply = session.getState()?.model?.apply;
    // A config-option catalog takes bare model ids only. Effort travels through
    // its own option when the model publishes one and is dropped otherwise; a
    // saved level the model does not offer must never become a `/<effort>`
    // suffix, which opencode rejects, and that rejection reverts the whole
    // seed to the agent's own default model. https://github.com/Brevilabs/obsidian-copilot-private/issues/364
    if (apply?.kind === "setConfigOption") {
      // The effort option is model-specific, so activate the bare model first
      // and use the option id from the refreshed state.
      const currentBase = context
        ? context.backendReportedCurrent?.baseModelId
        : session.getState()?.model?.current.baseModelId;
      if (currentBase !== selection.baseModelId) {
        await session.applyModelWireId(
          opencodeWire.encode({ baseModelId: selection.baseModelId, effort: null })
        );
      }
      if (selection.effort !== null) {
        const refreshed = session.getState()?.model;
        const refreshedApply = refreshed?.apply;
        const effortConfigId =
          refreshedApply?.kind === "setConfigOption" ? refreshedApply.effortConfigId : undefined;
        // Only write a level the now-active model actually offers. A saved default can
        // name a level the model has since stopped publishing, and the failed write
        // takes the whole seeded selection down with it — the session reverts to the
        // model it had before, not just to the default effort.
        // https://github.com/logancyang/obsidian-copilot/issues/2917
        const offered = findModelEntry(refreshed, selection.baseModelId)?.effortOptions;
        if (effortConfigId && offered?.some((option) => option.value === selection.effort)) {
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
      // Restore the probe session itself so discovery does not persist the last
      // prefetched model into the next preload.
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
        clientVersion: args.clientVersion,
        // Activates the opencode external_directory allow rule for the off-vault
        // shared conversions cache. vaultId/path derivation lives entirely in
        // conversionsLocation — this backend never duplicates it.
        getCacheRoot: () => cacheRoot(args.plugin.app),
        getSelfHostWebSearchChannel: () => {
          // The native deny is safe only when this lifecycle can provide the
          // replacement route before OpenCode starts.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/165
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
    // The sole rebind point. Every other caller reaches the manager from a
    // surface that can outlive its lifecycle — a settings tree still holding
    // the outgoing vault's plugin can open Configure — so only this hook can
    // vouch for the lifecycle now running. Same shape `main.ts` uses for
    // `miyoMutationSession`, and it runs before any UI of this lifecycle exists.
    manager.adoptPlugin(plugin);
    // The manager is a module-level singleton, so it survives disable→enable
    // and "Open another vault" in the same process. Clearing at the START of a
    // lifecycle is the convention `main.ts` documents for exactly that carry-
    // over — and here it stops a failure from one vault greeting the next.
    manager.forgetSettledError();
    await manager.refreshInstallState();
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
