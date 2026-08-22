import type { App } from "obsidian";

let isMiyoTabRequested = false;

interface ObsidianSettingsController {
  open: () => void;
  openTabById: (id: string) => void;
}

/**
 * Open Copilot settings directly on its existing Miyo connection flow.
 *
 * @param app - The Obsidian app whose settings modal should open.
 * @param ownerWindow - The window containing the control that initiated the handoff.
 */
export function openMiyoSettings(app: App, ownerWindow: Window): void {
  const settings = (app as unknown as { setting: ObsidianSettingsController }).setting;
  isMiyoTabRequested = true;
  settings.open();
  // Opening settings consumes the request immediately when Copilot was already
  // selected. Otherwise hand off on the next paint, after the modal opens, so
  // Copilot renders only once and no detached React tree is left behind.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  ownerWindow.requestAnimationFrame(() => {
    if (isMiyoTabRequested) settings.openTabById("copilot");
  });
}

/** Consume the next requested Copilot tab, defaulting to Basic for ordinary settings opens. */
export function consumeRequestedCopilotSettingsTab(): "basic" | "miyo" {
  // A one-shot Relevant Notes handoff must not change where ordinary Copilot
  // settings opens land after it has been consumed.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const requestedTab = isMiyoTabRequested ? "miyo" : "basic";
  isMiyoTabRequested = false;
  return requestedTab;
}
