import { ChatControls } from "@/components/chat-components/ChatControls";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

// Mock factory names must match the real `use*` exports, so the no-hook `use`
// prefix is expected on the mocked hooks below.
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/aiParams", () => ({
  useChainType: () => ["llm_chain", jest.fn()],
}));
jest.mock("@/plusUtils", () => ({
  navigateToPlusPage: jest.fn(),
  useIsPaidUser: () => true,
}));
jest.mock("@/settings/model", () => ({
  updateSetting: jest.fn(),
  useSettingsValue: () => ({ autoAcceptEdits: false, autosaveChat: true }),
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
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  describe("ChatControls()", () => {
    it("omits the retired index actions from the advanced menu (https://github.com/Brevilabs/obsidian-copilot-private/issues/282)", async () => {
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

      fireEvent.pointerDown(screen.getByTitle("Advanced Settings"), {
        button: 0,
        ctrlKey: false,
      });

      await waitFor(() => expect(screen.getByText("Auto-accept Edits")).toBeTruthy());
      expect(screen.queryByText("Refresh Vault Index")).toBeNull();
      expect(screen.queryByText("Force Reindex Vault")).toBeNull();
    });
  });
});
