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

  describe("convert", () => {
    it("should convert envelope with L1 and L5 to system + user messages", () => {
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

    it("should merge L3 and L5 into user message", () => {
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
      expect(messages[1].content).toContain("Summarize this");
    });

    it("should include L2 (Previous) in user message", () => {
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
          label: "Previous Turn Context",
          text: "Previous turn note content",
          stable: true,
          segments: [],
          hash: "l2-hash",
        },
        {
          id: "L3_TURN",
          label: "Turn Context",
          text: "Turn context",
          stable: false,
          segments: [],
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
      expect(messages[1].content).toContain("Previous turn note content");
      expect(messages[1].content).toContain("Turn context");
      expect(messages[1].content).toContain("User query");
    });

    it("should skip system message when includeSystemMessage is false", () => {
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
          id: "L5_USER",
          label: "User Message",
          text: "User query",
          stable: false,
          segments: [],
          hash: "l5-hash",
        },
      ]);

      const messages = LayerToMessagesConverter.convert(envelope, {
        includeSystemMessage: false,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });

    it("should handle envelope with empty layers", () => {
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

      // Should only have user message (system message is empty)
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });

    it("should handle envelope with only L5 layer", () => {
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

  describe("extractUserContent", () => {
    it("should extract merged user content (L2+L3+L5)", () => {
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
          label: "Previous Turn Context",
          text: "Previous turn content",
          stable: true,
          segments: [],
          hash: "l2-hash",
        },
        {
          id: "L3_TURN",
          label: "Turn Context",
          text: "Turn context",
          stable: false,
          segments: [],
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

      const userContent = LayerToMessagesConverter.extractUserContent(envelope);

      expect(userContent).toContain("Previous turn content");
      expect(userContent).toContain("Turn context");
      expect(userContent).toContain("User query");
      expect(userContent).not.toContain("System prompt");
    });

    it("should handle envelope with only L5", () => {
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

      const userContent = LayerToMessagesConverter.extractUserContent(envelope);
      expect(userContent).toBe("User query");
    });
  });

  describe("extractSystemMessage", () => {
    it("should extract system message from L1", () => {
      const envelope = createMockEnvelope([
        {
          id: "L1_SYSTEM",
          label: "System & Policies",
          text: "You are a helpful assistant.",
          stable: true,
          segments: [],
          hash: "l1-hash",
        },
      ]);

      const systemMessage = LayerToMessagesConverter.extractSystemMessage(envelope);
      expect(systemMessage).toBe("You are a helpful assistant.");
    });

    it("should return empty string when L1 is not present", () => {
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

      const systemMessage = LayerToMessagesConverter.extractSystemMessage(envelope);
      expect(systemMessage).toBe("");
    });
  });

  describe("getLayerHashes", () => {
    it("should return layer hashes from envelope", () => {
      const envelope = createMockEnvelope([
        {
          id: "L1_SYSTEM",
          label: "System & Policies",
          text: "System prompt",
          stable: true,
          segments: [],
          hash: "l1-hash-123",
        },
        {
          id: "L5_USER",
          label: "User Message",
          text: "User query",
          stable: false,
          segments: [],
          hash: "l5-hash-456",
        },
      ]);

      const hashes = LayerToMessagesConverter.getLayerHashes(envelope);

      expect(hashes.L1_SYSTEM).toBe("l1-hash-123");
      expect(hashes.L5_USER).toBe("l5-hash-456");
    });
  });
});
