import type { CategoryOption } from "@/components/chat-components/hooks/useAtMentionCategories";
import type { UseTypeaheadPluginConfig } from "@/components/chat-components/hooks/useTypeaheadPlugin";
import { AtMentionCommandPlugin } from "@/components/chat-components/plugins/AtMentionCommandPlugin";
import { render } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/582";

const mockEditorUpdate = jest.fn();
jest.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: jest.fn(() => [{ update: mockEditorUpdate }]),
}));

jest.mock("@/context", () => ({ useApp: jest.fn(() => ({})) }));

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
    enabled ? { option: LOCKED_ROW, choose: mockChooseLockedAgents } : null
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

let mockTypeahead: UseTypeaheadPluginConfig<CategoryOption> | undefined;
jest.mock("@/components/chat-components/hooks/useTypeaheadPlugin", () => ({
  useTypeaheadPlugin: jest.fn((config: UseTypeaheadPluginConfig<CategoryOption>) => {
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

describe("AtMentionCommandPlugin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTypeahead = undefined;
  });

  describe("AtMentionCommandPlugin()", () => {
    it(`lists the locked Ask an agent row after every category in an Agent Mode chat (${ISSUE})`, () => {
      render(<AtMentionCommandPlugin isAgentMode />);

      expect(menuTitles()).toEqual(["Notes", "Web tabs", "Folders", "Ask an agent"]);
    });

    it("lists only the categories outside Agent Mode", () => {
      render(<AtMentionCommandPlugin />);

      expect(menuTitles()).toEqual(["Notes", "Web tabs", "Folders"]);
    });

    it(`opens the upsell from Ask an agent and puts nothing in the message (${ISSUE})`, () => {
      render(<AtMentionCommandPlugin isAgentMode />);

      mockTypeahead?.onSelect(LOCKED_ROW);

      expect(mockChooseLockedAgents).toHaveBeenCalledTimes(1);
      expect(mockEditorUpdate).not.toHaveBeenCalled();
    });

    it("closes the menu on Ask an agent, so Enter sends the message when the license check grants custom agents and no dialog opens (https://github.com/Brevilabs/obsidian-copilot-private/issues/582)", () => {
      render(<AtMentionCommandPlugin isAgentMode />);

      mockTypeahead?.onSelect(LOCKED_ROW);

      expect(mockCloseMenu).toHaveBeenCalledTimes(1);
    });
  });
});
