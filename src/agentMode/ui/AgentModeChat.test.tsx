import { AgentModeChat } from "@/agentMode/ui/AgentModeChat";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { InstallState } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// Readiness of the backend the pane would run, swapped per test. Declared with
// the `mock` prefix so Jest allows the mock factory below to close over it.
let mockInstallAction = { kind: "idle" } as { kind: string; label?: string; percent?: number };
let mockAuthStatus: { signedIn: boolean } | null = { signedIn: true };
let mockHasAuth = false;
let mockAuthChecking = false;
jest.mock("@/agentMode/session/useBackendAuthState", () => ({
  useBackendAuthState: jest.fn(() => ({ status: mockAuthStatus, checking: mockAuthChecking })),
}));

let mockManagedInstall: object | undefined;
let mockInstallState: InstallState = { kind: "ready", source: "custom" };

// Stub the descriptor hooks so the effect's `preloadReady`/install gates are
// satisfied without the real backend registry / jotai atoms. The mock factory
// names must match the real `use*` exports, so the no-hook `use` prefix is
// expected here.
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/agentMode/ui/useBackendDescriptor", () => ({
  useSessionBackendDescriptor: () => ({
    id: "claude",
    displayName: "Claude",
    auth: mockHasAuth ? {} : undefined,
    managedInstall: mockManagedInstall,
    openInstallUI: jest.fn(),
  }),
  useBackendInstallState: () => mockInstallState,
  useManagedInstallActionState: () => mockInstallAction,
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

// Heavy children are irrelevant to the guards under test — render markers so
// the no-session fallback's branch is observable without their real trees.
jest.mock("@/agentMode/ui/AgentHome", () => ({
  AgentHome: () => <div data-testid="agent-home" />,
}));
jest.mock("@/agentMode/ui/AgentModeStatus", () => ({
  AgentModeStatus: () => <div data-testid="status-card" />,
}));
jest.mock("@/agentMode/ui/AgentSelectPanel", () => ({
  AgentSelectPanel: () => <div data-testid="select-panel" />,
}));
jest.mock("@/agentMode/ui/AgentChatControls", () => ({
  AgentChatControls: () => <div data-testid="chat-controls" />,
}));

const session = (id: string): AgentSession => ({ internalId: id }) as unknown as AgentSession;

interface ManagerStub {
  activeProjectId: string;
  scopeSessions: AgentSession[];
  poolSessions: AgentSession[];
  lastError?: string | null;
  starting?: boolean;
}

function makeManager({
  activeProjectId,
  scopeSessions,
  poolSessions,
  lastError = null,
  starting = false,
}: ManagerStub) {
  const getOrCreateActiveSession = jest.fn(async () => session("spawned"));
  const manager = {
    subscribe: jest.fn(() => () => {}),
    isPreloadReady: jest.fn(() => true),
    getSessions: jest.fn(() => poolSessions),
    getSessionsForScope: jest.fn(() => scopeSessions),
    getActiveProjectId: jest.fn(() => activeProjectId),
    getIsStarting: jest.fn(() => starting),
    getLastError: jest.fn(() => lastError),
    getActiveSession: jest.fn(() => null),
    getActiveChatUIState: jest.fn(() => null),
    getOrCreateActiveSession,
  } as unknown as AgentSessionManager & { getOrCreateActiveSession: jest.Mock };
  return { manager, getOrCreateActiveSession };
}

function renderChat(manager: AgentSessionManager) {
  const plugin = { app: {}, agentSessionManager: manager } as unknown as CopilotPlugin;
  return render(
    <AgentModeChat plugin={plugin} onSaveChat={() => {}} updateUserMessageHistory={() => {}} />
  );
}

/** Render the no-session fallback with the given readiness and boot error. */
function renderFallback(installState: InstallState, lastError: string | null, starting = false) {
  mockInstallState = installState;
  const { manager } = makeManager({
    activeProjectId: GLOBAL_SCOPE,
    scopeSessions: [],
    poolSessions: [],
    lastError,
    starting,
  });
  renderChat(manager);
}

