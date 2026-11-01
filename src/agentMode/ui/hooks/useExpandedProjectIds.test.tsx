import { useExpandedProjectIds } from "@/agentMode/ui/hooks/useExpandedProjectIds";
import { logWarn } from "@/logger";
import { act, renderHook } from "@testing-library/react";
import type { App } from "obsidian";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const STORAGE_KEY = "copilot:sessions-sidebar-expanded-projects:v1";

function createApp(initial?: unknown) {
  const store = new Map<string, unknown>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  const app = {
    loadLocalStorage: jest.fn((key: string) => store.get(key) ?? null),
    saveLocalStorage: jest.fn((key: string, value: unknown) => void store.set(key, value)),
  };
  return { app: app as unknown as App, store };
}

describe("useExpandedProjectIds", () => {
  describe("useExpandedProjectIds()", () => {
    it("starts with every project collapsed when nothing was stored", () => {
      const { app } = createApp();

      const { result } = renderHook(() => useExpandedProjectIds(app));

      expect(result.current.expandedProjectIds.size).toBe(0);
    });

    it("expands a collapsed project and collapses an expanded one on toggle", () => {
      const { app } = createApp();
      const { result } = renderHook(() => useExpandedProjectIds(app));

      act(() => result.current.toggleProject("a"));
      expect(result.current.expandedProjectIds.has("a")).toBe(true);

      act(() => result.current.toggleProject("a"));
      expect(result.current.expandedProjectIds.has("a")).toBe(false);
    });

    it("keeps every toggle made in the same batch of updates", () => {
      const { app, store } = createApp();
      const { result } = renderHook(() => useExpandedProjectIds(app));

      act(() => {
        result.current.toggleProject("a");
        result.current.toggleProject("b");
      });

      expect([...result.current.expandedProjectIds]).toEqual(["a", "b"]);
      expect(JSON.parse(store.get(STORAGE_KEY) as string)).toEqual(["a", "b"]);
    });

    it("restores the expanded projects after a reload from vault-scoped storage for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const { app } = createApp();
      const first = renderHook(() => useExpandedProjectIds(app));
      act(() => first.result.current.toggleProject("a"));
      act(() => first.result.current.toggleProject("b"));
      first.unmount();

      const reloaded = renderHook(() => useExpandedProjectIds(app));

      expect([...reloaded.result.current.expandedProjectIds]).toEqual(["a", "b"]);
    });

    it("forgets a project that was collapsed again before the reload", () => {
      const { app, store } = createApp();
      const { result } = renderHook(() => useExpandedProjectIds(app));
      act(() => result.current.toggleProject("a"));
      act(() => result.current.toggleProject("a"));

      expect(JSON.parse(store.get(STORAGE_KEY) as string)).toEqual([]);
    });

    it.each([["not json"], ['{"a":1}'], ["[1,2]"]])(
      "starts collapsed when the stored value %s is not a list of project ids",
      (stored) => {
        const { app } = createApp(stored);

        const { result } = renderHook(() => useExpandedProjectIds(app));

        expect(result.current.expandedProjectIds.size).toBe(0);
      }
    );

    it("keeps toggling in memory and logs a warning when storage cannot be written for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const { app } = createApp();
      (app.saveLocalStorage as jest.Mock).mockImplementation(() => {
        throw new Error("storage disabled");
      });
      const { result } = renderHook(() => useExpandedProjectIds(app));

      act(() => result.current.toggleProject("a"));

      expect(result.current.expandedProjectIds.has("a")).toBe(true);
      expect(logWarn).toHaveBeenCalledWith(
        "Failed to persist expanded sidebar projects",
        expect.any(Error)
      );
    });
  });
});
