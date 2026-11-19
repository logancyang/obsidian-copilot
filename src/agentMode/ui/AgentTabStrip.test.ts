import type { AgentChatMessage } from "@/agentMode/session/types";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import { AppContext } from "@/context";
import {
  makeFakeWorkspaceApp,
  type FakeWorkspaceApp,
} from "@/agentMode/ui/testing/fakeWorkspaceApp";
import { setNavigatorAccess } from "@/agentMode/ui/testing/navigatorAccess";
import { installRadixMenuPolyfills } from "@/agentMode/ui/testing/radixMenuPolyfills";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/entitlement");

const IDENTITY_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/938";
const DOTS_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/948";

function renderStrip(
  manager: unknown,
  {
    workspace = makeFakeWorkspaceApp(),
    onOpenSidebar = jest.fn(),
    agents = undefined as readonly CustomAgent[] | undefined,
    onTabClick = undefined as (() => void) | undefined,
  } = {}
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
          agents,
          onTabClick,
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

interface FakeChat {
  label: string;
  agentSlug?: string;
  status?: string;
  needsAttention?: boolean;
  messages?: AgentChatMessage[];
}

function makeManagerWithChats(chats: FakeChat[]) {
  const sessions = chats.map(({ label, agentSlug, status, needsAttention, messages = [] }) => {
    const listeners: Array<{ onMessagesChanged(): void }> = [];
    const session = {
      internalId: label,
      backendId: "claude",
      agentSlug: agentSlug ?? null,
      messages,
      subscribe: (listener?: { onMessagesChanged(): void }) => {
        if (listener) listeners.push(listener);
        return () => {};
      },
      setMessages: (next: AgentChatMessage[]) => {
        session.messages = next;
        listeners.forEach((listener) => listener.onMessagesChanged());
      },
      getLabel: () => label,
      getStatus: () => status ?? "idle",
      getNeedsAttention: () => needsAttention ?? false,
      store: { getDisplayMessages: () => session.messages },
    };
    return session;
  });
  return {
    subscribe: () => () => {},
    getSessionsForScope: () => sessions,
    getActiveProjectId: () => null,
    getActiveSession: () => sessions[0],
    getIsStarting: () => false,
  };
}

const COCO = { slug: "coco", name: "Coco", faceSrc: "face:coco" } as CustomAgent;
const LEO = { slug: "leo", name: "Leo", faceSrc: "face:leo" } as CustomAgent;

function iconOf(element: HTMLElement) {
  return {
    face: element.querySelector("img")?.getAttribute("src") ?? null,
    ring: element.querySelector('[data-agent-face-ring="running"]') !== null,
    spinner: element.querySelector("svg.tw-animate-spin") !== null,
  };
}

function tabIcon(label: string) {
  return iconOf(screen.getByRole("tab", { name: new RegExp(label) }));
}

function dotOf(element: HTMLElement): string | null {
  const className = element.querySelector("span[aria-hidden].tw-rounded-full")?.className ?? "";
  return (
    className
      .match(/--color-(orange|green)|tw-bg-(red)/)
      ?.slice(1)
      .find(Boolean) ?? null
  );
}

const LEO_WAITS: AgentChatMessage[] = [
  {
    id: "asked",
    sender: "user",
    timestamp: null,
    isVisible: true,
    message: "@Leo reconcile October",
    agentMentions: [{ id: "run", agent: "leo", name: "Leo", status: "question", startedAt: 0 }],
  },
];

describe("AgentTabStrip", () => {
  beforeAll(() => installRadixMenuPolyfills());

  describe("AgentTabStrip()", () => {
    beforeEach(() => setNavigatorAccess("supporter"));
    afterEach(() => jest.restoreAllMocks());

    it("pins the active chat into the last visible slot and lists the rest in the overflow menu when the strip is too narrow for https://github.com/Brevilabs/obsidian-copilot-private/issues/891", () => {
      const sessions = ["First", "Second", "Third", "Fourth"].map((label) => ({
        internalId: label.toLowerCase(),
        backendId: "test",
        subscribe: () => () => {},
        getLabel: () => label,
        getStatus: () => "idle",
        getNeedsAttention: () => false,
        store: { getDisplayMessages: () => [] },
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

    it("tells its host when the active tab is clicked, so an agent's profile covering the chat goes back to it for https://github.com/Brevilabs/obsidian-copilot-private/issues/940", () => {
      const manager = { ...makeManagerWithOneChat(), setActiveSession: jest.fn() };
      const onTabClick = jest.fn();
      renderStrip(manager, { onTabClick });

      fireEvent.click(screen.getByRole("tab", { selected: true }));

      expect(manager.setActiveSession).toHaveBeenCalledWith("existing");
      expect(onTabClick).toHaveBeenCalledTimes(1);
    });

    it("starts a new chat when the new-chat button is clicked", () => {
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

    it(`shows an agent chat's face as its tab icon and keeps the backend icon on a Copilot chat (${IDENTITY_ISSUE})`, () => {
      jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
      renderStrip(
        makeManagerWithChats([
          { label: "Launch video plan", agentSlug: "coco" },
          { label: "Notes" },
        ]),
        { agents: [COCO, LEO] }
      );

      expect(tabIcon("Launch video plan")).toEqual({
        face: "face:coco",
        ring: false,
        spinner: false,
      });
      expect(tabIcon("Notes")).toEqual({ face: null, ring: false, spinner: false });
    });

    it(`keeps the backend icon on a chat whose agent is gone and on every chat while no agents are listed (${IDENTITY_ISSUE})`, () => {
      jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
      const manager = makeManagerWithChats([
        { label: "Taxes", agentSlug: "gone" },
        { label: "Launch video plan", agentSlug: "coco" },
      ]);

      const { unmount } = renderStrip(manager, { agents: [COCO] });
      expect(tabIcon("Taxes").face).toBeNull();
      unmount();

      renderStrip(manager);
      expect(tabIcon("Taxes").face).toBeNull();
      expect(tabIcon("Launch video plan").face).toBeNull();
    });

    it(`keeps a running agent chat's face and spins a ring around it, while a running Copilot chat keeps its spinner (${IDENTITY_ISSUE})`, () => {
      jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
      renderStrip(
        makeManagerWithChats([
          { label: "October books", agentSlug: "leo", status: "running" },
          { label: "Notes", status: "running" },
        ]),
        { agents: [COCO, LEO] }
      );

      expect(tabIcon("October books")).toEqual({ face: "face:leo", ring: true, spinner: false });
      expect(tabIcon("Notes")).toEqual({ face: null, ring: false, spinner: true });
    });

    it(`keeps the 128px tabs and shows each agent chat's face, ring included, at 20px in the overflow menu (${IDENTITY_ISSUE})`, () => {
      jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
      renderStrip(
        makeManagerWithChats([
          { label: "Launch video plan", agentSlug: "coco" },
          { label: "Release notes" },
          { label: "October books", agentSlug: "leo", status: "running" },
        ]),
        { agents: [COCO, LEO] }
      );
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Launch video plan",
        "Release notes",
      ]);
      const tab = screen.getByRole("tab", { name: /Launch video plan/ });
      expect(tab.className).toContain("tw-w-32");
      expect(tab.querySelector("img")?.className).toContain("tw-size-4");

      fireEvent.pointerDown(screen.getByRole("button", { name: "Show 1 more chat" }), {
        button: 0,
        ctrlKey: false,
      });

      const row = screen.getByRole("menuitem", { name: /October books/ });
      expect(iconOf(row)).toEqual({ face: "face:leo", ring: true, spinner: false });
      expect(row.querySelector("img")?.className).toContain("tw-size-5");
    });

    it(`dots a chat orange while an agent it asked waits on the user and green once it finished while the user was elsewhere, and none on a chat that doesn't want the user (${DOTS_ISSUE})`, () => {
      jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
      renderStrip(
        makeManagerWithChats([
          { label: "School pickup", agentSlug: "nora" },
          {
            label: "October books",
            agentSlug: "coco",
            needsAttention: true,
            messages: LEO_WAITS,
          },
          { label: "Release notes", needsAttention: true },
        ]),
        { agents: [COCO, LEO] }
      );

      expect(dotOf(screen.getByRole("tab", { name: /School pickup/ }))).toBeNull();
      expect(dotOf(screen.getByRole("tab", { name: /October books/ }))).toBe("orange");
      expect(dotOf(screen.getByRole("tab", { name: /Release notes/ }))).toBe("green");
    });

    it(`puts a dot on the "…" button when a chat with a dot sits in its menu (${DOTS_ISSUE})`, () => {
      jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
      renderStrip(
        makeManagerWithChats([
          { label: "School pickup" },
          { label: "Launch plan" },
          { label: "October books", needsAttention: true, messages: LEO_WAITS },
          { label: "Release notes", needsAttention: true },
        ])
      );

      expect(dotOf(screen.getByRole("button", { name: "Show 2 more chats" }))).toBe("orange");
    });

    it(`turns a background chat's tab and "…" orange as soon as an agent it asked waits for the user's OK, though no turn ran in that chat (${DOTS_ISSUE})`, () => {
      jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
      const manager = makeManagerWithChats([
        { label: "School pickup" },
        { label: "October books" },
        { label: "Release notes" },
      ]);
      renderStrip(manager);
      const permission: AgentChatMessage[] = [
        {
          ...LEO_WAITS[0],
          agentMentions: [{ ...LEO_WAITS[0].agentMentions![0], status: "permission" }],
        },
      ];
      const waitFor = (label: string) =>
        act(() =>
          manager
            .getSessionsForScope()
            .find((session) => session.internalId === label)
            ?.setMessages(permission)
        );
      waitFor("October books");
      waitFor("Release notes");

      expect(dotOf(screen.getByRole("tab", { name: /School pickup/ }))).toBeNull();
      expect(dotOf(screen.getByRole("tab", { name: /October books/ }))).toBe("orange");
      expect(dotOf(screen.getByRole("button", { name: "Show 1 more chat" }))).toBe("orange");
    });
  });
});
