import type { CopilotSettings } from "@/settings/model";
import { ClaudeBackendDescriptor } from "./claude";
import { CodexBackendDescriptor } from "./codex/descriptor";
import { OpencodeBackendDescriptor } from "./opencode/descriptor";
import type { BackendDescriptor, BackendId } from "@/agentMode/session/types";

/**
 * Registry of all known backends. Adding a new backend is exactly:
 *
 *   1. Implement `AcpBackend` and export a `BackendDescriptor` from
 *      `backends/<id>/`.
 *   2. Add the entry below.
 *   3. Persist the backend's per-id slice in `agentMode.backends.<id>`.
 *
 * No edits to `acp/`, `session/`, or `ui/` should be required.
 */
export const backendRegistry: Record<BackendId, BackendDescriptor> = {
  opencode: OpencodeBackendDescriptor,
  claude: ClaudeBackendDescriptor,
  codex: CodexBackendDescriptor,
};

/**
 * The backend a first-run user is steered to. A single constant rather than a
 * per-descriptor flag, so two backends can never both claim the title.
 */
export const RECOMMENDED_BACKEND_ID: BackendId = "opencode";

let displayOrderCache: BackendDescriptor[] | null = null;

/**
 * Every registered backend descriptor in the order the UI presents them —
 * the self-hostable opencode first, then the cloud agents. The one ordering
 * every setup and settings surface reads, so a backend can't end up ordered
 * differently in two places. Computed lazily and memoized for the same reason
 * as `getCloudAgentIds`.
 */
export function backendDisplayOrder(): BackendDescriptor[] {
  if (!displayOrderCache) {
    displayOrderCache = [
      OpencodeBackendDescriptor,
      ClaudeBackendDescriptor,
      CodexBackendDescriptor,
    ];
  }
  return displayOrderCache;
}

/**
 * Whether a backend carries a cloud-egress warning under the current Self-Host
 * Mode state. Cloud agents (`selfHostable: false`) are flagged while the mode is
 * on so the UI shows a warning marker beside them; nothing is flagged when the
 * mode is off. Self-Host Mode is a presentation label — cloud agents stay listed
 * and selectable, they're only marked (and the UI sorts them last).
 */
export function backendNeedsSelfHostWarning(
  descriptor: BackendDescriptor,
  settings: CopilotSettings
): boolean {
  return settings.enableSelfHostMode && !descriptor.selfHostable;
}

/** Resolve the active backend descriptor from settings. Falls back to `opencode`
 *  when the persisted `activeBackend` is unknown (e.g. a removed backend id). */
export function getActiveBackendDescriptor(settings: CopilotSettings): BackendDescriptor {
  const id = settings.agentMode?.activeBackend ?? "opencode";
  return backendRegistry[id] ?? OpencodeBackendDescriptor;
}

/** List all registered backend descriptors (for enroll / lifecycle wiring and
 *  selection UI alike — Self-Host Mode marks cloud agents, never hides them). */
export function listBackendDescriptors(): BackendDescriptor[] {
  return Object.values(backendRegistry);
}

let cloudAgentIdsCache: ReadonlySet<BackendId> | null = null;

/** Frozen id set of every cloud (non-self-hostable) backend. Used to flag stale
 *  / pasted agent pills whose backend may not be installed (hence the full
 *  registry, not just installed descriptors). Computed lazily and memoized —
 *  reading it at module-eval time would race descriptor imports under some
 *  bundler/test load orders (the registry values wouldn't be populated yet). */
export function getCloudAgentIds(): ReadonlySet<BackendId> {
  if (!cloudAgentIdsCache) {
    cloudAgentIdsCache = Object.freeze(
      new Set(
        Object.values(backendRegistry)
          .filter((descriptor) => !descriptor.selfHostable)
          .map((descriptor) => descriptor.id)
      )
    );
  }
  return cloudAgentIdsCache;
}
