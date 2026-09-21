import { backendRegistry } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, InstallState } from "@/agentMode/session/types";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { act, renderHook } from "@testing-library/react";
import { useAgentSelect } from "./useAgentSelect";
import { useBackendInstallStates, useSessionBackendDescriptor } from "./useBackendDescriptor";

let mockAuthStatuses: Record<string, { signedIn: boolean } | null> = {};
jest.mock("@/agentMode/session/useBackendAuthState", () => ({
  useBackendAuthState: jest.fn((descriptor: { id: string }) => ({
    status: mockAuthStatuses[descriptor.id] ?? null,
  })),
}));

jest.mock("@/logger", () => ({ logError: jest.fn() }));

jest.mock("./useBackendDescriptor", () => ({
  useBackendInstallStates: jest.fn(),
  useSessionBackendDescriptor: jest.fn(),
}));

jest.mock("@/agentMode/backends/registry", () => {
  const openInstallUI = jest.fn();
  const make = (id: string, displayName: string) => ({
    id,
    displayName,
    auth: id === "opencode" ? undefined : {},
    setupDescription: `${displayName} description`,
    openInstallUI,
  });
  const order = [make("opencode", "opencode"), make("claude", "Claude"), make("codex", "Codex")];
  return {
    backendDisplayOrder: () => order,
    backendRegistry: Object.fromEntries(order.map((descriptor) => [descriptor.id, descriptor])),
    RECOMMENDED_BACKEND_ID: "opencode",
  };
});

const mockInstallStates = useBackendInstallStates as jest.MockedFunction<
  typeof useBackendInstallStates
>;
const mockSessionDescriptor = useSessionBackendDescriptor as jest.MockedFunction<
  typeof useSessionBackendDescriptor
>;
const openInstallUI = backendRegistry.codex.openInstallUI as jest.Mock;

const plugin = {} as CopilotPlugin;

function makeManager(startResult: Promise<unknown> = Promise.resolve({})) {
  const listeners = new Set<() => void>();
  let starting = false;
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getIsStarting: () => starting,
    setStarting: (value: boolean) => {
      starting = value;
      listeners.forEach((listener) => listener());
    },
    setDefaultBackend: jest.fn(),
    getOrCreateActiveSession: jest.fn().mockReturnValue(startResult),
  } as unknown as AgentSessionManager & {
    setStarting: (value: boolean) => void;
    setDefaultBackend: jest.Mock;
    getOrCreateActiveSession: jest.Mock;
  };
}

function render(
  states: Partial<Record<BackendId, InstallState>>,
  manager: ReturnType<typeof makeManager>
) {
  mockInstallStates.mockReturnValue(states as Record<BackendId, InstallState>);
  return renderHook(() => useAgentSelect(plugin, manager));
}

