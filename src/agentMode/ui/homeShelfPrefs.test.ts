import {
  dismissPopOutHint,
  getHomeShelfTab,
  isPopOutHintDismissed,
  setHomeShelfTab,
} from "@/agentMode/ui/homeShelfPrefs";
import { logWarn } from "@/logger";
import type { App } from "obsidian";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

const mockLogWarn = logWarn as jest.MockedFunction<typeof logWarn>;

const POPOUT_HINT_KEY = "copilot:relevant-notes-popout-hint-dismissed:v1";

/** Minimal stand-in for Obsidian's vault-scoped device-local storage. */
function createFakeApp(store = new Map<string, string>()) {
  const app = {
    loadLocalStorage: jest.fn((key: string): unknown => store.get(key) ?? null),
    saveLocalStorage: jest.fn((key: string, data: unknown): void => {
      // Production code only ever stores strings, so the fake narrows directly.
      if (data == null) store.delete(key);
      else store.set(key, data as string);
    }),
  };
  return { app: app as unknown as App, store };
}

/** App whose storage methods throw, as when the API is unusable. */
function createThrowingApp(): App {
  return {
    loadLocalStorage: () => {
      throw new Error("storage disabled");
    },
    saveLocalStorage: () => {
      throw new Error("storage disabled");
    },
  } as unknown as App;
}

describe("homeShelfPrefs", () => {
  afterEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  describe("getHomeShelfTab()", () => {
    it("returns null when no tab has been stored", () => {
      const { app } = createFakeApp();

      expect(getHomeShelfTab(app, "shelf-key")).toBeNull();
    });

    it("returns the tab id stored in vault-scoped storage", () => {
      const { app } = createFakeApp(new Map([["shelf-key", "projects"]]));

      expect(getHomeShelfTab(app, "shelf-key")).toBe("projects");
    });

    it("migrates a legacy raw-localStorage tab forward and keeps the legacy key", () => {
      window.localStorage.setItem("shelf-key", "projects");
      const { app, store } = createFakeApp();

      expect(getHomeShelfTab(app, "shelf-key")).toBe("projects");
      expect(store.get("shelf-key")).toBe("projects");
      // Left in place: other vaults on this device may not have migrated yet.
      expect(window.localStorage.getItem("shelf-key")).toBe("projects");
    });

    it("prefers the vault-scoped tab over a differing legacy value", () => {
      window.localStorage.setItem("shelf-key", "legacy-tab");
      const { app } = createFakeApp(new Map([["shelf-key", "vault-tab"]]));

      expect(getHomeShelfTab(app, "shelf-key")).toBe("vault-tab");
    });

    it("returns null when storage cannot be read", () => {
      expect(getHomeShelfTab(createThrowingApp(), "shelf-key")).toBeNull();
    });
  });

  describe("setHomeShelfTab()", () => {
    it("persists the selected tab id so a later read returns it", () => {
      const { app, store } = createFakeApp();

      setHomeShelfTab(app, "shelf-key", "projects");

      expect(store.get("shelf-key")).toBe("projects");
      expect(getHomeShelfTab(app, "shelf-key")).toBe("projects");
    });

    it("does not throw when storage cannot be written", () => {
      expect(() => setHomeShelfTab(createThrowingApp(), "shelf-key", "projects")).not.toThrow();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "Failed to persist home shelf tab",
        expect.any(Error)
      );
    });
  });

  describe("isPopOutHintDismissed()", () => {
    it("defaults to false when no dismissal has been stored", () => {
      const { app } = createFakeApp();

      expect(isPopOutHintDismissed(app)).toBe(false);
    });

    it("migrates a legacy raw-localStorage dismissal forward and keeps the legacy key", () => {
      window.localStorage.setItem(POPOUT_HINT_KEY, "true");
      const { app, store } = createFakeApp();

      expect(isPopOutHintDismissed(app)).toBe(true);
      expect(store.get(POPOUT_HINT_KEY)).toBe("true");
      expect(window.localStorage.getItem(POPOUT_HINT_KEY)).toBe("true");
    });

    it("returns false when storage cannot be read", () => {
      expect(isPopOutHintDismissed(createThrowingApp())).toBe(false);
    });
  });

  describe("dismissPopOutHint()", () => {
    it("persists the dismissed state so a later read returns true", () => {
      const { app } = createFakeApp();

      dismissPopOutHint(app);

      expect(isPopOutHintDismissed(app)).toBe(true);
    });

    it("does not throw when storage cannot be written", () => {
      expect(() => dismissPopOutHint(createThrowingApp())).not.toThrow();
      expect(mockLogWarn).toHaveBeenCalledWith(
        "Failed to persist pop-out hint dismissal",
        expect.any(Error)
      );
    });
  });
});
