import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId } from "@/agentMode/session/types";

interface CatalogSettlement {
  waitForSettled(): Promise<unknown>;
}

/**
 * Start a backend's plugin-load model probe after its required shared data is settled.
 *
 * @param manager - Agent lifecycle that owns the model preloader.
 * @param backendId - Backend whose initial catalog should be probed.
 * @param plusSync - Plugin-local Plus catalog lifecycle, when available.
 * @param waitForPlusCatalog - Whether the current user can route Plus models through OpenCode.
 */
export async function preloadInitialModels(
  manager: Pick<AgentSessionManager, "preloadModels">,
  backendId: BackendId,
  plusSync: CatalogSettlement | undefined,
  waitForPlusCatalog: boolean
): Promise<void> {
  if (backendId === "opencode" && plusSync && waitForPlusCatalog) {
    // Catalog errors are terminal snapshots, not rejected startup: OpenCode
    // must still start with its own and BYOK models after the failed request.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/319
    await plusSync.waitForSettled();
  }
  await manager.preloadModels(backendId);
}
