jest.mock("obsidian", () => ({ Platform: { isDesktopApp: false, isMobile: false } }));

import { isDesktopRuntime } from "./desktopRuntime";

const obsidian: { Platform: { isDesktopApp: boolean; isMobile: boolean } } =
  jest.requireMock("obsidian");

function setPlatform(isDesktopApp: boolean, isMobile: boolean): void {
  obsidian.Platform.isDesktopApp = isDesktopApp;
  obsidian.Platform.isMobile = isMobile;
}

describe("isDesktopRuntime", () => {
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
