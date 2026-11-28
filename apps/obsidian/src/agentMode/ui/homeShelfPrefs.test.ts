import { getHomeShelfTab, setHomeShelfTab, useHomeShelfTab } from "@/agentMode/ui/homeShelfPrefs";
import { act, renderHook } from "@testing-library/react";
import { logWarn } from "@/logger";
import type { App } from "obsidian";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

const mockLogWarn = logWarn as jest.MockedFunction<typeof logWarn>;

function createFakeApp(store = new Map<string, string>()) {
  const app = {
    loadLocalStorage: jest.fn((key: string): unknown => store.get(key) ?? null),
    saveLocalStorage: jest.fn((key: string, data: unknown): void => {
      if (data == null) store.delete(key);
      else store.set(key, data as string);
    }),
  };
  return { app: app as unknown as App, store };
}

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

  describe("useHomeShelfTab()", () => {
    it("starts on the tab stored under its key", () => {
      const { app } = createFakeApp(new Map([["shelf-key", "project-chats"]]));

      const { result } = renderHook(() => useHomeShelfTab(app, "shelf-key"));

      expect(result.current[0]).toBe("project-chats");
    });

    it("starts with no tab when nothing is stored", () => {
      const { app } = createFakeApp();

      const { result } = renderHook(() => useHomeShelfTab(app, "shelf-key"));

      expect(result.current[0]).toBeNull();
    });

    it("keeps a selected tab for the next shelf opened with the same key", () => {
      const { app } = createFakeApp();
      const first = renderHook(() => useHomeShelfTab(app, "shelf-key"));

      act(() => first.result.current[1]("project-chats"));

      expect(first.result.current[0]).toBe("project-chats");
      const second = renderHook(() => useHomeShelfTab(app, "shelf-key"));
      expect(second.result.current[0]).toBe("project-chats");
    });
  });
});
