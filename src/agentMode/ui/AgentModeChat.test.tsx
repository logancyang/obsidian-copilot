import { AgentModeChat } from "@/agentMode/ui/AgentModeChat";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { ClientView } from "@/agentMode/protocol/ClientView";
import type { TabSummary } from "@/agentMode/protocol/state";
import { buildBackendSummary, buildTab } from "@/agentMode/protocol/testBuilders";
import { createFixtureClient } from "@/agentMode/ui/agentPane.fixtures";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { InstallState } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";

let mockInstallAction = { kind: "idle" } as { kind: string; label?: string; percent?: number };
let mockAuthStatus: { signedIn: boolean } | null = { signedIn: true };
let mockHasAuth = false;
let mockAuthChecking = false;
jest.mock("@/agentMode/session/useBackendAuthState", () => ({
  useBackendAuthState: jest.fn(() => ({ status: mockAuthStatus, checking: mockAuthChecking })),
}));

let mockManagedInstall: object | undefined;
let mockInstallState: InstallState = { kind: "ready", source: "custom" };

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

const GLOBAL: string = GLOBAL_SCOPE;

interface ChatStub {
  projectScope?: string;
  tabs?: TabSummary[];
  activeId?: string | null;
  preload?: "pending" | "ready" | "absent";
  startFailed?: boolean;
  starting?: boolean;
}

function makeChat({
  projectScope = GLOBAL,
  tabs = [],
  activeId = null,
  preload = "ready",
  startFailed = false,
  starting = false,
}: ChatStub = {}) {
  const getOrCreateActiveSession = jest.fn(async () => undefined);
  const manager = { getOrCreateActiveSession } as unknown as AgentSessionManager;
  const fixture = createFixtureClient({
    sessionId: "fixture",
    host: {
      tabs,
      backends: [buildBackendSummary({ id: "claude", preload })],
      host: {
        defaultBackendId: null,
        startingBackendId: starting ? "claude" : null,
        startFailed,
      },
    },
  });
  const view = new ClientView(projectScope);
  view.reconcile(fixture.client.getHost());
  if (activeId) view.activate({ id: activeId, projectId: projectScope });
  const plugin = {
    app: {},
    agentSessionManager: manager,
    agentSessionClient: fixture.client,
    agentSessionView: view,
  } as unknown as CopilotPlugin;
  return { manager, getOrCreateActiveSession, fixture, view, plugin };
}

const tab = (id: string, projectId = GLOBAL): TabSummary =>
  buildTab({ id, chatInputId: `in-${id}`, projectId });

function renderChat(chat: ReturnType<typeof makeChat>) {
  return render(
    <AgentModeChat plugin={chat.plugin} onSaveChat={() => {}} updateUserMessageHistory={() => {}} />
  );
}

