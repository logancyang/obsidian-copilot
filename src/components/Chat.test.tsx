import Chat from "@/components/Chat";
import { ABORT_REASON, EVENT_NAMES, USER_SENDER } from "@/constants";
import { EventTargetContext } from "@/context";
import type { NoteSelectedTextContext } from "@/types/message";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockSelection: NoteSelectedTextContext = {
  id: "excerpt",
  sourceType: "note",
  noteTitle: "Research",
  notePath: "Research.md",
  content: "Interview findings",
  startLine: 2,
  endLine: 2,
};
const mockSelections = [mockSelection];
const mockMessages = [{ id: "message-1", message: "Original question", sender: USER_SENDER }];
const mockSettings = { autoAttachActiveNote: true };

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/aiParams", () => ({
  useModelKey: () => ["model", jest.fn()],
  useChainType: () => ["llm_chain"],
  useSelectedTextContexts: () => [mockSelections],
}));
jest.mock("@/settings/model", () => ({
  useSettingsValue: () => mockSettings,
}));
jest.mock("@/hooks/useChatManager", () => ({
  useChatManager: () => ({ messages: mockMessages, addMessage: jest.fn() }),
}));
jest.mock("@/hooks/useChatFileDrop", () => ({
  useChatFileDrop: () => ({ isDragActive: false }),
}));
jest.mock("@/components/chat-components/useChatModelPicker", () => ({
  useChatModelPicker: () => ({ models: [] }),
}));
jest.mock("@/components/chat-components/hooks/useActiveWebTabState", () => ({
  useActiveWebTabState: () => ({}),
}));
jest.mock("@/context/ChatInputContext", () => ({
  ChatInputProvider: ({ children }: { children: React.ReactNode }) => children,
  useChatInput: () => ({}),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/components/chat-components/ChatControls", () => ({
  ChatControls: ({ onCopyChatLink }: { onCopyChatLink?: () => void }) => (
    <button type="button" disabled={!onCopyChatLink} onClick={onCopyChatLink}>
      Copy chat link
    </button>
  ),
}));
jest.mock("@/components/chat-components/ui/AgentModeBanner", () => ({
  AgentModeBanner: () => null,
}));
jest.mock("@/components/chat-components/ChatModeInput", () => ({
  __esModule: true,
  default: (props: {
    inputMessage: string;
    setInputMessage: (text: string) => void;
    handleSendMessage: () => void;
    setIncludeActiveNote: (include: boolean) => void;
  }) => (
    <>
      <input
        aria-label="Message"
        value={props.inputMessage}
        onChange={(event) => props.setInputMessage(event.target.value)}
      />
      <button type="button" onClick={() => props.handleSendMessage()}>
        Send
      </button>
      <button type="button" onClick={() => props.setIncludeActiveNote(false)}>
        Remove active note
      </button>
    </>
  ),
}));
jest.mock("@/components/chat-components/ChatMessages", () => ({
  __esModule: true,
  isChatEmpty: () => false,
  default: ({ onEdit }: { onEdit: (index: number, text: string) => void }) => (
    <button type="button" onClick={() => onEdit(0, "Revised question")}>
      Edit message
    </button>
  ),
}));
jest.mock("@/system-prompts", () => ({}));
jest.mock("@/langchainStream", () => ({}));
jest.mock("@/logFileManager", () => ({ logFileManager: {} }));
jest.mock("@/LLMProviders/chainRunner/utils/promptPayloadRecorder", () => ({}));
jest.mock("@/utils", () => ({ isPlusChain: () => false }));

function renderChat(savedPath = "") {
  let sourcePath = savedPath;
  const chatUIState = {
    getSourcePath: jest.fn(() => sourcePath),
    saveChat: jest.fn(async () => {
      sourcePath = "conversations/chat.md";
    }),
    sendMessage: jest.fn().mockResolvedValue("message-2"),
    getLLMMessage: jest.fn().mockReturnValue(undefined),
    editMessage: jest.fn().mockResolvedValue(true),
    truncateAfterMessageId: jest.fn().mockResolvedValue(undefined),
  };
  const props = {
    chatUIState,
    chainManager: { chatModelManager: {} },
    onSaveChat: jest.fn(),
    updateUserMessageHistory: jest.fn(),
    plugin: {
      app: {},
      copyChatLink: jest.fn((resolveChatId: () => Promise<string>) => resolveChatId()),
      chatSelectionHighlightController: { clearIfNoNoteContexts: jest.fn() },
    },
  } as unknown as React.ComponentProps<typeof Chat>;
  const eventTarget = new EventTarget();
  render(
    <EventTargetContext.Provider value={eventTarget}>
      <Chat {...props} />
    </EventTargetContext.Provider>
  );
  return { chatUIState, copyChatLink: props.plugin.copyChatLink as jest.Mock, eventTarget };
}

