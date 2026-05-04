import { OpencodeInstallModal } from "@/agentMode/backends/opencode/OpencodeInstallModal";
import type { CustomModel } from "@/aiParams";
import { logWarn } from "@/logger";
import type CopilotPlugin from "@/main";
import {
  getModelKeyFromModel,
  getSettings,
  setSettings,
  subscribeToSettingsChange,
  type CopilotSettings,
} from "@/settings/model";
import { findCustomModel } from "@/utils";
import {
  OPENCODE_CANONICAL_MODE_AGENT_IDS,
  OpencodeBackend,
  OPENCODE_PROVIDER_MAP,
  copilotModelToOpencodeId,
} from "./OpencodeBackend";
import { computeInstallState, OpencodeBinaryManager } from "./OpencodeBinaryManager";
import { OpencodeSettingsPanel } from "./OpencodeSettingsPanel";
import { mapNodeArch, mapNodePlatform } from "./platformResolver";
import type { ChatModelProviders } from "@/constants";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { noopBackendMetaParser } from "@/agentMode/session/backendMeta";
import type { CopilotMode, ModeMapping } from "@/agentMode/session/modeAdapter";
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";
import * as path from "node:path";

/** Config option id OpenCode uses to switch the active agent at runtime. */
const OPENCODE_MODE_CONFIG_OPTION_ID = "mode";

// Lazy-created singleton manager. The first plugin to ask for it wins; in a
// running Obsidian instance there's exactly one CopilotPlugin so this is safe.
let managerRef: OpencodeBinaryManager | null = null;

/**
 * Effort suffixes opencode appends to model ids for reasoning-effort variants.
 * Used by `parseEffortFromModelId` to disambiguate genuine variants from
 * 3-segment ids whose third segment is part of the model name (e.g.
 * OpenRouter's `openrouter/anthropic/claude-sonnet-4-5`).
 */
