jest.mock("obsidian", () => ({
  Platform: { isDesktop: false, isDesktopApp: false, isMobile: false },
}));

import { isDesktopRuntime, requireDesktopModule } from "./desktopRuntime";

const obsidian: {
  Platform: { isDesktop: boolean; isDesktopApp: boolean; isMobile: boolean };
} = jest.requireMock("obsidian");

function setPlatform(isDesktopApp: boolean, isMobile: boolean): void {
  obsidian.Platform.isDesktop = isDesktopApp;
  obsidian.Platform.isDesktopApp = isDesktopApp;
  obsidian.Platform.isMobile = isMobile;
}

describe("desktopRuntime", () => {
  describe("isDesktopRuntime()", () => {
    it("is true on the real desktop app", () => {
      setPlatform(true, false);
      expect(isDesktopRuntime()).toBe(true);
    });

    it("is false under app.emulateMobile(true) — isDesktopApp stays true but isMobile flips", () => {
      // The bug this guards: gating only on Platform.isDesktopApp let desktop-only
      // code load under emulateMobile (where Node is stubbed), crashing the plugin.
      setPlatform(true, true);
      expect(isDesktopRuntime()).toBe(false);
    });

    it("is false on real mobile", () => {
      setPlatform(false, true);
      expect(isDesktopRuntime()).toBe(false);
    });

    it("is false on any non-desktop runtime", () => {
      setPlatform(false, false);
      expect(isDesktopRuntime()).toBe(false);
    });
  });

  describe("requireDesktopModule()", () => {
    it("loads a Node module in a real desktop runtime", () => {
      setPlatform(true, false);

      const path = requireDesktopModule<typeof import("node:path")>("node:path");

      expect(path.join("vault", "note.md")).toBe("vault/note.md");
    });

    it("rejects Node access on real mobile", () => {
      setPlatform(false, true);

      expect(() => requireDesktopModule("node:path")).toThrow("outside Obsidian desktop");
    });

    it("rejects Node access while desktop is emulating mobile", () => {
      setPlatform(true, true);

      expect(() => requireDesktopModule("node:path")).toThrow("mobile mode is active");
    });
  });
});
