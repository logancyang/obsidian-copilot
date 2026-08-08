import { backendRegistry } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, InstallState } from "@/agentMode/session/types";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { act, renderHook } from "@testing-library/react";
import { useAgentSelect } from "./useAgentSelect";
import { useBackendInstallStates, useSessionBackendDescriptor } from "./useBackendDescriptor";

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
  return {
    setDefaultBackend: jest.fn(),
    getOrCreateActiveSession: jest.fn().mockReturnValue(startResult),
  } as unknown as AgentSessionManager & {
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