const KNOWN_OPENCODE_EFFORTS = new Set(["minimal", "low", "medium", "high"]);

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
  // OpenCode's `_meta` carries `modelId` / `variant` / `availableVariants`,
  // but none of those map to a `NormalizedToolCallMeta` field today —
  // opencode's plan signals flow through the plan-file matcher and the
  // bodyless `plan_exit` interception, not `_meta`.
  meta: noopBackendMetaParser,

  // OpenCode's plan agent has no permission-gated finalization tool —
  // `plan_exit` is CLI-only, never registered for ACP clients (see
  // opencode `tool/registry.ts`'s `OPENCODE_CLIENT === "cli"` gate). The
  // canonical content signal is a successful write to one of the plan-mode
  // plan paths (`<cwd>/.opencode/plans/*.md` for VCS-tracked projects,
  // `<xdgData>/opencode/plans/*.md` otherwise — see opencode
  // `session/session.ts:plan()`). The session bootstraps the plan card
  // off that write via `isPlanModePlanFilePath`.
  //
  // The model is still trained to call `plan_exit` to finalize, and
  // OpenCode's tool dispatcher reports the call back as a hallucinated
  // `tool_call` with `title: "plan_exit"` followed by an "Invalid Tool"
  // update. We treat that initial tool_call as a bodyless exit signal:
  // publish whatever plan body the session has (the file-write body, or
  // a `kind: "plan"` part from `todowrite`'s structured-plan
  // translation in `acp/agent.ts:382`) and suppress the noisy follow-up
  // updates so the trail stays clean. Note: the model still receives the
  // error from OpenCode and may keep retrying — only an upstream fix
  // (registering `plan_exit` for ACP clients) would address that.
  bodylessPlanExitToolNames: ["plan_exit"],

  isPlanModePlanFilePath(absolutePath, cwd) {
    if (!absolutePath.endsWith(".md")) return false;
    const dir = path.dirname(absolutePath);
    // VCS-project case: <cwd>/.opencode/plans/*.md.
    if (cwd && dir === path.join(cwd, ".opencode", "plans")) return true;
    // Data-dir case: <xdgData>/opencode/plans/*.md (and any sibling
    // platform-default — Windows LOCALAPPDATA, etc.). The plan agent's
    // own permission system already restricts edits to these two
    // directories, so a successful write whose dirname ends in
    // `opencode/plans` is by construction a plan file.
    if (dir.endsWith(path.join("opencode", "plans"))) return true;
    return false;
  },

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

  filterCopilotModels(models: CustomModel[]) {
    const compatible: CustomModel[] = [];
    const incompatible: CustomModel[] = [];
    for (const m of models) {
      if (m.isEmbeddingModel) continue;
      if (!m.enabled) continue;
      if (OPENCODE_PROVIDER_MAP[m.provider as ChatModelProviders]) {
        compatible.push(m);
      } else {
        incompatible.push(m);
      }
    }
    return { compatible, incompatible };
  },

  getPreferredModelId(settings: CopilotSettings): string | undefined {
    const key = settings.agentMode?.backends?.opencode?.selectedModelKey;
    if (!key) return undefined;
    // Copilot keys use `name|provider`; raw opencode ids never contain `|`
    // (they're `<provider>/<model>[/<variant>]`). Route accordingly so
    // effort-variant ids round-trip across reloads.
    if (!key.includes("|")) return key;
    try {
      const model = findCustomModel(key, settings.activeModels ?? []);
      return copilotModelToOpencodeId(model);
    } catch {
      return undefined;
    }
  },

  async persistModelSelection(modelId: string, _plugin: CopilotPlugin): Promise<void> {
    // Translate the agent-native id back to a Copilot key when possible, so
    // the stored value survives renames/reorderings of `activeModels`. If we
    // can't resolve (an OpenCode-native model with no Copilot entry), persist
    // the raw id under the same field.
    const selectedModelKey = agentModelIdToCopilotKey(modelId) ?? modelId;
    setSettings((cur) => ({
      agentMode: {
        ...cur.agentMode,
        backends: {
          ...cur.agentMode.backends,
          opencode: {
            ...(cur.agentMode.backends?.opencode ?? {}),
            selectedModelKey,
          },
        },
      },
    }));
  },

  copilotModelKeyToAgentModelId(model: CustomModel): string | undefined {
    return copilotModelToOpencodeId(model);
  },

  agentModelIdToCopilotProvider(modelId: string): string | undefined {
    const slash = modelId.indexOf("/");
    if (slash <= 0) return undefined;
    const opencodeProviderId = modelId.slice(0, slash);
    for (const [copilotProvider, opencodeId] of Object.entries(OPENCODE_PROVIDER_MAP)) {
      if (opencodeId === opencodeProviderId) return copilotProvider;
    }
    return undefined;
  },

  /**
   * The 3-segment shape is ambiguous on its own — an OpenRouter id like
   * `openrouter/anthropic/claude-sonnet-4-5` looks like a variant id but
   * isn't one. Gate the variant interpretation on a known effort vocabulary
   * so unrelated 3-seg ids fall through to `null`.
   */
  parseEffortFromModelId(modelId: string): { baseId: string; effort: string | null } | null {
    if (!modelId) return null;
    const segments = modelId.split("/");
    if (segments.length === 2) return { baseId: modelId, effort: null };
    if (segments.length === 3 && KNOWN_OPENCODE_EFFORTS.has(segments[2])) {
      return { baseId: `${segments[0]}/${segments[1]}`, effort: segments[2] };
    }
    return null;
  },

  composeModelId(baseId: string, effort: string | null): string {
    return effort ? `${baseId}/${effort}` : baseId;
  },

  getProbeSessionId(settings: CopilotSettings): string | undefined {
    const id = settings.agentMode?.backends?.opencode?.probeSessionId;
    return id && id.length > 0 ? id : undefined;
  },

  async persistProbeSessionId(sessionId: string, _plugin: CopilotPlugin): Promise<void> {
    setSettings((cur) => ({
      agentMode: {
        ...cur.agentMode,
        backends: {
          ...cur.agentMode.backends,
          opencode: {
            ...(cur.agentMode.backends?.opencode ?? {}),
            probeSessionId: sessionId,
          },
        },
      },
    }));
  },

  /**
   * OpenCode doesn't use ACP `availableModes` — its "modes" are agents,
   * switched at runtime via `session/set_config_option` with `configId:
   * "mode"`. The `copilot-build` agent is provisioned in the spawn-time
   * config (see `OpencodeBackend.buildOpencodeConfig`); `build` and `plan`
   * are OpenCode built-ins.
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
    setSettings((cur) => ({
      agentMode: {
        ...cur.agentMode,
        backends: {
          ...cur.agentMode.backends,
          opencode: {
            ...(cur.agentMode.backends?.opencode ?? {}),
            selectedMode: value,
          },
        },
      },
    }));
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
    const mapping = OpencodeBackendDescriptor.getModeMapping?.(
      session.getModeState(),
      session.getConfigOptions()
    );
    if (!mapping || mapping.kind !== "configOption" || !mapping.configId) return;
    const native = mapping.canonical[persistedMode];
    if (!native) return;
    const opt = session.getConfigOptions()?.find((o) => o.id === mapping.configId);
    if (!opt || opt.type !== "select") return;
    if (String(opt.currentValue) === native) return;
    try {
      await session.setConfigOption(mapping.configId, native);
    } catch (e) {
      if (!(e instanceof MethodUnsupportedError)) {
        logWarn(`[AgentMode] could not apply preferred mode ${persistedMode}`, e);
      }
    }
  },
};

/**
 * Reverse-lookup an OpenCode-native model id back to a Copilot
 * `"name|provider"` key. Returns undefined when no `activeModels` entry
 * matches — the caller should persist the raw id in that case.
 */
function agentModelIdToCopilotKey(agentModelId: string): string | undefined {
  const slash = agentModelId.indexOf("/");
  if (slash <= 0) return undefined;
  const opencodeProviderId = agentModelId.slice(0, slash);
  const modelName = agentModelId.slice(slash + 1);
  const settings = getSettings();
  const match = (settings.activeModels ?? []).find(
    (m) =>
      m.name === modelName &&
      OPENCODE_PROVIDER_MAP[m.provider as ChatModelProviders] === opencodeProviderId
  );
  return match ? getModelKeyFromModel(match) : undefined;
}
