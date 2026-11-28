jest.mock("obsidian", () => ({ Platform: { isDesktopApp: false, isMobile: false } }));

import { EventEmitter } from "node:events";
import { isDesktopRuntime, requireNodeModule } from "./desktopRuntime";

const obsidian: { Platform: { isDesktopApp: boolean; isMobile: boolean } } =
  jest.requireMock("obsidian");

function setPlatform(isDesktopApp: boolean, isMobile: boolean): void {
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
      setPlatform(true, true);
      expect(isDesktopRuntime()).toBe(false);
    });

    it("is false on real mobile", () => {
      setPlatform(false, true);
      expect(isDesktopRuntime()).toBe(false);
    });
  });

  describe("requireNodeModule()", () => {
    it("returns the live built-in module on desktop — the same instance static importers see", () => {
      setPlatform(true, false);
      const events = requireNodeModule<typeof import("node:events")>("events");
      expect(events.EventEmitter).toBe(EventEmitter);
    });

    it("throws a clear error naming the module on real mobile", () => {
      setPlatform(false, true);
      expect(() => requireNodeModule("path")).toThrow(
        'Node built-in module "path" is unavailable outside the desktop runtime.'
      );
    });

    it("throws under app.emulateMobile(true) — isDesktopApp stays true but Node is stubbed", () => {
      setPlatform(true, true);
      expect(() => requireNodeModule("child_process")).toThrow(/unavailable outside the desktop/);
    });
  });
});
