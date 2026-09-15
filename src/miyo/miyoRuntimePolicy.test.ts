import { Platform } from "obsidian";
import { CopilotSettings } from "@/settings/model";
import { getMiyoConnectionMode, getMiyoCustomUrl, shouldUseMiyo } from "./miyoRuntimePolicy";

const settings = (values: Partial<CopilotSettings>) =>
  ({ enableMiyo: true, miyoServerUrl: "", ...values }) as CopilotSettings;
const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/466";
describe("miyoRuntimePolicy", () => {
  describe("getMiyoConnectionMode()", () => {
    it(`preserves a legacy URL as explicit server selection, including loopback — ${issue}`, () => {
      expect(getMiyoConnectionMode(settings({ miyoServerUrl: "http://127.0.0.1:8742" }))).toBe(
        "remote"
      );
      expect(getMiyoConnectionMode(settings({}))).toBe("local");
    });
  });
  describe("getMiyoCustomUrl()", () => {
    it(`uses local discovery while retaining the saved remote address — ${issue}`, () => {
      expect(
        getMiyoCustomUrl(
          settings({ miyoConnectionMode: "local", miyoServerUrl: "http://remote:8742" })
        )
      ).toBe("");
      expect(
        getMiyoCustomUrl(
          settings({ miyoConnectionMode: "remote", miyoServerUrl: " http://remote:8742 " })
        )
      ).toBe("http://remote:8742");
    });
  });
  describe("shouldUseMiyo()", () => {
    it(`never routes an incomplete remote configuration to local discovery — ${issue}`, () => {
      expect(shouldUseMiyo(settings({ miyoConnectionMode: "remote" }))).toBe(false);
      expect(
        shouldUseMiyo(
          settings({ miyoConnectionMode: "remote", miyoServerUrl: "http://remote:8742" })
        )
      ).toBe(true);
      expect(shouldUseMiyo(settings({ enableMiyo: false }))).toBe(false);
    });
    it(`requires an explicit server address on mobile — ${issue}`, () => {
      const wasMobile = Platform.isMobile;
      Platform.isMobile = true;
      try {
        expect(shouldUseMiyo(settings({ miyoConnectionMode: "local" }))).toBe(false);
        expect(
          shouldUseMiyo(
            settings({ miyoConnectionMode: "remote", miyoServerUrl: "http://remote:8742" })
          )
        ).toBe(true);
      } finally {
        Platform.isMobile = wasMobile;
      }
    });
  });
});
