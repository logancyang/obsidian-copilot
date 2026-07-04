import { AgentModeChat } from "@/agentMode/ui/AgentModeChat";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type CopilotPlugin from "@/main";
import { render, waitFor } from "@testing-library/react";
import React from "react";

// Stub the descriptor hooks so the effect's `preloadReady`/install gates are
// satisfied without the real backend registry / jotai atoms. The mock factory
// names must match the real `use*` exports, so the no-hook `use` prefix is
// expected here.
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/agentMode/ui/useBackendDescriptor", () => ({
  useActiveBackendDescriptor: () => ({ id: "claude", openInstallUI: jest.fn() }),
  useBackendInstallState: () => ({ kind: "installed" }),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

// Heavy children are irrelevant to the auto-spawn guard — render nothing.
jest.mock("@/agentMode/ui/AgentHome", () => ({ AgentHome: () => null }));
jest.mock("@/agentMode/ui/AgentModeStatus", () => ({ AgentModeStatus: () => null }));
jest.mock("@/agentMode/ui/AgentChatControls", () => ({ AgentChatControls: () => null }));

const session = (id: string): AgentSession => ({ internalId: id }) as unknown as AgentSession;

interface ManagerStub {
  activeProjectId: string;
  scopeSessions: AgentSession[];
  poolSessions: AgentSession[];
}

function makeManager({ activeProjectId, scopeSessions, poolSessions }: ManagerStub) {
  const getOrCreateActiveSession = jest.fn(async () => session("spawned"));
  const manager = {
    subscribe: jest.fn(() => () => {}),
    isPreloadReady: jest.fn(() => true),
    getSessions: jest.fn(() => poolSessions),
    getSessionsForScope: jest.fn(() => scopeSessions),
    getActiveProjectId: jest.fn(() => activeProjectId),
    getIsStarting: jest.fn(() => false),
    getLastError: jest.fn(() => null),
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

describe("AgentModeChat auto-spawn guard (scope-aware)", () => {
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