describe("AgentModeChat", () => {
  afterEach(() => {
    mockHasAuth = false;
    mockAuthChecking = false;
    mockAuthStatus = { signedIn: true };
    mockManagedInstall = undefined;
    mockInstallAction = { kind: "idle" };
    mockInstallState = { kind: "ready", source: "custom" };
  });

  describe("startup upgrade", () => {
    it("shows download progress before model loading and starts chat when the download settles (https://github.com/Brevilabs/obsidian-copilot-private/issues/530)", async () => {
      mockInstallState = { kind: "ready", source: "managed" };
      mockInstallAction = { kind: "running", label: "Downloading agent…", percent: 42 };
      const { manager, getOrCreateActiveSession } = makeManager({
        activeProjectId: GLOBAL_SCOPE,
        scopeSessions: [],
        poolSessions: [],
      });
      (manager.isPreloadReady as jest.Mock).mockReturnValue(false);
      const { rerender } = renderChat(manager);
      expect(screen.getByText("Downloading agent…")).toBeTruthy();
      expect(screen.getByRole("progressbar")).toBeTruthy();
      expect(screen.queryByText("Loading agent models…")).toBeNull();
      expect(getOrCreateActiveSession).not.toHaveBeenCalled();
      mockInstallAction = { kind: "idle" };
      (manager.isPreloadReady as jest.Mock).mockReturnValue(true);
      rerender(
        <AgentModeChat
          plugin={{ app: {}, agentSessionManager: manager } as unknown as CopilotPlugin}
          onSaveChat={() => {}}
          updateUserMessageHistory={() => {}}
        />
      );
      await waitFor(() => expect(getOrCreateActiveSession).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("progressbar")).toBeNull();
    });
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/368 keeps a cold-start managed upgrade on the shared status card", () => {
    mockManagedInstall = {};
    renderFallback(
      {
        kind: "incompatible",
        source: "managed",
        currentVersion: "1",
        minVersion: "2",
        message: "Update required",
      },
      null
    );
    expect(screen.getByTestId("status-card")).toBeTruthy();
    expect(screen.queryByTestId("select-panel")).toBeNull();
  });

  describe("auto-spawn guard (scope-aware)", () => {
    it("regression: spawns the current project scope's session even when another scope still has sessions", async () => {
      // The closed scope (project-1) is empty, but the global pool still holds a
      // session. A whole-pool guard would skip the spawn and strand the pane on
      // the no-session fallback; the scope-aware guard must re-spawn project-1.
      const { manager, getOrCreateActiveSession } = makeManager({
        activeProjectId: "project-1",
        scopeSessions: [],
        poolSessions: [session("global-1")],
      });

      renderChat(manager);

      await waitFor(() => expect(getOrCreateActiveSession).toHaveBeenCalledTimes(1));
    });

    it("spawns the global scope's session when global is empty but a project still has sessions", async () => {
      const { manager, getOrCreateActiveSession } = makeManager({
        activeProjectId: GLOBAL_SCOPE,
        scopeSessions: [],
        poolSessions: [session("project-1-s1")],
      });

      renderChat(manager);

      await waitFor(() => expect(getOrCreateActiveSession).toHaveBeenCalledTimes(1));
    });

    it("does not spawn when the current scope already has a session (single-scope behavior unchanged)", async () => {
      const { manager, getOrCreateActiveSession } = makeManager({
        activeProjectId: GLOBAL_SCOPE,
        scopeSessions: [session("global-1")],
        poolSessions: [session("global-1")],
      });

      renderChat(manager);

      // Flush effects, then assert the guard short-circuited.
      await waitFor(() => expect(manager.getSessionsForScope).toHaveBeenCalled());
      expect(getOrCreateActiveSession).not.toHaveBeenCalled();
    });
  });

  describe("known launch blockers", () => {
    it("routes an outdated auto-detected backend without managed installation to setup (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      renderFallback(
        {
          kind: "incompatible",
          source: "managed",
          currentVersion: "1",
          minVersion: "2",
          message: "Too old",
        },
        null
      );
      expect(screen.getByTestId("select-panel")).toBeTruthy();
    });
    it("waits for fresh authentication despite cached sign-in (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      mockHasAuth = true;
      mockAuthChecking = true;
      const { manager, getOrCreateActiveSession } = makeManager({
        activeProjectId: GLOBAL_SCOPE,
        scopeSessions: [],
        poolSessions: [],
      });
      renderChat(manager);
      expect(screen.getByText("Checking agent sign-in…")).toBeTruthy();
      expect(getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    const failures: Array<[string, InstallState, boolean]> = [
      ["missing", { kind: "absent" }, false],
      ["corrupt", { kind: "error", message: "Cannot execute binary" }, false],
      [
        "outdated custom",
        {
          kind: "incompatible",
          source: "custom",
          currentVersion: "1",
          minVersion: "2",
          message: "Too old",
        },
        false,
      ],
      ["signed out", { kind: "ready", source: "custom" }, true],
    ];
    it.each(
      failures.flatMap(([name, state, signedOut]) =>
        [false, true].flatMap((preloadReady) =>
          [null, "Previous failure"].map((lastError) => ({
            name,
            state,
            signedOut,
            preloadReady,
            lastError,
          }))
        )
      )
    )(
      "shows $name with preload=$preloadReady and error=$lastError (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)",
      ({ state, signedOut, preloadReady, lastError }) => {
        mockInstallState = state;
        mockManagedInstall = {};
        mockHasAuth = signedOut;
        mockAuthStatus = { signedIn: !signedOut };
        const { manager, getOrCreateActiveSession } = makeManager({
          activeProjectId: GLOBAL_SCOPE,
          scopeSessions: [],
          poolSessions: [],
          lastError,
          starting: true,
        });
        (manager.isPreloadReady as jest.Mock).mockReturnValue(preloadReady);
        renderChat(manager);
        expect(screen.getByTestId("select-panel")).toBeTruthy();
        expect(screen.queryByText("Loading agent models…")).toBeNull();
        expect(getOrCreateActiveSession).not.toHaveBeenCalled();
      }
    );
    it.each(failures)(
      "keeps the chat mounted when %s becomes known during preload (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)",
      (_name, state, signedOut) => {
        const active = { internalId: "s-1", chatInputId: "chat-1" } as AgentSession;
        const { manager } = makeManager({
          activeProjectId: GLOBAL_SCOPE,
          scopeSessions: [active],
          poolSessions: [active],
        });
        (manager.getActiveSession as jest.Mock).mockReturnValue(active);
        (manager.getActiveChatUIState as jest.Mock).mockReturnValue({});
        const { rerender } = renderChat(manager);
        const home = screen.getByTestId("agent-home");
        mockInstallState = state;
        mockHasAuth = signedOut;
        mockAuthStatus = { signedIn: !signedOut };
        (manager.isPreloadReady as jest.Mock).mockReturnValue(false);
        rerender(
          <AgentModeChat
            plugin={{ agentSessionManager: manager } as unknown as CopilotPlugin}
            onSaveChat={() => {}}
            updateUserMessageHistory={() => {}}
          />
        );
        expect(screen.getByTestId("agent-home")).toBe(home);
      }
    );
    it("waits for authentication before auto-starting and starts after sign-in (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      mockHasAuth = true;
      mockAuthStatus = null;
      const { manager, getOrCreateActiveSession } = makeManager({
        activeProjectId: GLOBAL_SCOPE,
        scopeSessions: [],
        poolSessions: [],
      });
      const { rerender } = renderChat(manager);
      expect(getOrCreateActiveSession).not.toHaveBeenCalled();
      const renderAgain = () =>
        rerender(
          <AgentModeChat
            plugin={{ agentSessionManager: manager } as unknown as CopilotPlugin}
            onSaveChat={() => {}}
            updateUserMessageHistory={() => {}}
          />
        );
      mockAuthStatus = { signedIn: false };
      renderAgain();
      expect(screen.getByTestId("select-panel")).toBeTruthy();
      expect(getOrCreateActiveSession).not.toHaveBeenCalled();
      mockAuthStatus = { signedIn: true };
      renderAgain();
      expect(getOrCreateActiveSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("no-session fallback", () => {
    it("takes the pane over with the agent select view when no agent is set up", () => {
      renderFallback({ kind: "absent" }, null);

      expect(screen.getByTestId("select-panel")).toBeTruthy();
      expect(screen.queryByTestId("status-card")).toBeNull();
    });

    it("takes the pane over when the agent's binary is too old to run", () => {
      renderFallback(
        {
          kind: "incompatible",
          source: "custom",
          currentVersion: "2.1.205",
          minVersion: "2.1.206",
          message: "too old",
        },
        null
      );

      expect(screen.getByTestId("select-panel")).toBeTruthy();
    });

    it("takes the pane over when the agent's readiness check failed", () => {
      renderFallback({ kind: "error", message: "not executable" }, null);

      expect(screen.getByTestId("select-panel")).toBeTruthy();
    });

    it("keeps the compact card while a readiness check is in flight", () => {
      // `checking` resolves on its own; flashing the select view and swapping it
      // straight back out is worse than the card's one-line "Checking…".
      renderFallback({ kind: "checking", source: "custom" }, null);

      expect(screen.getByTestId("status-card")).toBeTruthy();
      expect(screen.queryByTestId("select-panel")).toBeNull();
    });

    it("shows known missing installation while starting (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      renderFallback({ kind: "absent" }, null, true);

      expect(screen.getByTestId("select-panel")).toBeTruthy();
      expect(screen.queryByTestId("status-card")).toBeNull();
    });

    it("shows known missing installation despite a boot error (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      renderFallback({ kind: "absent" }, "opencode backend exited unexpectedly.");

      expect(screen.getByTestId("select-panel")).toBeTruthy();
      expect(screen.queryByTestId("status-card")).toBeNull();
    });

    it("keeps the compact card when a ready agent crashed with no surviving session", () => {
      renderFallback({ kind: "ready", source: "custom" }, "claude backend exited unexpectedly.");

      expect(screen.getByTestId("status-card")).toBeTruthy();
      expect(screen.queryByTestId("select-panel")).toBeNull();
    });

    it("leaves Agent Mode reachable below the select view", () => {
      renderFallback({ kind: "absent" }, null);

      expect(screen.getByTestId("chat-controls")).toBeTruthy();
    });

    it("leaves Agent Mode reachable below the compact card", () => {
      renderFallback({ kind: "ready", source: "custom" }, "boom");

      expect(screen.getByTestId("chat-controls")).toBeTruthy();
    });
  });
});
