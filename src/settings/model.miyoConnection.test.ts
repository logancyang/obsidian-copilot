import { DEFAULT_SETTINGS } from "@/constants";
import { sanitizeSettings } from "@/settings/model";

describe("model Miyo connection", () => {
  describe("sanitizeSettings()", () => {
    it.each(["http://miyo-home:8742", "http://127.0.0.1:8742"])(
      "preserves the legacy endpoint %s without requiring local discovery — https://github.com/Brevilabs/obsidian-copilot-private/issues/466",
      (miyoServerUrl) => {
        const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, miyoServerUrl });
        expect(settings.miyoConnectionMode).toBe("remote");
        expect(settings.miyoServerUrl).toBe(miyoServerUrl);
      }
    );
    it("retains a saved server address while local mode stays selected after reload — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", () => {
      const settings = sanitizeSettings({
        ...DEFAULT_SETTINGS,
        miyoServerUrl: "http://remote:8742",
        miyoConnectionMode: "local",
      });
      expect(settings.miyoConnectionMode).toBe("local");
      expect(settings.miyoServerUrl).toBe("http://remote:8742");
      expect(sanitizeSettings(settings)).toEqual(settings);
    });
    it("starts a fresh configuration with this computer — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", () => {
      expect(sanitizeSettings({ ...DEFAULT_SETTINGS }).miyoConnectionMode).toBe("local");
    });
  });
});