describe("Chat", () => {
  afterEach(() => {
    mockSettings.autoAttachActiveNote = true;
  });

  describe("handleSendMessage()", () => {
    it.each([true, false])(
      "preserves active-note inclusion %p when sending selected text https://github.com/Brevilabs/obsidian-copilot-private/issues/465",
      async (includeActiveNote) => {
        const { chatUIState } = renderChat();
        if (!includeActiveNote) fireEvent.click(screen.getByText("Remove active note"));
        fireEvent.change(screen.getByLabelText("Message"), {
          target: { value: "Compare findings" },
        });

        fireEvent.click(screen.getByText("Send"));

        await waitFor(() => expect(chatUIState.sendMessage).toHaveBeenCalledTimes(1));
        expect(chatUIState.sendMessage.mock.calls[0].slice(0, 4)).toEqual([
          "Compare findings",
          expect.objectContaining({ selectedTextContexts: [mockSelection] }),
          "llm_chain",
          includeActiveNote,
        ]);
      }
    );

    it("sends without the active note when auto-attach is off https://github.com/logancyang/obsidian-copilot/issues/3663", async () => {
      mockSettings.autoAttachActiveNote = false;
      const { chatUIState } = renderChat();
      fireEvent.change(screen.getByLabelText("Message"), {
        target: { value: "Compare findings" },
      });

      fireEvent.click(screen.getByText("Send"));

      await waitFor(() => expect(chatUIState.sendMessage).toHaveBeenCalledTimes(1));
      expect(chatUIState.sendMessage.mock.calls[0][3]).toBe(false);
    });
  });

  describe("handleEdit()", () => {
    it.each([true, false])(
      "does not attach the current note when editing with composer inclusion %p https://github.com/Brevilabs/obsidian-copilot-private/issues/465",
      async (includeActiveNote) => {
        const { chatUIState } = renderChat();
        if (!includeActiveNote) fireEvent.click(screen.getByText("Remove active note"));

        fireEvent.click(screen.getByText("Edit message"));

        await waitFor(() =>
          expect(chatUIState.editMessage).toHaveBeenCalledWith(
            "message-1",
            "Revised question",
            "llm_chain",
            false
          )
        );
      }
    );
  });

  describe("handleAbortStream()", () => {
    it("resets the active-note badge to the current setting when the new-chat command starts over https://github.com/logancyang/obsidian-copilot/issues/3663", async () => {
      const { chatUIState, eventTarget } = renderChat();
      mockSettings.autoAttachActiveNote = false;

      act(() => {
        eventTarget.dispatchEvent(
          new CustomEvent(EVENT_NAMES.ABORT_STREAM, { detail: { reason: ABORT_REASON.NEW_CHAT } })
        );
      });
      fireEvent.change(screen.getByLabelText("Message"), {
        target: { value: "Compare findings" },
      });
      fireEvent.click(screen.getByText("Send"));

      await waitFor(() => expect(chatUIState.sendMessage).toHaveBeenCalledTimes(1));
      expect(chatUIState.sendMessage.mock.calls[0][3]).toBe(false);
    });
  });

  describe("handleCopyChatLink()", () => {
    it("links an already saved chat without saving it again", async () => {
      const { chatUIState, copyChatLink } = renderChat("conversations/existing.md");

      fireEvent.click(screen.getByText("Copy chat link"));

      await expect(copyChatLink.mock.results[0].value).resolves.toBe("conversations/existing.md");
      expect(chatUIState.saveChat).not.toHaveBeenCalled();
    });

    it("saves an unsaved chat before linking to it https://github.com/Brevilabs/obsidian-copilot-private/issues/601", async () => {
      const { chatUIState, copyChatLink } = renderChat();

      fireEvent.click(screen.getByText("Copy chat link"));

      await expect(copyChatLink.mock.results[0].value).resolves.toBe("conversations/chat.md");
      expect(chatUIState.saveChat).toHaveBeenCalledTimes(1);
    });

    it("disables copying while a reply is streaming so the saved note is not missing it https://github.com/Brevilabs/obsidian-copilot-private/issues/601", async () => {
      const { chatUIState } = renderChat();
      chatUIState.sendMessage.mockReturnValue(new Promise(() => {}));
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Question" } });

      fireEvent.click(screen.getByText("Send"));

      await waitFor(() =>
        expect(screen.getByText("Copy chat link")).toHaveProperty("disabled", true)
      );
    });
  });
});
