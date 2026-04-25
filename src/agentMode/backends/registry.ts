import type { CopilotSettings } from "@/settings/model";
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
};

/** Resolve the active backend descriptor from settings. Falls back to `opencode`. */
export function getActiveBackendDescriptor(settings: CopilotSettings): BackendDescriptor {
  const id = settings.agentMode?.activeBackend ?? "opencode";
  return backendRegistry[id] ?? OpencodeBackendDescriptor;
}

/** List all registered backend descriptors (e.g. for a backend picker). */
export function listBackendDescriptors(): BackendDescriptor[] {
  return Object.values(backendRegistry);
}
