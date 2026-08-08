import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendAuth, BackendDescriptor } from "@/agentMode/session/types";
import type { BackendAuthUiState } from "@/agentMode/session/useBackendAuthState";
import type CopilotPlugin from "@/main";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

let descriptor: BackendDescriptor;

let installState: ReturnType<BackendDescriptor["getInstallState"]> = {
  kind: "ready",
  source: "custom",
};
let authState: BackendAuthUiState;

jest.mock("@/agentMode/ui/useBackendDescriptor", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks real hook exports
  useSessionBackendDescriptor: () => descriptor,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks real hook exports
  useBackendInstallState: () => installState,
}));

jest.mock("@/agentMode/session/useBackendAuthState", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook export
  useBackendAuthState: () => authState,
}));

jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook export
  useSettingsValue: () => ({}),
}));

describe("AgentModeStatus", () => {
  describe("AgentModeStatus()", () => {
    beforeEach(() => {
      descriptor = {
        id: "claude",
        displayName: "Claude",
        openInstallUI: jest.fn(),
      } as unknown as BackendDescriptor;
      installState = { kind: "ready", source: "custom" };
      authState = {
        status: null,
        signingIn: false,
        url: null,
        signIn: jest.fn(),
      };
      jest.clearAllMocks();
    });

    it("runs the supplied install action when the backend is absent", () => {
      installState = { kind: "absent" };
      const onInstallClick = jest.fn();
      const plugin = { app: {} } as unknown as CopilotPlugin;

      render(<AgentModeStatus plugin={plugin} onInstallClick={onInstallClick} />);

      fireEvent.click(screen.getByRole("button", { name: "Install Claude" }));
      expect(onInstallClick).toHaveBeenCalledTimes(1);
    });

    it("renders the checking state without an alert or action", () => {
      installState = { kind: "checking", source: "custom" };
      const plugin = { app: {} } as unknown as CopilotPlugin;

      render(<AgentModeStatus plugin={plugin} onInstallClick={jest.fn()} />);

      expect(screen.getByText("Checking Claude version…")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("renders the actionable backend boot error instead of a generic retry label", () => {
      const error =
        "Claude Code 2.1.205 is not supported. Copilot requires Claude Code 2.1.206 or newer. Update Claude Code with: npm install -g @anthropic-ai/claude-code";
      const manager = {
        subscribe: jest.fn(() => () => {}),
        getLastError: jest.fn(() => error),
        getOrCreateActiveSession: jest.fn().mockResolvedValue({}),
      } as unknown as AgentSessionManager;
      const plugin = { app: {} } as unknown as CopilotPlugin;

      render(<AgentModeStatus manager={manager} plugin={plugin} onInstallClick={jest.fn()} />);

      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(error)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(manager.getOrCreateActiveSession).toHaveBeenCalledTimes(1);
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

    it("runs an available upgrade once and disables the action while it is busy", () => {
      installState = {
        kind: "incompatible",
        source: "managed",
        currentVersion: "2.1.205",
        minVersion: "2.1.206",
        message: "Claude must be upgraded.",
      };
      const upgrade = jest.fn(() => new Promise<void>(() => undefined));
      descriptor = { ...descriptor, upgrade };
      const plugin = { app: {} } as unknown as CopilotPlugin;

      render(<AgentModeStatus plugin={plugin} onInstallClick={jest.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
      expect(upgrade).toHaveBeenCalledWith(plugin);
      expect(screen.getByRole("button", { name: "Upgrading…" }).hasAttribute("disabled")).toBe(
        true
      );
    });

    it("preserves the sign-in action and linked browser fallback", () => {
      descriptor = { ...descriptor, auth: {} as BackendAuth };
      authState = {
        status: { signedIn: false },
        signingIn: false,
        url: null,
        signIn: jest.fn(),
      };
      const plugin = { app: {} } as unknown as CopilotPlugin;
      const { rerender } = render(<AgentModeStatus plugin={plugin} onInstallClick={jest.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude" }));
      expect(authState.signIn).toHaveBeenCalledTimes(1);

      authState = {
        ...authState,
        signingIn: true,
        url: "https://example.com/sign-in",
      };
      rerender(<AgentModeStatus plugin={plugin} onInstallClick={jest.fn()} />);

      expect(screen.getByText("Signing in to Claude…")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open sign-in page" }).getAttribute("href")).toBe(
        "https://example.com/sign-in"
      );
    });
  });
});