describe("useAgentSelect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStatuses = { claude: { signedIn: true }, codex: { signedIn: true } };
    mockSessionDescriptor.mockReturnValue(backendRegistry.opencode);
  });

  describe("useAgentSelect()", () => {
    it("lists every backend in display order with the recommended one marked", () => {
      const { result } = render({}, makeManager());

      expect(result.current.rows.map((row) => row.id)).toEqual(["opencode", "claude", "codex"]);
      expect(result.current.rows.filter((row) => row.recommended).map((row) => row.id)).toEqual([
        "opencode",
      ]);
    });

    it("preselects the backend the session would run on", () => {
      mockSessionDescriptor.mockReturnValue(backendRegistry.claude);

      const { result } = render({}, makeManager());

      expect(result.current.selectedId).toBe("claude");
    });

    it("follows the selected row when resolving the call to action", () => {
      const { result } = render(
        { opencode: { kind: "absent" }, claude: { kind: "ready", source: "custom" } },
        makeManager()
      );

      expect(result.current.cta.label).toBe("Configure");
      act(() => result.current.select("claude"));
      expect(result.current.cta.label).toBe("Start chat");
    });

    it("does not persist the default backend when a row is merely selected", () => {
      const manager = makeManager();
      const { result } = render({ claude: { kind: "ready", source: "custom" } }, manager);

      act(() => result.current.select("claude"));

      expect(manager.setDefaultBackend).not.toHaveBeenCalled();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("persists the choice and spawns a session when starting an installed agent", () => {
      const manager = makeManager();
      const { result } = render({ claude: { kind: "ready", source: "custom" } }, manager);
      act(() => result.current.select("claude"));

      act(() => result.current.runCta());

      expect(manager.setDefaultBackend).toHaveBeenCalledWith("claude");
      expect(manager.getOrCreateActiveSession).toHaveBeenCalled();
      expect(openInstallUI).not.toHaveBeenCalled();
    });

    it("waits for an unavailable agent's pending launch before starting the selected alternative (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      const manager = makeManager();
      manager.setStarting(true);
      const { result } = render(
        {
          opencode: { kind: "error", message: "Launch failed" },
          claude: { kind: "ready", source: "custom" },
        },
        manager
      );

      // Configure remains usable while another launch is settling.
      act(() => result.current.runCta());
      expect(openInstallUI).toHaveBeenCalledWith(plugin);
      act(() => result.current.select("claude"));
      expect(result.current.cta).toEqual({
        action: "wait",
        label: "Starting…",
        note: "Wait for the current agent launch to finish.",
      });
      act(() => result.current.runCta());
      expect(manager.setDefaultBackend).not.toHaveBeenCalled();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();

      act(() => manager.setStarting(false));
      expect(result.current.cta.action).toBe("start");
      act(() => result.current.runCta());
      expect(manager.setDefaultBackend).toHaveBeenCalledWith("claude");
      expect(manager.getOrCreateActiveSession).toHaveBeenCalledTimes(1);
    });

    it("ignores a Start callback if a launch began since it rendered (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      const manager = makeManager();
      const { result } = render({ opencode: { kind: "ready", source: "managed" } }, manager);
      const start = result.current.runCta;

      act(() => manager.setStarting(true));
      act(() => start());

      expect(manager.setDefaultBackend).not.toHaveBeenCalled();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("opens the selected backend's install dialog when it is not ready", () => {
      const manager = makeManager();
      const { result } = render({ codex: { kind: "error", message: "boom" } }, manager);
      act(() => result.current.select("codex"));

      act(() => result.current.runCta());

      expect(openInstallUI).toHaveBeenCalledWith(plugin);
      expect(manager.setDefaultBackend).not.toHaveBeenCalled();
    });

    it("does nothing while the selected backend's readiness check is in flight", () => {
      const manager = makeManager();
      const { result } = render({ claude: { kind: "checking", source: "custom" } }, manager);
      act(() => result.current.select("claude"));

      act(() => result.current.runCta());

      expect(openInstallUI).not.toHaveBeenCalled();
      expect(manager.setDefaultBackend).not.toHaveBeenCalled();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("configures a signed-out choice and starts an authenticated alternative (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      mockSessionDescriptor.mockReturnValue(backendRegistry.claude);
      mockAuthStatuses.claude = { signedIn: false };
      mockAuthStatuses.codex = null;
      const manager = makeManager();
      const { result, rerender } = render(
        {
          claude: { kind: "ready", source: "custom" },
          codex: { kind: "ready", source: "managed" },
        },
        manager
      );
      expect(result.current.cta).toEqual({
        label: "Configure",
        note: "Claude not signed in",
        action: "configure",
      });
      act(() => result.current.runCta());
      expect(openInstallUI).toHaveBeenCalledWith(plugin);
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
      act(() => result.current.select("codex"));
      expect(result.current.cta.action).toBe("wait");
      act(() => result.current.runCta());
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
      mockAuthStatuses.codex = { signedIn: true };
      rerender();
      expect(result.current.cta.action).toBe("start");
      act(() => result.current.runCta());
      expect(manager.setDefaultBackend).toHaveBeenCalledWith("codex");
      expect(manager.getOrCreateActiveSession).toHaveBeenCalledTimes(1);
    });
    it("preserves the binary error over authentication state (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      mockSessionDescriptor.mockReturnValue(backendRegistry.claude);
      mockAuthStatuses.claude = { signedIn: false };
      const { result } = render(
        { claude: { kind: "error", message: "Invalid binary" } },
        makeManager()
      );
      expect(result.current.cta.note).toBe("Invalid binary");
    });

    it("logs a failed session spawn instead of rejecting", async () => {
      const failure = new Error("spawn failed");
      const manager = makeManager(Promise.reject(failure));
      const { result } = render({ opencode: { kind: "ready", source: "managed" } }, manager);

      await act(async () => {
        result.current.runCta();
      });

      expect(logError).toHaveBeenCalledWith("[AgentMode] agent select start failed", failure);
    });
  });
});
