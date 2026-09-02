import type { CopilotSettingsTabId } from "@/settings/settingsTabs";
import type { App } from "obsidian";

let requestedCopilotSettingsTab: CopilotSettingsTabId | null = null;

interface ObsidianSettingsController {
  open: () => void;
  openTabById: (id: string) => void;
}

/**
 * Open Copilot settings directly on a requested internal tab.
 *
 * @param app - The Obsidian app whose settings modal should open.
 * @param ownerWindow - The window containing the control that initiated the handoff.
 * @param tab - The Copilot settings tab to select on the next display.
 */
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

/** Consume the next requested Copilot tab, defaulting ordinary settings opens to Basic. */
export function consumeRequestedCopilotSettingsTab(): CopilotSettingsTabId {
  // A one-shot handoff must not change where later ordinary Copilot settings
  // opens land.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const requestedTab = requestedCopilotSettingsTab ?? "basic";
  requestedCopilotSettingsTab = null;
  return requestedTab;
}
