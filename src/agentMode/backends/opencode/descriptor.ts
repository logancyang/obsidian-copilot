import { OpencodeInstallModal } from "@/agentMode/backends/opencode/OpencodeInstallModal";
import type CopilotPlugin from "@/main";
import { subscribeToSettingsChange, type CopilotSettings } from "@/settings/model";
import { OpencodeBackend } from "./OpencodeBackend";
import { computeInstallState, OpencodeBinaryManager } from "./OpencodeBinaryManager";
import { OpencodeSettingsPanel } from "./OpencodeSettingsPanel";
import { mapNodeArch, mapNodePlatform } from "./platformResolver";
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
};
