import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { AgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";
import { closePlanPreview, openPlanPreview } from "@/agentMode/ui/PlanPreviewView";
import { insertAtCursor } from "@/utils";
import { openVaultPath } from "@/utils/openVaultPath";
import { getVaultBase } from "@/utils/vaultPath";
import type { App } from "obsidian";

// The desktop panel runs beside the vault it shows, so it can open files, write into the editor
// and host a plan preview in a workspace leaf. This module is the only place the pane reaches
// those desktop-only helpers.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export function createDesktopPaneCapabilities(
  app: App,
  client: SessionClient
): AgentPaneCapabilities {
  return {
    vaultBase: getVaultBase(app),
    openPath: (path, options) => openVaultPath(app, path, options),
    insertAtCursor: (text) => void insertAtCursor(app, text),
    openPlanPreview: (request) => openPlanPreview(app, { ...request, client }),
    closePlanPreview: (proposalId) => closePlanPreview(app, proposalId),
  };
}
