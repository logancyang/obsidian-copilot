import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { disablePreviewForSession, isPreviewEnabled } from "@/plusUtils";
import { subscribeToSettingsChange } from "@/settings/model";
import { Notice } from "obsidian";

export type PreviewEntryPoint = (plugin: CopilotPlugin) => () => void;

const PREVIEW_ENTRY_POINTS: readonly PreviewEntryPoint[] = Object.freeze([]);

export interface PreviewActivation {
  sync: () => void;
  stop: () => void;
}

function deactivateAll(deactivators: Array<() => void>): void {
  for (const deactivate of deactivators.reverse()) deactivate();
}

function activateAll(
  plugin: CopilotPlugin,
  entryPoints: readonly PreviewEntryPoint[]
): (() => void) | null {
  const deactivators: Array<() => void> = [];
  try {
    for (const activate of entryPoints) deactivators.push(activate(plugin));
  } catch (error) {
    // The switch belongs to Official code, so a broken preview must leave Copilot usable and the way back reachable.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/626
    deactivateAll(deactivators);
    disablePreviewForSession();
    logError("Copilot Preview failed to start; running as Official for this session.", error);
    new Notice("Copilot Preview failed to start, so Copilot is running as Official until restart.");
    return null;
  }
  return () => deactivateAll(deactivators);
}

export function startPreviewActivation(
  plugin: CopilotPlugin,
  entryPoints: readonly PreviewEntryPoint[] = PREVIEW_ENTRY_POINTS
): PreviewActivation {
  let deactivate: (() => void) | null = null;
  const sync = (): void => {
    if (isPreviewEnabled()) {
      deactivate ??= activateAll(plugin, entryPoints);
    } else if (deactivate) {
      deactivate();
      deactivate = null;
    }
  };
  const unsubscribe = subscribeToSettingsChange(sync);
  sync();
  return {
    sync,
    stop: () => {
      unsubscribe();
      deactivate?.();
      deactivate = null;
    },
  };
}
