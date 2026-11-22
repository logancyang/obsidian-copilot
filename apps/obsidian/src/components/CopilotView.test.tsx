import { act } from "@testing-library/react";
import type { App, WorkspaceLeaf } from "obsidian";
import type React from "react";

import type Chat from "@/components/Chat";
import CopilotView, { type QuickChatViewServices } from "@/components/CopilotView";
import type ChainManager from "@/LLMProviders/chainManager";
import type { ChatManagerChatUIState } from "@/state/ChatUIState";

type ChatProps = React.ComponentProps<typeof Chat>;

const mockRenderedChat: { props: ChatProps | null } = { props: null };
jest.mock("@/components/Chat", () => ({
  __esModule: true,
  default: (props: ChatProps) => {
    mockRenderedChat.props = props;
    return null;
  },
}));

function quickChatServices(chainManager: ChainManager): QuickChatViewServices {
  return {
    app: { workspace: { on: jest.fn(() => ({})) } } as unknown as App,
    chainOwner: { getCurrentChainManager: () => chainManager },
    chatUIState: {} as ChatManagerChatUIState,
    updateUserMessageHistory: jest.fn(),
    chatSelectionHighlightController: { persistFromPointerDown: jest.fn() },
    userMemoryManager: { addRecentConversation: jest.fn() },
    getChatHistoryItems: jest.fn(),
    updateChatTitle: jest.fn(),
    deleteChatHistory: jest.fn(),
    loadChatById: jest.fn(),
    openChatSourceFile: jest.fn(),
    copyChatLink: jest.fn(),
    activateAgentView: jest.fn(),
  };
}

async function openView(services: QuickChatViewServices): Promise<CopilotView> {
  const view = new CopilotView({} as WorkspaceLeaf, services);
  view.registerEvent = jest.fn();
  await act(async () => {
    await view.onOpen();
  });
  return view;
}

describe("CopilotView", () => {
  describe("CopilotView", () => {
    beforeEach(() => {
      mockRenderedChat.props = null;
    });

    describe("onOpen()", () => {
      it("renders Quick Chat with the services' current chain manager, UI state and history", async () => {
        const chainManager = {} as ChainManager;
        const services = quickChatServices(chainManager);

        const view = await openView(services);

        expect(mockRenderedChat.props).toMatchObject({
          chainManager,
          chatUIState: services.chatUIState,
          services,
        });
        mockRenderedChat.props?.updateUserMessageHistory("Summarize this note");
        expect(services.updateUserMessageHistory).toHaveBeenCalledWith("Summarize this note");
        await act(() => view.onClose());
      });
    });
  });
});
