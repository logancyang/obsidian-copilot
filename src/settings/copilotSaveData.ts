import type { CopilotSettings } from "@/settings/model";
import type { App } from "obsidian";

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
