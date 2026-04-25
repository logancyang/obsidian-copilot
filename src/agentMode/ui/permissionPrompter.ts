import { openAcpPermissionModal } from "@/agentMode/ui/AcpPermissionModal";
import type { PermissionPrompter } from "@/agentMode/session/AgentSessionManager";
import type { App } from "obsidian";

/**
 * Default `PermissionPrompter` implementation: opens a modal for each
 * incoming ACP `requestPermission` call. Lives in `ui/` so the session layer
 * (`session/`) stays UI-free; `agentMode/index.ts` wires this into the
 * session manager during plugin construction.
 */
export function createDefaultPermissionPrompter(app: App): PermissionPrompter {
  return (req) => openAcpPermissionModal(app, req);
}
