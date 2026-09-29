import type { HostOp } from "@/agentMode/protocol/ops";
import type { BackendSummary, HostFlags, HostState } from "@/agentMode/protocol/state";
import type { BackendId } from "@/agentMode/session/types";

/**
 * Where the picker catalog and the host flags come from. The desktop implements it over settings,
 * the model cache and install states; the host only asks it what is true now and when to ask again.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export interface CatalogSource {
  listBackends(): readonly BackendSummary[];
  getFlags(): HostFlags;
  subscribe(listener: () => void): () => void;
}

/**
 * Turns changes to the picker catalog and the host flags into host ops. A backend is replaced
 * whole, and only when its content differs from what clients last received.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export class CatalogProjector {
  private readonly sent = new Map<BackendId, string>();

  constructor(
    private readonly source: CatalogSource,
    private readonly getState: () => HostState,
    private readonly emit: (op: HostOp) => void
  ) {}

  refresh(): void {
    this.source.listBackends().forEach((backend, index) => {
      const key = JSON.stringify(backend);
      if (this.sent.get(backend.id) === key) return;
      this.sent.set(backend.id, key);
      this.emit({ t: "backend.set", index, backend });
    });
    const current = this.getState().host;
    const next = this.source.getFlags();
    const patch: Partial<HostFlags> = {};
    if (current.defaultBackendId !== next.defaultBackendId) {
      patch.defaultBackendId = next.defaultBackendId;
    }
    if (current.startingBackendId !== next.startingBackendId) {
      patch.startingBackendId = next.startingBackendId;
    }
    if (current.startFailed !== next.startFailed) patch.startFailed = next.startFailed;
    if (Object.keys(patch).length > 0) this.emit({ t: "host.patch", patch });
  }
}
