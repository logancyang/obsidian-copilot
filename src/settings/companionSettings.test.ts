import { dehydrateDeviceProfile, hydrateDeviceProfile } from "@/settings/deviceProfiles";
import type { CopilotSettings } from "@/settings/model";
import { DEFAULT_SETTINGS } from "@/constants";

describe("companionSettings", () => {
  describe("device profile persistence", () => {
    it("keeps new CLI paths on their own device while syncing model preferences", () => {
      const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as CopilotSettings;
      Object.assign(settings.agentMode.backends, {
        grok: {
          binaryPath: "C:\\grok.exe",
          binaryVersion: "1.0.0",
          defaultModel: { baseModelId: "grok", effort: null },
        },
      });
      const stored = dehydrateDeviceProfile(settings, "desktop");
      expect(stored.agentMode.backends).toMatchObject({
        grok: { defaultModel: { baseModelId: "grok" } },
      });
      expect(stored.agentMode.backends.grok?.binaryPath).toBeUndefined();
      expect(hydrateDeviceProfile(stored, "desktop").agentMode.backends.grok?.binaryPath).toBe(
        "C:\\grok.exe"
      );
      expect(
        hydrateDeviceProfile(stored, "other").agentMode.backends.grok?.binaryPath
      ).toBeUndefined();
    });
  });
});
