import { PromptContextEnvelope, PromptContextLayer } from "@/context/PromptContextTypes";
import { LayerToMessagesConverter } from "./LayerToMessagesConverter";

describe("LayerToMessagesConverter", () => {
  const createMockEnvelope = (layers: PromptContextLayer[]): PromptContextEnvelope => {
    const layerHashes: Record<string, string> = {};
    layers.forEach((layer) => {
      layerHashes[layer.id] = layer.hash;
    });

    return {
      version: 1,
      conversationId: "test-conv",
      messageId: "test-msg",
      layers,
      serializedText: layers.map((l) => l.text).join("\n\n"),
      layerHashes,
      combinedHash: "combined-hash",
    };
  };

  describe("convert()", () => {
    it("converts L1 and L5 into a system message followed by a user message", () => {
      const envelope = createMockEnvelope([
        {
          id: "L1_SYSTEM",
          label: "System & Policies",
          text: "You are a helpful assistant.",
          stable: true,
          segments: [],
          hash: "l1-hash",
        },
        {
          id: "L5_USER",
          label: "User Message",
          text: "Hello, how are you?",
          stable: false,
          segments: [],
          hash: "l5-hash",
        },
      ]);

      const messages = LayerToMessagesConverter.convert(envelope);

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toBe("You are a helpful assistant.");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toBe("Hello, how are you?");
    });

    it("merges L3 turn context and the L5 query into one user message with a query marker between them", () => {
      const envelope = createMockEnvelope([
        {
          id: "L1_SYSTEM",
          label: "System & Policies",
          text: "System prompt",
          stable: true,
          segments: [],
          hash: "l1-hash",
        },
        {
          id: "L3_TURN",
          label: "Turn Context",
          text: "Context about note.md",
          stable: false,
          segments: [],
          hash: "l3-hash",
        },
        {
          id: "L5_USER",
          label: "User Message",
          text: "Summarize this",
          stable: false,
          segments: [],
          hash: "l5-hash",
        },
      ]);

      const messages = LayerToMessagesConverter.convert(envelope);

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("Context about note.md");
      expect(messages[1].content).toContain("---");
      expect(messages[1].content).toContain("[User query]:");
      expect(messages[1].content).toContain("Summarize this");
    });

    it("puts L2 in the system message and references L3 segments already in L2 by id instead of repeating them", () => {
      const envelope = createMockEnvelope([
        {
          id: "L1_SYSTEM",
          label: "System & Policies",
          text: "System prompt",
          stable: true,
          segments: [],
          hash: "l1-hash",
        },
        {
          id: "L2_PREVIOUS",
          label: "Context Library",
          text: "<note_context><path>Notes/existing.md</path><content>Existing content</content></note_context>",
          stable: true,
          segments: [
            {
              id: "Notes/existing.md",
              content:
                "<note_context><path>Notes/existing.md</path><content>Existing content</content></note_context>",
              stable: true,
            },
          ],
          hash: "l2-hash",
        },
        {
          id: "L3_TURN",
          label: "New Context",
          text: "<note_context><path>Notes/existing.md</path><content>Existing content</content></note_context>\n<note_context><path>Notes/new.md</path><content>New content</content></note_context>",
          stable: false,
          segments: [
            {
              id: "Notes/existing.md",
              content:
                "<note_context><path>Notes/existing.md</path><content>Existing content</content></note_context>",
              stable: true,
            },
            {
              id: "Notes/new.md",
              content:
                "<note_context><path>Notes/new.md</path><content>New content</content></note_context>",
              stable: false,
            },
          ],
          hash: "l3-hash",
        },
        {
          id: "L5_USER",
          label: "User Message",
          text: "User query",
          stable: false,
          segments: [],
          hash: "l5-hash",
        },
      ]);

      const messages = LayerToMessagesConverter.convert(envelope);

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toContain("## Context Library");
      expect(messages[0].content).toContain("Existing content");
      expect(messages[1].content).toContain("Context attached");
      expect(messages[1].content).toContain("Notes/existing.md");
      expect(messages[1].content).toContain("Find them in the Context Library");
      expect(messages[1].content).toContain("New content");
      expect(messages[1].content).toContain("---");
      expect(messages[1].content).toContain("[User query]:");
      expect(messages[1].content).toContain("User query");
    });

    it("omits the system message when the L1 text is empty", () => {
      const envelope = createMockEnvelope([
        {
          id: "L1_SYSTEM",
          label: "System & Policies",
          text: "",
          stable: true,
          segments: [],
          hash: "l1-hash",
        },
        {
          id: "L5_USER",
          label: "User Message",
          text: "User query",
          stable: false,
          segments: [],
          hash: "l5-hash",
        },
      ]);

      const messages = LayerToMessagesConverter.convert(envelope);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });

    it("returns only the user message when the envelope has only an L5 layer", () => {
      const envelope = createMockEnvelope([
        {
          id: "L5_USER",
          label: "User Message",
          text: "User query",
          stable: false,
          segments: [],
          hash: "l5-hash",
        },
      ]);

      const messages = LayerToMessagesConverter.convert(envelope);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("User query");
    });
  });
});
