import type { CopilotSettings } from "@/settings/model";
import type { App } from "obsidian";

/**
 * Returns a `saveData` callback bound to the loaded Copilot plugin instance.
 *
 * Reason: settings code (React components, the root-change apply layer) doesn't
 * hold the plugin directly, so persistence transactions look it up via the
 * Obsidian `App`. The plugin's own `saveData` override must stay the boundary
 * because it dehydrates device-specific settings before delegating to Obsidian.
 * Centralising the `app.plugins` cast (untyped in the Obsidian API) and the
 * "plugin not found" guard here keeps every call site consistent.
 *
 * @param app - Active Obsidian app used to locate the loaded plugin.
 */
export function getCopilotSaveData(app: App): (data: CopilotSettings) => Promise<void> {
  return async (data: CopilotSettings) => {
    const { plugins } = app as unknown as {
      plugins: {
        getPlugin: (id: string) => { saveData: (data: CopilotSettings) => Promise<void> } | null;
      };
    };
    const copilotPlugin = plugins.getPlugin("copilot");
    if (!copilotPlugin) throw new Error("Copilot plugin not found");
    await copilotPlugin.saveData(data);
  };
}
