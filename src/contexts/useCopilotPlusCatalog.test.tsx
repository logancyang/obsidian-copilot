import { act, renderHook } from "@testing-library/react";
import type CopilotPlugin from "@/main";
import type { CopilotPlusCatalogSnapshot, CopilotPlusSyncQueue } from "@/modelManagement";
import { useCopilotPlusCatalog } from "@/contexts/useCopilotPlusCatalog";

describe("useCopilotPlusCatalog", () => {
  describe("useCopilotPlusCatalog()", () => {
    it("rerenders when the current plugin lifecycle publishes its endpoint result (https://github.com/Brevilabs/obsidian-copilot-private/issues/319)", () => {
      let snapshot: CopilotPlusCatalogSnapshot = { status: "loading", models: [] };
      let listener: (() => void) | null = null;
      const queue = Object.assign(jest.fn(), {
        getSnapshot: () => snapshot,
        subscribe: (next: () => void) => {
          listener = next;
          return () => {
            listener = null;
          };
        },
      }) as unknown as CopilotPlusSyncQueue;
      const plugin = { copilotPlusSync: queue } as CopilotPlugin;

      const { result } = renderHook(() => useCopilotPlusCatalog(plugin));
      expect(result.current.status).toBe("loading");

      snapshot = {
        status: "ready",
        models: [{ id: "tomorrow-model", displayName: "Tomorrow Model" }],
      };
      act(() => listener?.());

      expect(result.current).toEqual(snapshot);
    });

    it("returns one stable unavailable snapshot when no lifecycle queue exists", () => {
      const plugin = {} as CopilotPlugin;
      const { result, rerender } = renderHook(() => useCopilotPlusCatalog(plugin));
      const first = result.current;

      rerender();

      expect(result.current).toBe(first);
      expect(result.current).toMatchObject({ status: "error", models: [] });
    });
  });
});
