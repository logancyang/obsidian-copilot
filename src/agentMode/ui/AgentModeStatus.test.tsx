import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const descriptor = {
  id: "claude",
  displayName: "Claude",
  openInstallUI: jest.fn(),
} as unknown as BackendDescriptor;

let installState: ReturnType<BackendDescriptor["getInstallState"]> = {
  kind: "ready",
  source: "custom",
};

jest.mock("@/agentMode/ui/useBackendDescriptor", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks real hook exports
  useSessionBackendDescriptor: () => descriptor,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks real hook exports
  useBackendInstallState: () => installState,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks real hook exports
  useBackendAuthState: () => ({ status: null, signingIn: false, url: null, signIn: jest.fn() }),
}));

jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook export
  useSettingsValue: () => ({}),
}));

describe("AgentModeStatus", () => {
  describe("AgentModeStatus()", () => {
    beforeEach(() => {
      installState = { kind: "ready", source: "custom" };
      jest.clearAllMocks();
    });

    it("renders the actionable backend boot error instead of a generic retry label", () => {
      const error =
        "Claude Code 2.1.205 is not supported. Copilot requires Claude Code 2.1.206 or newer. Update Claude Code with: npm install -g @anthropic-ai/claude-code";
      const manager = {
        subscribe: jest.fn(() => () => {}),
        getLastError: jest.fn(() => error),
        getOrCreateActiveSession: jest.fn(),
      } as unknown as AgentSessionManager;
      const plugin = { app: {} } as unknown as CopilotPlugin;

      render(<AgentModeStatus manager={manager} plugin={plugin} onInstallClick={jest.fn()} />);

      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(error)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(screen.queryByText("Error — click Retry")).toBeNull();
    });

    it("opens Claude configuration instead of retrying an incompatible version", () => {
      const message =
        "Claude Code 2.1.205 is not supported. Copilot requires Claude Code 2.1.206 or newer.";
      installState = {
        kind: "incompatible",
        source: "custom",
        currentVersion: "2.1.205",
        minVersion: "2.1.206",
        message,
      };
      const manager = {
        subscribe: jest.fn(() => () => {}),
        getLastError: jest.fn(() => `${message} Update with npm install`),
        getOrCreateActiveSession: jest.fn(),
      } as unknown as AgentSessionManager;
      const plugin = { app: {} } as unknown as CopilotPlugin;

      render(<AgentModeStatus manager={manager} plugin={plugin} onInstallClick={jest.fn()} />);

      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Configure Claude" }));
      expect(descriptor.openInstallUI).toHaveBeenCalledWith(plugin);
    });
  });
});
