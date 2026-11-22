import { MessageRepository } from "./MessageRepository";
import { ChatMessage, MessageContext } from "@/types/message";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

function chatMessage(
  overrides: Partial<ChatMessage> & Pick<ChatMessage, "message" | "sender">
): ChatMessage {
  return { timestamp: null, isVisible: true, ...overrides };
}

describe("MessageRepository", () => {
  describe("MessageRepository", () => {
    let repo: MessageRepository;

    beforeEach(() => {
      repo = new MessageRepository();
    });

    describe("addMessage()", () => {
      it("stores display text, sender and a generated id for a string-based message", () => {
        const id = repo.addMessage("Hello", "Hello", "user");

        expect(id).toMatch(/^msg-\d+-\w+$/);
        expect(repo.getMessage(id)).toMatchObject({
          id,
          message: "Hello",
          originalMessage: "Hello",
          sender: "user",
          isVisible: true,
          isErrorMessage: false,
          context: undefined,
          contextEnvelope: undefined,
        });
        expect(repo.getMessage(id)?.timestamp?.epoch).toEqual(expect.any(Number));
      });

      it("keeps display text and processed text separate", () => {
        const id = repo.addMessage("Hello", "Hello with context added", "user");

        expect(repo.getMessage(id)?.message).toBe("Hello");
        expect(repo.getLLMMessage(id)?.message).toBe("Hello with context added");
      });

      it("preserves the note context attached to the message", () => {
        const note = mockTFile({ path: "test.md", basename: "test" });
        const context: MessageContext = {
          notes: [note],
          urls: ["https://example.com"],
          selectedTextContexts: [],
        };

        const id = repo.addMessage("Hello", "Hello", "user", context);

        expect(repo.getMessage(id)?.context).toEqual(context);
        expect(repo.getDisplayMessages()[0].context?.notes[0]).toEqual(note);
      });

      it("keeps the id and context of a ChatMessage object", () => {
        const message = chatMessage({
          id: "test-id",
          message: "Test message",
          sender: "user",
          context: { notes: [], urls: [], selectedTextContexts: [] },
        });

        expect(repo.addMessage(message)).toBe("test-id");
        expect(repo.getMessage("test-id")).toMatchObject({
          message: "Test message",
          context: message.context,
        });
      });

      it("generates an id for a ChatMessage object without one", () => {
        const id = repo.addMessage(chatMessage({ message: "Test message", sender: "user" }));

        expect(id).toMatch(/^msg-\d+-\w+$/);
      });

      it("hides a ChatMessage object whose isVisible is false from display messages", () => {
        repo.addMessage(chatMessage({ message: "Hidden", sender: "user", isVisible: false }));

        expect(repo.getDisplayMessages()).toHaveLength(0);
        expect(repo.getLLMMessages()).toHaveLength(1);
      });
    });

    describe("getDisplayMessages()", () => {
      it("returns visible messages in insertion order with their display text", () => {
        repo.addMessage("Hello", "Hello with context", "user");
        repo.addMessage("Response", "Response", "AI");

        const messages = repo.getDisplayMessages();

        expect(messages.map((m) => m.message)).toEqual(["Hello", "Response"]);
        expect(messages.every((m) => m.isVisible)).toBe(true);
      });

      it("omits invisible messages", () => {
        repo.addMessage("Shown", "Shown", "user");
        repo.addMessage(chatMessage({ message: "Hidden", sender: "AI", isVisible: false }));

        expect(repo.getDisplayMessages().map((m) => m.message)).toEqual(["Shown"]);
      });
    });

    describe("getLLMMessages()", () => {
      it("returns every message with display text and isVisible false", () => {
        repo.addMessage("Hello", "Hello with context", "user");
        repo.addMessage(chatMessage({ message: "Hidden", sender: "AI", isVisible: false }));

        const messages = repo.getLLMMessages();

        expect(messages.map((m) => m.message)).toEqual(["Hello", "Hidden"]);
        expect(messages.every((m) => m.isVisible === false)).toBe(true);
      });
    });

    describe("editMessage()", () => {
      it("updates the display text of a user message without changing its processed text", () => {
        const id = repo.addMessage("Hello", "Hello with context", "user");

        expect(repo.editMessage(id, "Hi there")).toBe(true);

        expect(repo.getMessage(id)).toMatchObject({ message: "Hi there", sender: "user", id });
        expect(repo.getLLMMessage(id)?.message).toBe("Hello with context");
      });

      it("updates both display and processed text of an AI message", () => {
        const id = repo.addMessage("Answer", "Answer", "AI");

        expect(repo.editMessage(id, "Better answer")).toBe(true);

        expect(repo.getMessage(id)?.message).toBe("Better answer");
        expect(repo.getLLMMessage(id)?.message).toBe("Better answer");
      });

      it("returns false for an unknown message id", () => {
        expect(repo.editMessage("non-existent", "New text")).toBe(false);
      });
    });

    describe("updateProcessedText()", () => {
      it("replaces the LLM text and leaves the display text unchanged", () => {
        const id = repo.addMessage("Hello", "Hello", "user");

        expect(repo.updateProcessedText(id, "Hello with context")).toBe(true);

        expect(repo.getLLMMessage(id)?.message).toBe("Hello with context");
        expect(repo.getMessage(id)?.message).toBe("Hello");
      });

      it("returns false for an unknown message id", () => {
        expect(repo.updateProcessedText("non-existent", "New text")).toBe(false);
      });
    });

    describe("truncateAfterMessageId()", () => {
      it("removes every message after the given one from both display and LLM views", () => {
        const firstId = repo.addMessage("First", "First", "user");
        repo.addMessage("Second", "Second", "AI");
        repo.addMessage("Third", "Third", "user");

        repo.truncateAfterMessageId(firstId);

        expect(repo.getDisplayMessages().map((m) => m.id)).toEqual([firstId]);
        expect(repo.getLLMMessages().map((m) => m.id)).toEqual([firstId]);
      });

      it("keeps all messages when the id is unknown", () => {
        repo.addMessage("First", "First", "user");
        repo.addMessage("Second", "Second", "AI");

        repo.truncateAfterMessageId("non-existent");

        expect(repo.getDisplayMessages()).toHaveLength(2);
      });
    });

    describe("truncateAfter()", () => {
      it("keeps messages up to and including the given index", () => {
        repo.addMessage("First", "First", "user");
        repo.addMessage("Second", "Second", "AI");
        repo.addMessage("Third", "Third", "user");

        repo.truncateAfter(1);

        expect(repo.getDisplayMessages().map((m) => m.message)).toEqual(["First", "Second"]);
      });
    });

    describe("deleteMessage()", () => {
      it("removes only the message with the given id", () => {
        const firstId = repo.addMessage("First", "First", "user");
        const secondId = repo.addMessage("Second", "Second", "AI");

        expect(repo.deleteMessage(firstId)).toBe(true);

        expect(repo.getDisplayMessages().map((m) => m.id)).toEqual([secondId]);
      });

      it("returns false for an unknown message id", () => {
        expect(repo.deleteMessage("non-existent")).toBe(false);
      });
    });

    describe("clear()", () => {
      it("removes all messages", () => {
        repo.addMessage("First", "First", "user");
        repo.addMessage("Second", "Second", "AI");

        repo.clear();

        expect(repo.getLLMMessages()).toEqual([]);
      });
    });

    describe("loadMessages()", () => {
      it("replaces existing messages with the loaded ones, preserving ids and text", () => {
        repo.addMessage("Old", "Old", "user");

        repo.loadMessages([
          chatMessage({ id: "a", message: "Question", sender: "user" }),
          chatMessage({ id: "b", message: "Answer", sender: "AI" }),
        ]);

        expect(repo.getDisplayMessages().map((m) => [m.id, m.message])).toEqual([
          ["a", "Question"],
          ["b", "Answer"],
        ]);
      });

      it("generates ids and timestamps for loaded messages that lack them", () => {
        repo.loadMessages([chatMessage({ message: "No id", sender: "user" })]);

        const [loaded] = repo.getDisplayMessages();
        expect(loaded.id).toMatch(/^msg-\d+-\w+$/);
        expect(loaded.timestamp?.epoch).toEqual(expect.any(Number));
      });
    });

    describe("getDebugInfo()", () => {
      it("counts total, visible, user and AI messages", () => {
        repo.addMessage("First", "First", "user");
        repo.addMessage("Second", "Second", "AI");
        repo.addMessage(chatMessage({ message: "Hidden", sender: "user", isVisible: false }));

        expect(repo.getDebugInfo()).toEqual({
          totalMessages: 3,
          visibleMessages: 2,
          userMessages: 2,
          aiMessages: 1,
        });
      });
    });
  });
});
