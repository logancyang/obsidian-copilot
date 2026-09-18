import { AgentModeChat } from "@/agentMode/ui/AgentModeChat";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { InstallState } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

// Readiness of the backend the pane would run, swapped per test. Declared with
// the `mock` prefix so Jest allows the mock factory below to close over it.
let mockManagedInstall: object | undefined;
let mockInstallState: InstallState = { kind: "ready", source: "custom" };
const mockCommitSelection = jest.fn();
jest.mock("@/agentMode/ui/useAgentModelPicker", () => ({
  useAgentModelPicker: jest.fn(() => ({
    models: [
      { name: "saved", displayName: "Saved model", provider: "agent", enabled: true },
      { name: "other", displayName: "Other saved model", provider: "agent", enabled: true },
    ],
    value: "saved|agent",
    effortOptionsByModelKey: {},
    commitSelection: mockCommitSelection,
  })),
}));

// Stub the descriptor hooks so the effect's `preloadReady`/install gates are
// satisfied without the real backend registry / jotai atoms. The mock factory
// names must match the real `use*` exports, so the no-hook `use` prefix is
// expected here.
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/agentMode/ui/useBackendDescriptor", () => ({
  useSessionBackendDescriptor: () => ({
    id: "claude",
    managedInstall: mockManagedInstall,
    openInstallUI: jest.fn(),
  }),
  useBackendInstallState: () => mockInstallState,
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

// Heavy children are irrelevant to the guards under test — render markers so
// the no-session fallback's branch is observable without their real trees.
let mockLastDraft: { input: string; setInput: (v: string) => void } | null = null;
jest.mock("@/agentMode/ui/AgentHome", () => ({
  AgentHome: (props: { draft: { input: string; setInput: (v: string) => void } }) => {
    mockLastDraft = props.draft;
    return <div data-testid="agent-home">{props.draft.input}</div>;
  },
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
    getLiveChatInputIds: jest.fn(() => []),
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
    mockManagedInstall = undefined;
    mockInstallState = { kind: "ready", source: "custom" };
    mockLastDraft = null;
    mockCommitSelection.mockClear();
  });

  describe("compose draft ownership", () => {
    it("offers saved models on cold incompatible startup (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
      renderFallback(
        {
          kind: "incompatible",
          source: "custom",
          currentVersion: "1",
          minVersion: "2",
          message: "Upgrade required",
        },
        null
      );
      expect(screen.getByRole("button", { name: /Saved model/i })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Saved model/i }));
      fireEvent.click(screen.getByRole("option", { name: /Other saved model/i }));
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
      expect(mockCommitSelection).toHaveBeenCalledWith("other|agent", null);
    });
    it("keeps the unsent message across a restart that leaves no active session (https://github.com/Brevilabs/obsidian-copilot-private/issues/473)", () => {
      // A backend restart closes the session before its replacement exists. With
      // the draft store inside AgentHome, that gap unmounts the component and
      // destroys the text the user had typed but not sent.
      const active = { internalId: "s-1", chatInputId: "chat-1" } as unknown as AgentSession;
      const { manager } = makeManager({
        activeProjectId: GLOBAL_SCOPE,
        scopeSessions: [active],
        poolSessions: [active],
      });
      const getActiveSession = manager.getActiveSession as jest.Mock;
      const getActiveChatUIState = manager.getActiveChatUIState as jest.Mock;
      const getLiveChatInputIds = manager.getLiveChatInputIds as jest.Mock;
      getActiveSession.mockReturnValue(active);
      getActiveChatUIState.mockReturnValue({});
      getLiveChatInputIds.mockReturnValue(["chat-1"]);

      const { rerender } = renderChat(manager);
      act(() => mockLastDraft!.setInput("half-written question"));
      expect(screen.getByTestId("agent-home").textContent).toBe("half-written question");

      // The restart gap: no active session, but the manager still vouches for
      // the chat input, so the draft must not be pruned.
      getActiveSession.mockReturnValue(null);
      getActiveChatUIState.mockReturnValue(null);
      const plugin = { app: {}, agentSessionManager: manager } as unknown as CopilotPlugin;
      rerender(
        <AgentModeChat plugin={plugin} onSaveChat={() => {}} updateUserMessageHistory={() => {}} />
      );
      expect(screen.queryByTestId("agent-home")).toBeNull();

      // The replacement session reuses the same chat input.
      getActiveSession.mockReturnValue(active);
      getActiveChatUIState.mockReturnValue({});
      rerender(
        <AgentModeChat plugin={plugin} onSaveChat={() => {}} updateUserMessageHistory={() => {}} />
      );
      expect(screen.getByTestId("agent-home").textContent).toBe("half-written question");
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

  describe("no-session fallback", () => {
    it("takes the pane over with the agent select view when no agent is set up", () => {
      renderFallback({ kind: "absent" }, null);

      expect(screen.getByTestId("select-panel")).toBeTruthy();
      expect(screen.queryByTestId("status-card")).toBeNull();
    });

    it("keeps the status and saved-model picker available when the agent's binary is too old (https://github.com/Brevilabs/obsidian-copilot-private/issues/480)", () => {
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

      expect(screen.getByTestId("status-card")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Saved model/i })).toBeTruthy();
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

    it("keeps the compact card while a backend session is already starting", () => {
      renderFallback({ kind: "absent" }, null, true);

      expect(screen.getByTestId("status-card")).toBeTruthy();
      expect(screen.queryByTestId("select-panel")).toBeNull();
    });

    it("regression: keeps the compact card when a boot error coincides with an absent backend", () => {
      // Deleting the binary under a running agent sets both. A setup screen
      // would bury the failure that just happened; the card still surfaces the
      // Install call to action for an absent backend.
      renderFallback({ kind: "absent" }, "opencode backend exited unexpectedly.");

      expect(screen.getByTestId("status-card")).toBeTruthy();
      expect(screen.queryByTestId("select-panel")).toBeNull();
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
