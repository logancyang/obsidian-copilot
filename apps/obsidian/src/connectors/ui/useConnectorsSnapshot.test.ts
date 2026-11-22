import type { ConnectionManager, ConnectorsSnapshot } from "@/connectors/connectionManager";
import { useConnectorsSnapshot } from "@/connectors/ui/useConnectorsSnapshot";
import { act, renderHook } from "@testing-library/react";

function snapshotWith(needsAttention: boolean): ConnectorsSnapshot {
  return { connections: [], waitingLogin: null, failedLogin: null, needsAttention };
}

function fakeManager() {
  let snapshot = snapshotWith(false);
  const listeners = new Set<() => void>();
  const manager = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  } as unknown as ConnectionManager;
  const publish = (next: ConnectorsSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return { manager, publish };
}

describe("useConnectorsSnapshot", () => {
  describe("useConnectorsSnapshot()", () => {
    it("returns the manager's snapshot and follows each change it publishes", () => {
      const { manager, publish } = fakeManager();
      const { result } = renderHook(() => useConnectorsSnapshot(manager));
      expect(result.current?.needsAttention).toBe(false);

      const next = snapshotWith(true);
      act(() => publish(next));

      expect(result.current).toBe(next);
    });

    it("returns null where no connection manager runs", () => {
      const { result } = renderHook(() => useConnectorsSnapshot(undefined));

      expect(result.current).toBeNull();
    });
  });
});
