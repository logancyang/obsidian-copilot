import { act, renderHook } from "@testing-library/react";
import { backendRegistry, getActiveBackendDescriptor } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import React from "react";
import { useBackendInstallState, useSessionBackendDescriptor } from "./useBackendDescriptor";

let mockSettings = {} as CopilotSettings;

jest.mock("@/settings/model", () => ({
  useSettingsValue: () => React.useMemo(() => mockSettings, []),
}));

jest.mock("@/agentMode/backends/registry", () => ({
  backendRegistry: {},
  getActiveBackendDescriptor: jest.fn(),
}));

const mockGetActiveBackendDescriptor = getActiveBackendDescriptor as jest.MockedFunction<
  typeof getActiveBackendDescriptor
>;
const registry = backendRegistry;

function descriptor(id: string): BackendDescriptor {
  return { id } as BackendDescriptor;
}

function makeManager() {
  let startingBackendId: string | null = null;
  let activeBackendId: string | null = null;
  const listeners = new Set<() => void>();
  const manager = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getStartingBackendId: () => startingBackendId,
    getActiveSession: () => (activeBackendId ? { backendId: activeBackendId } : null),
  } as unknown as AgentSessionManager;

  return {
    manager,
    emit: (next: { starting?: string | null; active?: string | null }) => {
      if (next.starting !== undefined) startingBackendId = next.starting;
      if (next.active !== undefined) activeBackendId = next.active;
      for (const listener of listeners) listener();
    },
    unsubscribed: () => listeners.size === 0,
  };
}

function makeInstallDescriptor(initial: InstallState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const backend = {
    id: "claude",
    getInstallState: () => ({ ...state }),
    subscribeInstallState: (_plugin: CopilotPlugin, listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as BackendDescriptor;

  return {
    backend,
    emit: (next: InstallState) => {
      state = next;
      for (const listener of listeners) listener();
    },
    unsubscribed: () => listeners.size === 0,
  };
}

describe("useBackendDescriptor", () => {
  beforeEach(() => {
    mockSettings = {} as CopilotSettings;
    mockGetActiveBackendDescriptor.mockReset();
    for (const id of Object.keys(registry)) delete registry[id];
  });

  describe("useSessionBackendDescriptor()", () => {
    it("tracks starting and active session backend changes", () => {
      const fallback = descriptor("fallback");
      const claude = descriptor("claude");
      const codex = descriptor("codex");
      registry.claude = claude;
      registry.codex = codex;
      mockGetActiveBackendDescriptor.mockReturnValue(fallback);
      const fake = makeManager();
      const { result } = renderHook(() => useSessionBackendDescriptor(fake.manager));

      expect(result.current).toBe(fallback);
      act(() => fake.emit({ active: "codex" }));
      expect(result.current).toBe(codex);
      act(() => fake.emit({ starting: "claude" }));
      expect(result.current).toBe(claude);
      act(() => fake.emit({ starting: null }));
      expect(result.current).toBe(codex);
    });

    it("unsubscribes from manager changes on unmount", () => {
      mockGetActiveBackendDescriptor.mockReturnValue(descriptor("fallback"));
      const fake = makeManager();
      const { unmount } = renderHook(() => useSessionBackendDescriptor(fake.manager));

      unmount();

      expect(fake.unsubscribed()).toBe(true);
    });
  });

  describe("useBackendInstallState()", () => {
    it("updates when the install-state value changes despite fresh descriptor objects", () => {
      const fake = makeInstallDescriptor({ kind: "checking", source: "custom" });
      const plugin = {} as CopilotPlugin;
      const { result } = renderHook(() => useBackendInstallState(fake.backend, plugin));

      expect(result.current).toEqual({ kind: "checking", source: "custom" });
      act(() =>
        fake.emit({
          kind: "incompatible",
          source: "custom",
          currentVersion: "2.1.205",
          minVersion: "2.1.206",
          message: "Update Claude Code.",
        })
      );
      expect(result.current).toEqual({
        kind: "incompatible",
        source: "custom",
        currentVersion: "2.1.205",
        minVersion: "2.1.206",
        message: "Update Claude Code.",
      });
    });

    it("skips rerenders when a notification does not change install state", () => {
      const ready: InstallState = { kind: "ready", source: "custom" };
      const fake = makeInstallDescriptor(ready);
      const plugin = {} as CopilotPlugin;
      let renderCount = 0;
      const { result } = renderHook(() => {
        renderCount += 1;
        return useBackendInstallState(fake.backend, plugin);
      });
      const before = result.current;
      const rendersBeforeNotification = renderCount;

      act(() => fake.emit(ready));

      expect(renderCount).toBe(rendersBeforeNotification);
      expect(result.current).toBe(before);
    });

    it("unsubscribes from install-state changes on unmount", () => {
      const fake = makeInstallDescriptor({ kind: "absent" });
      const { unmount } = renderHook(() =>
        useBackendInstallState(fake.backend, {} as CopilotPlugin)
      );

      unmount();

      expect(fake.unsubscribed()).toBe(true);
    });
  });
});
