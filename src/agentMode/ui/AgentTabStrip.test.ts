import {
  AgentTabOverflowMenu,
  AgentTabStrip,
  computeVisibleCount,
  partitionSessions,
} from "@/agentMode/ui/AgentTabStrip";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import { AppContext } from "@/context";
import {
  makeFakeWorkspaceApp,
  type FakeWorkspaceApp,
} from "@/agentMode/ui/testing/fakeWorkspaceApp";
import { refreshLatestVersion } from "@/hooks/useLatestVersion";
import { setSettings } from "@/settings/model";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

jest.mock("@/hooks/useLatestVersion", () => ({ refreshLatestVersion: jest.fn() }));

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
        })
      )
    )
  );
}

function makeSessions(labels: string[]): AgentSession[] {
  return labels.map(
    (label, index) =>
      ({
        internalId: index === 0 ? "existing" : `chat-${index}`,
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => label,
        getStatus: () => "idle",
        getNeedsAttention: () => false,
      }) as unknown as AgentSession
  );
}

function makeManagerWithChats(labels: string[]) {
  const sessions = makeSessions(labels);
  return {
    subscribe: () => () => {},
    getSessionsForScope: () => sessions,
    getActiveProjectId: () => null,
    getActiveSession: () => sessions[0],
    getIsStarting: () => false,
  };
}

function makeManagerWithOneChat() {
  return makeManagerWithChats(["Existing chat"]);
}

const CARD_COPY = "Too many chats? Copilot Navigator keeps every agent chat in one sidebar.";

function renderOverflowMenu(props: Partial<React.ComponentProps<typeof AgentTabOverflowMenu>>) {
  return render(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(AgentTabOverflowMenu, {
        sessions: makeSessions(["Plan the garden", "Review the template"]),
        activeId: null,
        showPlusMarker: false,
        onActivate: jest.fn(),
        onClose: jest.fn(),
        onOpenNavigator: jest.fn(),
        defaultOpen: true,
        ...props,
      })
    )
  );
}

