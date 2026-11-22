import { ChatAgentsContext } from "@/agents/ui/chatAgents";
import { useLockedAgentMention } from "@/agents/ui/lockedCustomAgents";
import { COCO, LEO, MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import type {
  AtMentionOption,
  CategoryOption,
} from "@/components/chat-components/hooks/useAtMentionCategories";
import type { UseTypeaheadPluginConfig } from "@/components/chat-components/hooks/useTypeaheadPlugin";
import { AtMentionCommandPlugin } from "@/components/chat-components/plugins/AtMentionCommandPlugin";
import { $replaceTriggeredTextWithPill } from "@/components/chat-components/utils/lexicalTextUtils";
import { act, render } from "@testing-library/react";
import React from "react";

const LOCKED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/582";
const LOCKED_AGENTS_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const MENTION_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";
const SETUP_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/962";

const mockEditorUpdate = jest.fn((change: () => void) => change());
jest.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: jest.fn(() => [{ update: mockEditorUpdate }]),
}));

jest.mock("@/context", () => ({ useApp: jest.fn(() => ({})) }));

let mockGate = "full";
jest.mock("@/agents/customAgentsGate", () => ({ useCustomAgentsGate: jest.fn(() => mockGate) }));

jest.mock("@/components/chat-components/utils/lexicalTextUtils", () => ({
  $replaceTriggeredTextWithPill: jest.fn(),
}));

const mockChooseLockedAgents = jest.fn();
const mockCloseMenu = jest.fn();
const LOCKED_ROW: CategoryOption = {
  key: "agents",
  title: "Teammates",
  category: "agents",
  icon: null,
  lockedNote: "Supporter preview",
};
jest.mock("@/agents/ui/lockedCustomAgents", () => ({
  useLockedAgentMention: jest.fn((enabled: boolean) =>
    enabled ? { option: LOCKED_ROW, agents: [], choose: mockChooseLockedAgents } : null
  ),
}));

const LEDGER_NOTE: AtMentionOption = {
  key: "note-ledger",
  title: "Ledger rules",
  category: "notes",
  data: "Finance/Ledger rules.md",
};
jest.mock("@/components/chat-components/hooks/useAtMentionSearch", () => ({
  useAtMentionSearch: jest.fn(
    (
      query: string,
      mode: string,
      _category: string | undefined,
      _showTools: boolean,
      categories: CategoryOption[]
    ) => (mode === "category" && !query ? categories : [LEDGER_NOTE])
  ),
}));

type MenuOption = CategoryOption | AtMentionOption;
let mockTypeahead: UseTypeaheadPluginConfig<MenuOption> | undefined;
jest.mock("@/components/chat-components/hooks/useTypeaheadPlugin", () => ({
  useTypeaheadPlugin: jest.fn((config: UseTypeaheadPluginConfig<MenuOption>) => {
    mockTypeahead = config;
    return {
      state: { isOpen: false, query: "", selectedIndex: 0, range: null },
      handleHighlight: jest.fn(),
      closeMenu: mockCloseMenu,
    };
  }),
}));

function menuTitles(): string[] {
  return (mockTypeahead?.options ?? []).map((option) => option.title);
}

function renderInChat(self: string | null, isAgentMode = false, agents = THREE_AGENTS) {
  return render(
    <ChatAgentsContext.Provider value={{ agents, self }}>
      <AtMentionCommandPlugin isAgentMode={isAgentMode} />
    </ChatAgentsContext.Provider>
  );
}

function option(title: string): MenuOption {
  const found = mockTypeahead?.options.find((candidate) => candidate.title === title);
  if (!found) throw new Error(`No ${title} in the menu`);
  return found;
}

function choose(title: string): void {
  act(() => mockTypeahead?.onSelect(option(title)));
}

function type(query: string): void {
  act(() => mockTypeahead?.onStateChange?.({ query, isOpen: true, selectedIndex: 0, range: null }));
}

