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
const LAPSED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const MENTION_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";

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
  key: "locked-custom-agents",
  title: "Ask an agent",
  category: "agents",
  icon: null,
  lockedNote: "Supporter preview",
};
jest.mock("@/agents/ui/lockedCustomAgents", () => ({
  useLockedAgentMention: jest.fn((enabled: boolean) =>
    enabled ? { option: LOCKED_ROW, agents: [], choose: mockChooseLockedAgents } : null
  ),
}));

jest.mock("@/components/chat-components/hooks/useAtMentionSearch", () => ({
  useAtMentionSearch: jest.fn(
    (
      _query: string,
      _mode: string,
      _category: string | undefined,
      _showTools: boolean,
      categories: CategoryOption[]
    ) => categories
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

function renderInChat(self: string | null, isAgentMode = false) {
  return render(
    <ChatAgentsContext.Provider value={{ agents: THREE_AGENTS, self }}>
      <AtMentionCommandPlugin isAgentMode={isAgentMode} />
    </ChatAgentsContext.Provider>
  );
}

function option(title: string): MenuOption {
  const found = mockTypeahead?.options.find((candidate) => candidate.title === title);
  if (!found) throw new Error(`No ${title} in the menu`);
  return found;
}

describe("AtMentionCommandPlugin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGate = "full";
    mockTypeahead = undefined;
  });

  describe("AtMentionCommandPlugin()", () => {
    it(`lists the other agents first, then the context categories, in an agent's chat (${MENTION_ISSUE})`, () => {
      renderInChat(COCO.slug);

      expect(menuTitles()).toEqual(["Maya", "Leo", "Notes", "Web tabs", "Folders"]);
    });

    it(`lists every agent in a Copilot chat (${MENTION_ISSUE})`, () => {
      renderInChat(null);

      expect(menuTitles().slice(0, 3)).toEqual([COCO.name, MAYA.name, LEO.name]);
    });

    it(`lists the locked Ask an agent row after every category in an Agent Mode chat (${LOCKED_ISSUE})`, () => {
      render(<AtMentionCommandPlugin isAgentMode />);

      expect(menuTitles()).toEqual(["Notes", "Web tabs", "Folders", "Ask an agent"]);
    });

    it(`lists the locked row and none of the chat's agents when the license doesn't include custom agents (${LOCKED_ISSUE})`, () => {
      mockGate = "locked";

      renderInChat(null, true);

      expect(menuTitles()).toEqual(["Notes", "Web tabs", "Folders", "Ask an agent"]);
    });

    it("lists only the categories outside Agent Mode, where the chat has no agents", () => {
      render(<AtMentionCommandPlugin />);

      expect(menuTitles()).toEqual(["Notes", "Web tabs", "Folders"]);
    });

    it(`keeps the agents whose name holds the typed text above the matching context (${MENTION_ISSUE})`, () => {
      renderInChat(COCO.slug);

      act(() =>
        mockTypeahead?.onStateChange?.({ query: "le", isOpen: true, selectedIndex: 0, range: null })
      );

      expect(menuTitles()).toEqual(["Leo", "Notes", "Web tabs", "Folders"]);
    });

    it("lists no agents inside a context category", () => {
      renderInChat(COCO.slug);

      act(() => mockTypeahead?.onSelect(option("Notes")));

      expect(menuTitles()).toEqual(["Notes", "Web tabs", "Folders"]);
    });

    it(`puts a picked agent in the message as its mention pill (${MENTION_ISSUE})`, () => {
      renderInChat(COCO.slug);

      act(() => mockTypeahead?.onSelect(option("Maya")));

      expect($replaceTriggeredTextWithPill).toHaveBeenCalledWith("@", {
        type: "customAgent",
        title: "Maya",
        data: "maya",
      });
    });

    it(`opens the upsell from Ask an agent and puts nothing in the message (${LOCKED_ISSUE})`, () => {
      render(<AtMentionCommandPlugin isAgentMode />);

      mockTypeahead?.onSelect(LOCKED_ROW);

      expect(mockChooseLockedAgents).toHaveBeenCalledTimes(1);
      expect(mockEditorUpdate).not.toHaveBeenCalled();
    });

    it(`lists the vault's agents locked, in place of the Ask an agent row, and opens the locked dialog with nothing inserted when one is chosen (${LAPSED_ISSUE})`, () => {
      jest
        .mocked(useLockedAgentMention)
        .mockReturnValue({ option: null, agents: THREE_AGENTS, choose: mockChooseLockedAgents });

      render(<AtMentionCommandPlugin isAgentMode />);

      expect(menuTitles()).toEqual([
        COCO.name,
        MAYA.name,
        LEO.name,
        "Notes",
        "Web tabs",
        "Folders",
      ]);
      expect(option(MAYA.name).lockedNote).toBe("Supporter preview");
      mockTypeahead?.onSelect(option(MAYA.name));

      expect(mockCloseMenu).toHaveBeenCalledTimes(1);
      expect(mockChooseLockedAgents).toHaveBeenCalledTimes(1);
      expect(mockEditorUpdate).not.toHaveBeenCalled();
    });

    it(`closes the menu on Ask an agent, so Enter sends the message when the license check grants custom agents and no dialog opens (${LOCKED_ISSUE})`, () => {
      render(<AtMentionCommandPlugin isAgentMode />);

      mockTypeahead?.onSelect(LOCKED_ROW);

      expect(mockCloseMenu).toHaveBeenCalledTimes(1);
    });
  });
});
