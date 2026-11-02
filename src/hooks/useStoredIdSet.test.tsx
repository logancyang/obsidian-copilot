import { useStoredIdSet } from "@/hooks/useStoredIdSet";
import { act, renderHook } from "@testing-library/react";
import type { App } from "obsidian";

const STORAGE_KEY = "copilot:test-fold-state:v1";

function createApp(initial?: unknown) {
  const store = new Map<string, unknown>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  const app = {
    loadLocalStorage: jest.fn((key: string) => store.get(key) ?? null),
    saveLocalStorage: jest.fn((key: string, value: unknown) => void store.set(key, value)),
  };
  return { app: app as unknown as App, store };
}

describe("useStoredIdSet", () => {
  describe("useStoredIdSet()", () => {
    it("starts with no ids when nothing was stored", () => {
      const { app } = createApp();

      const { result } = renderHook(() => useStoredIdSet(app, STORAGE_KEY));

      expect(result.current.ids.size).toBe(0);
    });

    it("adds an absent id and removes a present one on toggle", () => {
      const { app } = createApp();
      const { result } = renderHook(() => useStoredIdSet(app, STORAGE_KEY));

      act(() => result.current.toggle("a"));
      expect(result.current.ids.has("a")).toBe(true);

      act(() => result.current.toggle("a"));
      expect(result.current.ids.has("a")).toBe(false);
    });

    it("keeps every toggle made in the same batch of updates", () => {
      const { app, store } = createApp();
      const { result } = renderHook(() => useStoredIdSet(app, STORAGE_KEY));

      act(() => {
        result.current.toggle("a");
        result.current.toggle("b");
      });

      expect([...result.current.ids]).toEqual(["a", "b"]);
      expect(store.get(STORAGE_KEY)).toEqual(["a", "b"]);
    });

    it("restores the ids after a reload from vault-scoped storage for https://github.com/Brevilabs/obsidian-copilot-private/issues/802", () => {
      const { app } = createApp();
      const first = renderHook(() => useStoredIdSet(app, STORAGE_KEY));
      act(() => first.result.current.toggle("a"));
      act(() => first.result.current.toggle("b"));
      first.unmount();

      const reloaded = renderHook(() => useStoredIdSet(app, STORAGE_KEY));

      expect([...reloaded.result.current.ids]).toEqual(["a", "b"]);
    });

    it("forgets an id that was toggled off again before the reload", () => {
      const { app, store } = createApp();
      const { result } = renderHook(() => useStoredIdSet(app, STORAGE_KEY));
      act(() => result.current.toggle("a"));
      act(() => result.current.toggle("a"));

      expect(store.get(STORAGE_KEY)).toEqual([]);
    });

    it("keeps the sets stored under different keys apart", () => {
      const { app, store } = createApp();
      const folders = renderHook(() => useStoredIdSet(app, STORAGE_KEY));
      const groups = renderHook(() => useStoredIdSet(app, "copilot:other-fold-state:v1"));

      act(() => groups.result.current.toggle("recents"));

      expect(folders.result.current.ids.size).toBe(0);
      expect(store.get(STORAGE_KEY)).toBeUndefined();
      expect(store.get("copilot:other-fold-state:v1")).toEqual(["recents"]);
    });

    it.each([["a"], [{ a: 1 }], [[1, 2]]])(
      "starts with no ids when the stored value %j is not a list of ids",
      (stored) => {
        const { app } = createApp(stored);

        const { result } = renderHook(() => useStoredIdSet(app, STORAGE_KEY));

        expect(result.current.ids.size).toBe(0);
      }
    );
  });
});
