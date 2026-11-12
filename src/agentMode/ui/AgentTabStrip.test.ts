import { COPILOT_SESSION_AGENT } from "@/agentMode/session/sessionAgent";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import { AppContext } from "@/context";
import {
  makeFakeWorkspaceApp,
  type FakeWorkspaceApp,
} from "@/agentMode/ui/testing/fakeWorkspaceApp";
import { setNavigatorAccess } from "@/agentMode/ui/testing/navigatorAccess";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/entitlement");

function renderStrip(
  manager: unknown,
  { workspace = makeFakeWorkspaceApp(), onOpenSidebar = jest.fn() } = {}
) {
  return render(
    React.createElement(
      AppContext.Provider,
      { value: workspace.app },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(AgentTabStrip, {
          manager: manager as AgentSessionManager,
          onOpenSidebar,
          onUpdateMemory: jest.fn(),
        })
      )
    )
  );
}

function makeManagerWithOneChat() {
  const session = {
    internalId: "existing",
    backendId: "test",
    subscribe: () => () => {},
    getLabel: () => "Existing chat",
    getAgent: () => COPILOT_SESSION_AGENT,
    getStatus: () => "idle",
    getNeedsAttention: () => false,
  };
  return {
    subscribe: () => () => {},
    getSessionsForScope: () => [session],
    getActiveProjectId: () => null,
    getActiveSession: () => session,
    getIsStarting: () => false,
  };
}

describe("AgentTabStrip", () => {
  describe("AgentTabStrip()", () => {
    beforeEach(() => setNavigatorAccess("supporter"));
    afterEach(() => jest.restoreAllMocks());

    it("pins the active chat into the last visible slot and lists the rest in the overflow menu when the strip is too narrow for https://github.com/Brevilabs/obsidian-copilot-private/issues/891", () => {
      const sessions = ["First", "Second", "Third", "Fourth"].map((label) => ({
        internalId: label.toLowerCase(),
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => label,
        getAgent: () => COPILOT_SESSION_AGENT,
        getStatus: () => "idle",
        getNeedsAttention: () => false,
      }));
      const manager = {
        subscribe: () => () => {},
        getSessionsForScope: () => sessions,
        getActiveProjectId: () => null,
        getActiveSession: () => sessions[3],
        getIsStarting: () => false,
      };
      jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);

      renderStrip(manager);

      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["First", "Fourth"]);
      expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Fourth");
      expect(screen.getByRole("button", { name: "Show 2 more chats" })).not.toBeNull();
    });

    it("detaches a closed tab without closing its backend session for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", () => {
      const session = {
        internalId: "existing",
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => "Existing chat",
        getAgent: () => COPILOT_SESSION_AGENT,
        getStatus: () => "idle",
        getNeedsAttention: () => false,
      };
      const manager = {
        subscribe: () => () => {},
        getSessionsForScope: () => [session],
        getActiveProjectId: () => null,
        getActiveSession: () => session,
        getIsStarting: () => false,
        detachSessionFromTab: jest.fn(),
        closeSession: jest.fn(),
      };
      renderStrip(manager);

      fireEvent.click(screen.getByRole("button", { name: "Close tab" }));

      expect(manager.detachSessionFromTab).toHaveBeenCalledWith(session.internalId);
      expect(manager.closeSession).not.toHaveBeenCalled();
    });

    it("detaches a tab when it is middle-clicked and ignores other auxiliary buttons", () => {
      const session = {
        internalId: "existing",
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => "Existing chat",
        getAgent: () => COPILOT_SESSION_AGENT,
        getStatus: () => "idle",
        getNeedsAttention: () => false,
      };
      const manager = {
        subscribe: () => () => {},
        getSessionsForScope: () => [session],
        getActiveProjectId: () => null,
        getActiveSession: () => session,
        getIsStarting: () => false,
        detachSessionFromTab: jest.fn(),
      };
      renderStrip(manager);
      const tab = screen.getByRole("tab");

      fireEvent(tab, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
      expect(manager.detachSessionFromTab).not.toHaveBeenCalled();

      fireEvent(tab, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
      expect(manager.detachSessionFromTab).toHaveBeenCalledWith(session.internalId);
    });

    it("starts a new chat when the new-chat button is clicked", () => {
      const session = {
        internalId: "existing",
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => "Existing chat",
        getAgent: () => COPILOT_SESSION_AGENT,
        getStatus: () => "idle",
        getNeedsAttention: () => false,
      };
      const manager = {
        subscribe: () => () => {},
        getSessionsForScope: () => [session],
        getActiveProjectId: () => null,
        getActiveSession: () => session,
        getIsStarting: () => false,
        createSession: jest.fn(async () => undefined),
      };
      renderStrip(manager);
      fireEvent.click(screen.getByRole("button", { name: "New chat" }));
      expect(manager.createSession).toHaveBeenCalledTimes(1);
    });

    it("opens the sessions sidebar from the icon at the left end of the strip for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const onOpenSidebar = jest.fn();
      renderStrip(makeManagerWithOneChat(), { onOpenSidebar });

      const [leftmost] = screen.getAllByRole("button");
      expect(leftmost).toBe(screen.getByRole("button", { name: "Open Copilot Navigator" }));
      fireEvent.click(leftmost);

      expect(onOpenSidebar).toHaveBeenCalledTimes(1);
    });

    it("hides every tab while a sessions sidebar leaf exists and shows the same tabs once the last leaf closes for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const workspace = makeFakeWorkspaceApp();
      renderStrip(makeManagerWithOneChat(), { workspace });
      expect(screen.getByRole("tab", { name: /Existing chat/ })).toBeTruthy();

      act(() => workspace.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 }));
      expect(screen.queryByRole("tab")).toBeNull();
      expect(screen.queryByRole("button", { name: "Open Copilot Navigator" })).toBeNull();

      act(() => workspace.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 2 }));
      act(() => workspace.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 }));
      expect(screen.queryByRole("tab")).toBeNull();

      act(() => workspace.setLeaves({}));
      expect(screen.getByRole("tab", { name: /Existing chat/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open Copilot Navigator" })).toBeTruthy();
    });

    it("starts hidden when a sessions sidebar leaf already exists for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const workspace: FakeWorkspaceApp = makeFakeWorkspaceApp();
      workspace.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });

      renderStrip(makeManagerWithOneChat(), { workspace });

      expect(screen.queryByRole("tab")).toBeNull();
    });

    it("keeps the tabs and the Navigator icon beside a Navigator leaf blocked for a user without Navigator access for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("free");
      const workspace: FakeWorkspaceApp = makeFakeWorkspaceApp();
      workspace.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });

      renderStrip(makeManagerWithOneChat(), { workspace });

      expect(screen.getByRole("tab", { name: /Existing chat/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open Copilot Navigator" })).toBeTruthy();
    });
  });
});
