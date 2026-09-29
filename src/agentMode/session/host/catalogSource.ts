import type { CatalogSource } from "@/agentMode/session/host/CatalogProjector";
import { buildBackendSummary } from "@/agentMode/session/pickerCatalog";
import type { AgentModelPreloader } from "@/agentMode/session/AgentModelPreloader";
import type { BackendDescriptor, BackendId, ModelSelection } from "@/agentMode/session/types";
import type { PreloadStatus } from "@/agentMode/protocol/state";
import type { CopilotSettings } from "@/settings/model";

export interface CatalogSourceDeps {
  descriptors: () => readonly BackendDescriptor[];
  getSettings: () => CopilotSettings;
  subscribeSettings: (listener: () => void) => () => void;
  subscribeInstallState: (descriptor: BackendDescriptor, listener: () => void) => () => void;
  needsSelfHostWarning: (descriptor: BackendDescriptor, settings: CopilotSettings) => boolean;
  manager: {
    getCachedModelCatalog: AgentModelPreloader["getCachedModelCatalog"];
    getEffortCatalog: AgentModelPreloader["getEffortCatalog"];
    getPreloadStatus(backendId: BackendId): PreloadStatus;
    getDefaultSelection(backendId: BackendId): ModelSelection | null;
    getStartingBackendId(): BackendId | null;
    getLastError(): string | null;
    subscribeModelCache(listener: () => void): () => void;
  };
}

/**
 * Builds the host's catalog source from desktop state. `startFailed` reports only that a start
 * failed: the manager's error text can echo spawn arguments and never leaves this function.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export function createCatalogSource(deps: CatalogSourceDeps): CatalogSource {
  const { manager } = deps;
  return {
    listBackends() {
      const settings = deps.getSettings();
      return deps.descriptors().map((descriptor) =>
        buildBackendSummary({
          descriptor,
          settings,
          selfHostWarning: deps.needsSelfHostWarning(descriptor, settings),
          catalog: manager.getCachedModelCatalog(descriptor.id),
          effortCatalog: manager.getEffortCatalog(descriptor.id),
          preload: manager.getPreloadStatus(descriptor.id),
          defaultSelection: manager.getDefaultSelection(descriptor.id),
        })
      );
    },
    getFlags() {
      return {
        defaultBackendId: deps.getSettings().agentMode?.activeBackend ?? null,
        startingBackendId: manager.getStartingBackendId(),
        startFailed: manager.getLastError() !== null,
      };
    },
    subscribe(listener) {
      const stops = [
        deps.subscribeSettings(listener),
        manager.subscribeModelCache(listener),
        ...deps.descriptors().map((descriptor) => deps.subscribeInstallState(descriptor, listener)),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
}
