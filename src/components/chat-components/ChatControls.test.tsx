import { ChatControls } from "@/components/chat-components/ChatControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { render, screen } from "@testing-library/react";
import React from "react";

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/aiParams", () => ({
  useChainType: () => ["llm_chain", jest.fn()],
}));
jest.mock("@/plusUtils", () => ({
  navigateToPlusPage: jest.fn(),
  useIsPaidUser: () => true,
}));
jest.mock("@/settings/model", () => ({
  useSettingsValue: () => ({ autosaveChat: true }),
}));
jest.mock("@/components/chat-components/ChatHistoryPopover", () => ({
  ChatHistoryPopover: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/chat-components/ChatSettingsPopover", () => ({
  ChatSettingsPopover: () => null,
}));
jest.mock("@/components/chat-components/TokenCounter", () => ({
  TokenCounter: () => null,
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

describe("ChatControls", () => {
  describe("ChatControls()", () => {
    it("offers no advanced menu, so Quick Chat has no auto-accept edits toggle (https://github.com/Brevilabs/obsidian-copilot-private/issues/850)", () => {
      render(
        <TooltipProvider>
          <ChatControls
            onNewChat={jest.fn()}
            onSaveAsNote={jest.fn()}
            onLoadHistory={jest.fn()}
            chatHistory={[]}
            onUpdateChatTitle={jest.fn()}
            onDeleteChat={jest.fn()}
            onLoadChat={jest.fn()}
          />
        </TooltipProvider>
      );

      expect(screen.getByTitle("New chat")).toBeTruthy();
      expect(screen.queryByTitle("Advanced settings")).toBeNull();
      expect(screen.queryByText("Auto-accept edits")).toBeNull();
    });
  });
});
