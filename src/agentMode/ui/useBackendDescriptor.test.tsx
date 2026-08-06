import { act, renderHook } from "@testing-library/react";
import { backendRegistry, getActiveBackendDescriptor } from "@/agentMode/backends/registry";
import type { BackendId } from "@/agentMode/session/types";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import {
  useBackendInstallState,
  useBackendInstallStates,
  useSessionBackendDescriptor,
} from "./useBackendDescriptor";

let mockSettings = {} as CopilotSettings;

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mock name must match */
jest.mock("@/settings/model", () => ({
  useSettingsValue: () => mockSettings,
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

jest.mock("@/agentMode/backends/registry", () => {
  const registry: Record<string, unknown> = {};
  return {
    backendRegistry: registry,
    getActiveBackendDescriptor: jest.fn(),
    listBackendDescriptors: () => Object.values(registry),
  };
});

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

function makeInstallDescriptor(initial: InstallState, id: BackendId = "claude") {
  let state = initial;
  const listeners = new Set<() => void>();
  const backend = {
    id,
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

  describe("useBackendInstallStates()", () => {
    it("reuses one frozen empty record across settings identity changes", () => {
      const { result, rerender } = renderHook(() => useBackendInstallStates({} as CopilotPlugin));
      const first = result.current;

      mockSettings = { ...mockSettings };
      rerender();

      expect(result.current).toBe(first);
      expect(Object.isFrozen(result.current)).toBe(true);
    });

    it("reports every registered backend's state keyed by id", () => {
      const opencode = makeInstallDescriptor({ kind: "ready", source: "managed" }, "opencode");
      const claude = makeInstallDescriptor({ kind: "absent" }, "claude");
      registry.opencode = opencode.backend;
      registry.claude = claude.backend;

      const { result } = renderHook(() => useBackendInstallStates({} as CopilotPlugin));

      expect(result.current).toEqual({
        opencode: { kind: "ready", source: "managed" },
        claude: { kind: "absent" },
      });
    });

    it("updates when any single backend's install state changes", () => {
      const opencode = makeInstallDescriptor({ kind: "ready", source: "managed" }, "opencode");
      const claude = makeInstallDescriptor({ kind: "absent" }, "claude");
      registry.opencode = opencode.backend;
      registry.claude = claude.backend;
      const { result } = renderHook(() => useBackendInstallStates({} as CopilotPlugin));

      act(() => claude.emit({ kind: "ready", source: "custom" }));

      expect(result.current.claude).toEqual({ kind: "ready", source: "custom" });
      expect(result.current.opencode).toEqual({ kind: "ready", source: "managed" });
    });

    it("keeps the same record identity when a notification changes nothing", () => {
      const ready: InstallState = { kind: "ready", source: "managed" };
      const opencode = makeInstallDescriptor(ready, "opencode");
      registry.opencode = opencode.backend;
      const { result } = renderHook(() => useBackendInstallStates({} as CopilotPlugin));
      const before = result.current;

      act(() => opencode.emit(ready));

      expect(result.current).toBe(before);
    });

    it("unsubscribes from every backend on unmount", () => {
      const opencode = makeInstallDescriptor({ kind: "absent" }, "opencode");
      const claude = makeInstallDescriptor({ kind: "absent" }, "claude");
      registry.opencode = opencode.backend;
      registry.claude = claude.backend;
      const { unmount } = renderHook(() => useBackendInstallStates({} as CopilotPlugin));

      unmount();

      expect(opencode.unsubscribed()).toBe(true);
      expect(claude.unsubscribed()).toBe(true);
    });
  });
});
