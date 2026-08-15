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

    it("ignores the cosmetic legacy tab instead of extending raw storage migration (https://github.com/logancyang/obsidian-copilot-preview/issues/298)", () => {
      window.localStorage.setItem("shelf-key", "projects");
      const { app, store } = createFakeApp();

      expect(getHomeShelfTab(app, "shelf-key")).toBeNull();
      expect(store.has("shelf-key")).toBe(false);
      expect(window.localStorage.getItem("shelf-key")).toBe("projects");
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

    it("ignores the cosmetic legacy dismissal instead of extending raw storage migration (https://github.com/logancyang/obsidian-copilot-preview/issues/298)", () => {
      window.localStorage.setItem("copilot:relevant-notes-popout-hint-dismissed:v1", "true");
      const { app, store } = createFakeApp();

      expect(isPopOutHintDismissed(app)).toBe(false);
      expect(store.size).toBe(0);
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
