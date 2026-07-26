import { getCopilotSaveData } from "@/settings/copilotSaveData";
import type { CopilotSettings } from "@/settings/model";
import type { App } from "obsidian";

/** Build an App whose plugin registry returns (or omits) a Copilot plugin. */
function appWithPlugin(saveData?: (data: CopilotSettings) => Promise<void>): App {
  return {
    plugins: {
      getPlugin: (id: string) => (id === "copilot" && saveData ? { saveData } : null),
    },
  } as unknown as App;
}

describe("copilotSaveData", () => {
  describe("getCopilotSaveData()", () => {
    it("returns a writer that delegates to the loaded plugin's saveData", async () => {
      const pluginSave = jest.fn<Promise<void>, [CopilotSettings]>().mockResolvedValue(undefined);
      const write = getCopilotSaveData(appWithPlugin(pluginSave));
      const data = { copilotFolder: "team/copilot" } as CopilotSettings;

      await write(data);

      expect(pluginSave).toHaveBeenCalledWith(data);
    });

    it("throws when the Copilot plugin is not loaded", async () => {
      const write = getCopilotSaveData(appWithPlugin(undefined));

      await expect(write({} as CopilotSettings)).rejects.toThrow("Copilot plugin not found");
    });
  });
});