describe("AgentTabStrip", () => {
  describe("computeVisibleCount()", () => {
    it("returns 0 for empty input", () => {
      expect(computeVisibleCount(500, 0)).toBe(0);
    });

    it("shows all tabs when they fit alongside the + button", () => {
      expect(computeVisibleCount(424, 3)).toBe(3);
    });

    it("reserves overflow button space when not all tabs fit", () => {
      expect(computeVisibleCount(460, 5)).toBe(3);
    });

    it("guarantees at least one visible tab even when nothing fits", () => {
      expect(computeVisibleCount(40, 3)).toBe(1);
    });

    it("treats the + button as always reserved", () => {
      expect(computeVisibleCount(160, 1)).toBe(1);
      expect(computeVisibleCount(159, 1)).toBe(1);
    });

    it("accounts for inter-tab gaps", () => {
      expect(computeVisibleCount(292, 2)).toBe(2);
      expect(computeVisibleCount(291, 2)).toBe(1);
    });
  });

  describe("partitionSessions()", () => {
    const s = (id: string) => ({ internalId: id });

    it("returns empty arrays for empty input", () => {
      expect(partitionSessions({ sessions: [], visibleCount: 0, activeId: null })).toEqual({
        visibleSessions: [],
        overflowSessions: [],
      });
    });

    it("splits front-to-back when active is already visible", () => {
      const sessions = [s("a"), s("b"), s("c"), s("d")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 2,
        activeId: "a",
      });
      expect(visibleSessions.map((x) => x.internalId)).toEqual(["a", "b"]);
      expect(overflowSessions.map((x) => x.internalId)).toEqual(["c", "d"]);
    });

    it("pins the active tab into the last visible slot when it would overflow", () => {
      const sessions = [s("a"), s("b"), s("c"), s("d")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 2,
        activeId: "d",
      });
      expect(visibleSessions.map((x) => x.internalId)).toEqual(["a", "d"]);
      expect(overflowSessions.map((x) => x.internalId)).toEqual(["b", "c"]);
    });

    it("does not swap when activeId is null", () => {
      const sessions = [s("a"), s("b"), s("c")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 1,
        activeId: null,
      });
      expect(visibleSessions.map((x) => x.internalId)).toEqual(["a"]);
      expect(overflowSessions.map((x) => x.internalId)).toEqual(["b", "c"]);
    });

    it("handles visibleCount === 1 with overflow active", () => {
      const sessions = [s("a"), s("b"), s("c")];
      const { visibleSessions, overflowSessions } = partitionSessions({
        sessions,
        visibleCount: 1,
        activeId: "c",
      });
      expect(visibleSessions.map((x) => x.internalId)).toEqual(["c"]);
      expect(overflowSessions.map((x) => x.internalId)).toEqual(["a", "b"]);
    });
  });

  describe("AgentTabOverflowMenu()", () => {
    it("starts the open menu with the Copilot Navigator card, separated from the hidden chats below it for https://github.com/Brevilabs/obsidian-copilot-private/issues/820", () => {
      renderOverflowMenu({});

      const card = screen.getByText(CARD_COPY);
      const separator = screen.getByRole("separator");
      const firstHiddenChat = screen.getByText("Plan the garden");
      expect(card.compareDocumentPosition(separator)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(separator.compareDocumentPosition(firstHiddenChat)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
      expect(screen.getByText("Review the template")).toBeTruthy();
    });

    it.each([
      { showPlusMarker: true, markerCount: 1 },
      { showPlusMarker: false, markerCount: 0 },
    ])(
      "shows $markerCount Plus marker(s) on the card when showPlusMarker is $showPlusMarker for https://github.com/Brevilabs/obsidian-copilot-private/issues/820",
      ({ showPlusMarker, markerCount }) => {
        renderOverflowMenu({ showPlusMarker });

        expect(screen.queryAllByText("Plus")).toHaveLength(markerCount);
      }
    );

    it("opens Copilot Navigator once and closes the menu when the card action is chosen", () => {
      const onOpenNavigator = jest.fn();
      renderOverflowMenu({ onOpenNavigator });

      fireEvent.click(screen.getByRole("menuitem", { name: "Open Copilot Navigator" }));

      expect(onOpenNavigator).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(CARD_COPY)).toBeNull();
    });

    it("activates a hidden chat and closes the menu when its row is clicked", () => {
      const onActivate = jest.fn();
      renderOverflowMenu({ onActivate });

      fireEvent.click(screen.getByText("Review the template"));

      expect(onActivate).toHaveBeenCalledWith("chat-1");
      expect(screen.queryByText(CARD_COPY)).toBeNull();
    });
  });

  describe("AgentTabStrip()", () => {
    beforeEach(() => setSettings({ isPaidUser: true }));

    it("detaches a closed tab without closing its backend session for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", () => {
      const session = {
        internalId: "existing",
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => "Existing chat",
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

      fireEvent.click(screen.getByRole("button", { name: "Close chat" }));

      expect(manager.detachSessionFromTab).toHaveBeenCalledWith(session.internalId);
      expect(manager.closeSession).not.toHaveBeenCalled();
    });

    it("detaches a tab when it is middle-clicked and ignores other auxiliary buttons", () => {
      const session = {
        internalId: "existing",
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => "Existing chat",
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

    it("refreshes releases after the new-session button creates a tab for https://github.com/Brevilabs/obsidian-copilot-private/issues/317", async () => {
      const session = {
        internalId: "existing",
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => "Existing chat",
        getStatus: () => "idle",
        getNeedsAttention: () => false,
      };
      let finishCreation!: () => void;
      const manager = {
        subscribe: () => () => {},
        getSessionsForScope: () => [session],
        getActiveProjectId: () => null,
        getActiveSession: () => session,
        getIsStarting: () => false,
        createSession: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              finishCreation = resolve;
            })
        ),
      };
      renderStrip(manager);
      fireEvent.click(screen.getByRole("button", { name: "New chat" }));
      expect(manager.createSession).toHaveBeenCalledTimes(1);
      expect(refreshLatestVersion).not.toHaveBeenCalled();
      finishCreation();
      await waitFor(() => expect(refreshLatestVersion).toHaveBeenCalledTimes(1));
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

    it.each([
      { tier: "a user without Plus", isPaidUser: false, markerCount: 1 },
      { tier: "a Plus user", isPaidUser: true, markerCount: 0 },
      { tier: "a user whose tier is unknown", isPaidUser: undefined, markerCount: 0 },
    ])(
      "shows $markerCount Plus marker(s) on the overflow card for $tier and opens the sidebar from its action for https://github.com/Brevilabs/obsidian-copilot-private/issues/820",
      ({ isPaidUser, markerCount }) => {
        setSettings({ isPaidUser });
        const onOpenSidebar = jest.fn();
        renderStrip(makeManagerWithChats(["First chat", "Second chat", "Third chat"]), {
          onOpenSidebar,
        });

        fireEvent.keyDown(screen.getByRole("button", { name: "Show 2 more chats" }), {
          key: "Enter",
        });
        expect(screen.queryAllByText("Plus")).toHaveLength(markerCount);
        fireEvent.click(screen.getByRole("menuitem", { name: "Open Copilot Navigator" }));

        expect(onOpenSidebar).toHaveBeenCalledTimes(1);
      }
    );

    it("keeps the tabs and the Navigator icon beside a Navigator leaf blocked for a user without Plus for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", () => {
      setSettings({ isPaidUser: false });
      const workspace: FakeWorkspaceApp = makeFakeWorkspaceApp();
      workspace.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });

      renderStrip(makeManagerWithOneChat(), { workspace });

      expect(screen.getByRole("tab", { name: /Existing chat/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open Copilot Navigator" })).toBeTruthy();
    });
  });
});
