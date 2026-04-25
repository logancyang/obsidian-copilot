import { OpencodeInstallModal } from "@/agentMode/backends/opencode/OpencodeInstallModal";
import type { CustomModel } from "@/aiParams";
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
  OpencodeBackend,
  OPENCODE_PROVIDER_MAP,
  copilotModelToOpencodeId,
} from "./OpencodeBackend";
import { computeInstallState, OpencodeBinaryManager } from "./OpencodeBinaryManager";
import { OpencodeSettingsPanel } from "./OpencodeSettingsPanel";
import { mapNodeArch, mapNodePlatform } from "./platformResolver";
import type { ChatModelProviders } from "@/constants";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";

// Lazy-created singleton manager. The first plugin to ask for it wins; in a
// running Obsidian instance there's exactly one CopilotPlugin so this is safe.
let managerRef: OpencodeBinaryManager | null = null;

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

  getInstallState(settings: CopilotSettings): InstallState {
    const raw = computeInstallState(settings.agentMode?.backends?.opencode);
    if (raw.kind === "absent") return { kind: "absent" };
    return { kind: "ready", version: raw.version, source: raw.source };
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

  createBackend(): OpencodeBackend {
    return new OpencodeBackend();
  },

  SettingsPanel: OpencodeSettingsPanel,

  async onPluginLoad(plugin: CopilotPlugin): Promise<void> {
    await getOpencodeBinaryManager(plugin).refreshInstallState();
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
    const current = getSettings();
    setSettings({
      agentMode: {
        ...current.agentMode,
        backends: {
          ...current.agentMode.backends,
          opencode: {
            ...(current.agentMode.backends?.opencode ?? {}),
            selectedModelKey,
          },
        },
      },
    });
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
