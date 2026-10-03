import type { CopilotSettingsTabId } from "@/settings/settingsTabs";
import type { App } from "obsidian";

let requestedCopilotSettingsTab: CopilotSettingsTabId | null = null;
let requestedAgentPage: AgentSettingsPage | null = null;

export type AgentSettingsPage = { kind: "edit"; slug: string } | { kind: "create" };

interface ObsidianSettingsController {
  open: () => void;
  openTabById: (id: string) => void;
}

export function openCopilotSettings(
  app: App,
  ownerWindow: Window,
  tab: CopilotSettingsTabId
): void {
  const settings = (app as unknown as { setting: ObsidianSettingsController }).setting;
  requestedCopilotSettingsTab = tab;
  settings.open();
  // Opening settings consumes the request immediately when Copilot is already
  // selected. Otherwise hand off after the modal opens so Copilot renders only
  // once and no detached React tree is left behind.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  ownerWindow.requestAnimationFrame(() => {
    if (requestedCopilotSettingsTab !== null) settings.openTabById("copilot");
  });
}

export function consumeRequestedCopilotSettingsTab(): CopilotSettingsTabId {
  const requestedTab = requestedCopilotSettingsTab ?? "basic";
  requestedCopilotSettingsTab = null;
  return requestedTab;
}

export function openAgentSettings(app: App, ownerWindow: Window, page: AgentSettingsPage): void {
  requestedAgentPage = page;
  openCopilotSettings(app, ownerWindow, "agents");
}

export function consumeRequestedAgentPage(): AgentSettingsPage | null {
  const page = requestedAgentPage;
  requestedAgentPage = null;
  return page;
}