function renderFallback(installState: InstallState, startFailed: boolean, starting = false) {
  mockInstallState = installState;
  renderChat(makeChat({ startFailed, starting }));
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
      const chat = makeChat({ preload: "pending" });
      const { rerender } = renderChat(chat);
      expect(screen.getByText("Downloading agent…")).toBeTruthy();
      expect(screen.getByRole("progressbar")).toBeTruthy();
      expect(screen.queryByText("Loading agent models…")).toBeNull();
      expect(chat.getOrCreateActiveSession).not.toHaveBeenCalled();
      mockInstallAction = { kind: "idle" };
      act(() => {
        chat.fixture.emitHost({
          t: "backend.set",
          index: 0,
          backend: buildBackendSummary({ id: "claude", preload: "ready" }),
        });
      });
      rerender(
        <AgentModeChat
          plugin={chat.plugin}
          onSaveChat={() => {}}
          updateUserMessageHistory={() => {}}
        />
      );
      await waitFor(() => expect(chat.getOrCreateActiveSession).toHaveBeenCalledTimes(1));
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
      false
    );
    expect(screen.getByTestId("status-card")).toBeTruthy();
    expect(screen.queryByTestId("select-panel")).toBeNull();
  });

  describe("shown tab", () => {
    it("shows the home for the tab this client's view shows", () => {
      renderChat(makeChat({ tabs: [tab("s-1"), tab("s-2")], activeId: "s-2" }));
      expect(screen.getByTestId("agent-home")).toBeTruthy();
    });

    it("does not show a tab another client created until this client's view chooses it https://github.com/Brevilabs/obsidian-copilot-private/issues/612", () => {
      const chat = makeChat({ tabs: [tab("mine")], activeId: "mine" });
      renderChat(chat);
      act(() => {
        chat.fixture.emitHost({ t: "tab.add", index: 1, tab: tab("phone-made") });
      });
      expect(chat.view.getActiveTabId()).toBe("mine");
      expect(screen.getByTestId("agent-home")).toBeTruthy();
    });
  });

  describe("auto-spawn guard (scope-aware)", () => {
    it("regression: spawns the current project scope's session even when another scope still has sessions", async () => {
      const chat = makeChat({ projectScope: "project-1", tabs: [tab("global-1")] });
      renderChat(chat);
      await waitFor(() => expect(chat.getOrCreateActiveSession).toHaveBeenCalledTimes(1));
    });

    it("spawns the global scope's session when global is empty but a project still has sessions", async () => {
      const chat = makeChat({ tabs: [tab("project-1-s1", "project-1")] });
      renderChat(chat);
      await waitFor(() => expect(chat.getOrCreateActiveSession).toHaveBeenCalledTimes(1));
    });

    it("does not spawn when the current scope already has a session (single-scope behavior unchanged)", async () => {
      const chat = makeChat({ tabs: [tab("global-1")] });
      renderChat(chat);
      await act(async () => {});
      expect(chat.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("does not spawn while the host is starting a session or reports a failed start https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
      const starting = makeChat({ starting: true });
      renderChat(starting);
      const failed = makeChat({ startFailed: true });
      renderChat(failed);
      await act(async () => {});
      expect(starting.getOrCreateActiveSession).not.toHaveBeenCalled();
      expect(failed.getOrCreateActiveSession).not.toHaveBeenCalled();
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
        false
      );
      expect(screen.getByTestId("select-panel")).toBeTruthy();
    });
    it("waits for fresh authentication despite cached sign-in (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      mockHasAuth = true;
      mockAuthChecking = true;
      const chat = makeChat();
      renderChat(chat);
      expect(screen.getByText("Checking agent sign-in…")).toBeTruthy();
      expect(chat.getOrCreateActiveSession).not.toHaveBeenCalled();
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
          [false, true].map((startFailed) => ({
            name,
            state,
            signedOut,
            preloadReady,
            startFailed,
          }))
        )
      )
    )(
      "shows $name with preload=$preloadReady and startFailed=$startFailed (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)",
      ({ state, signedOut, preloadReady, startFailed }) => {
        mockInstallState = state;
        mockManagedInstall = {};
        mockHasAuth = signedOut;
        mockAuthStatus = { signedIn: !signedOut };
        const chat = makeChat({
          startFailed,
          starting: true,
          preload: preloadReady ? "ready" : "pending",
        });
        renderChat(chat);
        expect(screen.getByTestId("select-panel")).toBeTruthy();
        expect(screen.queryByText("Loading agent models…")).toBeNull();
        expect(chat.getOrCreateActiveSession).not.toHaveBeenCalled();
      }
    );
    it.each(failures)(
      "keeps the chat mounted when %s becomes known during preload (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)",
      (_name, state, signedOut) => {
        const chat = makeChat({ tabs: [tab("s-1")], activeId: "s-1" });
        const { rerender } = renderChat(chat);
        const home = screen.getByTestId("agent-home");
        mockInstallState = state;
        mockHasAuth = signedOut;
        mockAuthStatus = { signedIn: !signedOut };
        act(() => {
          chat.fixture.emitHost({
            t: "backend.set",
            index: 0,
            backend: buildBackendSummary({ id: "claude", preload: "pending" }),
          });
        });
        rerender(
          <AgentModeChat
            plugin={chat.plugin}
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
      const chat = makeChat();
      const { rerender } = renderChat(chat);
      expect(chat.getOrCreateActiveSession).not.toHaveBeenCalled();
      const renderAgain = () =>
        rerender(
          <AgentModeChat
            plugin={chat.plugin}
            onSaveChat={() => {}}
            updateUserMessageHistory={() => {}}
          />
        );
      mockAuthStatus = { signedIn: false };
      renderAgain();
      expect(screen.getByTestId("select-panel")).toBeTruthy();
      expect(chat.getOrCreateActiveSession).not.toHaveBeenCalled();
      mockAuthStatus = { signedIn: true };
      renderAgain();
      expect(chat.getOrCreateActiveSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("no-session fallback", () => {
    it("takes the pane over with the agent select view when no agent is set up", () => {
      renderFallback({ kind: "absent" }, false);

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
        false
      );

      expect(screen.getByTestId("select-panel")).toBeTruthy();
    });

    it("takes the pane over when the agent's readiness check failed", () => {
      renderFallback({ kind: "error", message: "not executable" }, false);

      expect(screen.getByTestId("select-panel")).toBeTruthy();
    });

    it("keeps the compact card while a readiness check is in flight", () => {
      renderFallback({ kind: "checking", source: "custom" }, false);

      expect(screen.getByTestId("status-card")).toBeTruthy();
      expect(screen.queryByTestId("select-panel")).toBeNull();
    });

    it("shows known missing installation while starting (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      renderFallback({ kind: "absent" }, false, true);

      expect(screen.getByTestId("select-panel")).toBeTruthy();
      expect(screen.queryByTestId("status-card")).toBeNull();
    });

    it("shows known missing installation despite a failed start (https://github.com/Brevilabs/obsidian-copilot-private/issues/532)", () => {
      renderFallback({ kind: "absent" }, true);

      expect(screen.getByTestId("select-panel")).toBeTruthy();
      expect(screen.queryByTestId("status-card")).toBeNull();
    });

    it("keeps the compact card when a ready agent crashed with no surviving session", () => {
      renderFallback({ kind: "ready", source: "custom" }, true);

      expect(screen.getByTestId("status-card")).toBeTruthy();
      expect(screen.queryByTestId("select-panel")).toBeNull();
    });

    it("leaves Agent Mode reachable below the select view", () => {
      renderFallback({ kind: "absent" }, false);

      expect(screen.getByTestId("chat-controls")).toBeTruthy();
    });

    it("leaves Agent Mode reachable below the compact card", () => {
      renderFallback({ kind: "ready", source: "custom" }, true);

      expect(screen.getByTestId("chat-controls")).toBeTruthy();
    });

    it("renders nothing where the desktop session core is unavailable", () => {
      const { container } = render(
        <AgentModeChat
          plugin={{ app: {} } as unknown as CopilotPlugin}
          onSaveChat={() => {}}
          updateUserMessageHistory={() => {}}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });
});
