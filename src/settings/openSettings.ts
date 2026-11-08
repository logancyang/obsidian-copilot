import type { CopilotSettingsTabId } from "@/settings/settingsTabs";
import { callMethod, isRecord, readProperty } from "@/utils/obsidianInternals";
import type { App } from "obsidian";

let requestedCopilotSettingsTab: CopilotSettingsTabId | null = null;

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

export function openCorePluginSettings(app: App, pluginName: string): void {
  const settings = readProperty(app, "setting");
  callMethod(settings, "open");
  callMethod(settings, "openTabById", "plugins");
  const search = callMethod(
    readProperty(readProperty(settings, "activeTab"), "containerEl"),
    "querySelector",
    'input[type="search"]'
  );
  // Obsidian's settings markup has no public API, so a changed Core plugins tab still opens, just unfiltered.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
  if (!isRecord(search)) return;
  search.value = pluginName;
  callMethod(search, "dispatchEvent", new Event("input"));
}

export function consumeRequestedCopilotSettingsTab(): CopilotSettingsTabId {
  const requestedTab = requestedCopilotSettingsTab ?? "basic";
  requestedCopilotSettingsTab = null;
  return requestedTab;
}
