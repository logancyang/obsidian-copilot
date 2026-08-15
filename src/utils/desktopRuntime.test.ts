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

  describe("requireNodeModule()", () => {
    it("returns the live built-in module on desktop — the same instance static importers see", () => {
      setPlatform(true, false);
      // Node's events module IS the EventEmitter class; identity (not a copy)
      // is what lets rendererEventsShim patch the property every importer reads.
      const events = requireNodeModule<typeof import("node:events")>("events");
      expect(events.EventEmitter).toBe(EventEmitter);
    });

    it("resolves working module functions on desktop", () => {
      setPlatform(true, false);
      const path = requireNodeModule<typeof import("node:path")>("path");
      expect(path.posix.join("a", "b")).toBe("a/b");
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