describe("AtMentionCommandPlugin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGate = "full";
    mockTypeahead = undefined;
  });

  describe("AtMentionCommandPlugin()", () => {
    it(`lists a Teammates row first, then the context categories, and no single agent at the first level (${MENTION_ISSUE})`, () => {
      renderInChat(COCO.slug);

      expect(menuTitles()).toEqual(["Teammates", "Notes", "Web tabs", "Folders"]);
    });

    it(`leaves out the Teammates row when the only agent is the one the chat is with (${MENTION_ISSUE})`, () => {
      renderInChat(COCO.slug, false, [COCO]);

      expect(menuTitles()).toEqual(["Notes", "Web tabs", "Folders"]);
    });

    it("lists only the categories outside Agent Chat, where the chat has no agents", () => {
      render(<AtMentionCommandPlugin />);

      expect(menuTitles()).toEqual(["Notes", "Web tabs", "Folders"]);
    });

    it(`lists the other agents, without the chat's own, once Teammates is chosen (${MENTION_ISSUE})`, () => {
      renderInChat(COCO.slug);

      choose("Teammates");

      expect(menuTitles()).toEqual([MAYA.name, LEO.name]);
    });

    it(`lists every agent under Agents in a Copilot chat (${MENTION_ISSUE})`, () => {
      renderInChat(null);

      choose("Teammates");

      expect(menuTitles()).toEqual([COCO.name, MAYA.name, LEO.name]);
    });

    it(`keeps only the agents whose name holds the typed text under Teammates, and lists nothing when none does (${MENTION_ISSUE})`, () => {
      renderInChat(COCO.slug);
      choose("Teammates");

      type("le");
      expect(menuTitles()).toEqual([LEO.name]);

      type("zz");
      expect(menuTitles()).toEqual([]);
    });

    it(`lists the agents whose name holds a first-level query ahead of the matching notes (${MENTION_ISSUE})`, () => {
      renderInChat(COCO.slug);

      type("le");

      expect(menuTitles()).toEqual([LEO.name, LEDGER_NOTE.title]);
    });

    it("lists no agents inside a context category", () => {
      renderInChat(COCO.slug);

      choose("Notes");

      expect(menuTitles()).toEqual([LEDGER_NOTE.title]);
    });

    it.each([
      { from: "the Teammates list", open: () => choose("Teammates") },
      { from: "the first-level results", open: () => type("ma") },
    ])(
      `puts an agent picked from $from in the message as its mention pill (${MENTION_ISSUE})`,
      ({ open }) => {
        renderInChat(COCO.slug);
        open();

        choose(MAYA.name);

        expect($replaceTriggeredTextWithPill).toHaveBeenCalledWith("@", {
          type: "customAgent",
          title: "Maya",
          data: "maya",
        });
      }
    );

    it(`greys an agent whose model can't run on this device and opens its profile with nothing inserted when it is chosen (${SETUP_ISSUE})`, () => {
      const openProfile = jest.fn();
      render(
        <ChatAgentsContext.Provider
          value={{ agents: THREE_AGENTS, self: null, needsSetup: new Set([LEO.slug]), openProfile }}
        >
          <AtMentionCommandPlugin />
        </ChatAgentsContext.Provider>
      );
      choose("Teammates");

      expect(option(LEO.name).lockedNote).toBe("Needs setup");
      expect(option(MAYA.name).lockedNote).toBeUndefined();
      choose(LEO.name);

      expect(mockCloseMenu).toHaveBeenCalledTimes(1);
      expect(openProfile).toHaveBeenCalledWith(LEO.slug);
      expect($replaceTriggeredTextWithPill).not.toHaveBeenCalled();
    });

    it(`lists the locked Teammates row first in an Agent Chat whose license doesn't include custom agents (${MENTION_ISSUE})`, () => {
      render(<AtMentionCommandPlugin isAgentMode />);

      expect(menuTitles()).toEqual(["Teammates", "Notes", "Web tabs", "Folders"]);
      expect(option("Teammates").lockedNote).toBe("Supporter preview");
    });

    it(`lists none of the chat's agents for a first-level query when the license doesn't include custom agents (${LOCKED_ISSUE})`, () => {
      mockGate = "locked";
      renderInChat(null, true);

      type("le");

      expect(menuTitles()).toEqual([LEDGER_NOTE.title]);
    });

    it(`opens the upsell from the locked Teammates row, closes the menu so Enter sends the message when the license check grants custom agents, and puts nothing in the message (${LOCKED_ISSUE})`, () => {
      render(<AtMentionCommandPlugin isAgentMode />);

      choose("Teammates");

      expect(mockChooseLockedAgents).toHaveBeenCalledTimes(1);
      expect(mockCloseMenu).toHaveBeenCalledTimes(1);
      expect(mockEditorUpdate).not.toHaveBeenCalled();
      expect(menuTitles()).toEqual(["Teammates", "Notes", "Web tabs", "Folders"]);
    });

    it(`keeps the one locked Teammates row in a vault with agents, and lists them locked for a first-level query, each opening the locked dialog with nothing inserted (${LOCKED_AGENTS_ISSUE})`, () => {
      jest.mocked(useLockedAgentMention).mockReturnValue({
        option: LOCKED_ROW,
        agents: THREE_AGENTS,
        choose: mockChooseLockedAgents,
      });
      render(<AtMentionCommandPlugin isAgentMode />);
      expect(menuTitles()).toEqual(["Teammates", "Notes", "Web tabs", "Folders"]);

      type("ma");

      expect(menuTitles()).toEqual([MAYA.name, LEDGER_NOTE.title]);
      expect(option(MAYA.name).lockedNote).toBe("Supporter preview");
      choose(MAYA.name);
      expect(mockCloseMenu).toHaveBeenCalledTimes(1);
      expect(mockChooseLockedAgents).toHaveBeenCalledTimes(1);
      expect(mockEditorUpdate).not.toHaveBeenCalled();
    });
  });
});
