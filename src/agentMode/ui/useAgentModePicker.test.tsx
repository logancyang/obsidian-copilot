import { ClientView } from "@/agentMode/protocol/ClientView";
import type { BackendState } from "@/agentMode/session/types";
import {
  AgentPaneCapabilitiesProvider,
  NO_PANE_CAPABILITIES,
} from "@/agentMode/ui/AgentPaneContext";
import { createFixtureClient, type FixtureClientOptions } from "@/agentMode/ui/agentPane.fixtures";
import { useAgentModePicker } from "@/agentMode/ui/useAgentModePicker";
import { act, renderHook } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

jest.mock("obsidian", () => ({ Notice: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

const GLOBAL = "__global__";

const withModes: BackendState = {
  model: null,
  mode: {
    current: "default",
    options: [
      { value: "default", label: "Default" },
      { value: "plan", label: "Plan" },
    ],
    apply: {
      default: { kind: "setMode", nativeId: "default" },
      plan: { kind: "setMode", nativeId: "plan" },
    },
  },
};

function rig(options: Partial<FixtureClientOptions> = {}, state: BackendState | null = withModes) {
  const fixture = createFixtureClient({
    sessionId: "s1",
    tab: { backendId: "claude" },
    session: { backendState: state },
    ...options,
  });
  const view = new ClientView(GLOBAL);
  view.activate({ id: "s1", projectId: GLOBAL });
  const persistDefaultMode = jest.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AgentPaneCapabilitiesProvider
      value={{
        ...NO_PANE_CAPABILITIES,
        persistDefaults: { setDefaultBackend: jest.fn(), persistDefaultMode },
      }}
    >
      {children}
    </AgentPaneCapabilitiesProvider>
  );
  const hook = renderHook(() => useAgentModePicker(fixture.client, view), { wrapper });
  return { fixture, hook, persistDefaultMode, view };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("useAgentModePicker", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("useAgentModePicker()", () => {
    it("returns null while the shown session has not reported any modes", () => {
      expect(rig({}, null).hook.result.current).toBeNull();
    });

    it("returns null when no tab is shown", () => {
      const { hook, view } = rig();
      act(() => view.clearActive());
      expect(hook.result.current).toBeNull();
    });

    it("offers the modes the session's agent reported with the current one selected", () => {
      const { hook } = rig();
      expect(hook.result.current).toMatchObject({
        value: "default",
        disabled: false,
        options: [
          { value: "default", label: "Default" },
          { value: "plan", label: "Plan" },
        ],
      });
    });

    it("is disabled when the agent is known not to switch modes while running", () => {
      const { hook } = rig({ tab: { backendId: "claude", canSwitchMode: false } });
      expect(hook.result.current?.disabled).toBe(true);
    });

    it("applies a mode through the host and then remembers it as the agent's default", async () => {
      const { hook, fixture, persistDefaultMode } = rig();
      hook.result.current!.onChange("plan");
      await flush();
      expect(fixture.commands).toEqual([{ name: "applyMode", sessionId: "s1", mode: "plan" }]);
      expect(persistDefaultMode).toHaveBeenCalledWith("claude", "plan");
    });

    it("does not remember the mode when the host refuses it, and tells the user", async () => {
      const { hook, persistDefaultMode } = rig({
        onCommand: () => ({ ok: false, code: "unsupported", message: "no" }),
      });
      hook.result.current!.onChange("plan");
      await flush();
      expect(persistDefaultMode).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("This agent doesn't support runtime mode switching.");
    });

    it("sends nothing for a mode the agent has no way to apply", async () => {
      const { hook, fixture } = rig();
      hook.result.current!.onChange("auto");
      await flush();
      expect(fixture.commands).toEqual([]);
    });
  });
});
