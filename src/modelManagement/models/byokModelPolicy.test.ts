import { assertByokChatModels, isEmbeddingModel, BYOK_EMBEDDING_ERROR } from "./byokModelPolicy";

describe("byokModelPolicy", () => {
  describe("isEmbeddingModel()", () => {
    it.each([
      [{ id: "opaque", displayName: "Opaque", isEmbedding: true }, true],
      [{ id: "nomic-embed-text", displayName: "Nomic", isEmbedding: false }, true],
      [{ id: "text-embedding-3-small", displayName: "Embedding" }, true],
      [{ id: "embedded-chat", displayName: "Chat" }, false],
      [{ id: "opaque-chat", displayName: "Chat" }, false],
    ])(
      "classifies %j using metadata or bounded IDs (https://github.com/Brevilabs/obsidian-copilot-private/issues/386)",
      (info, expected) => {
        expect(isEmbeddingModel(info)).toBe(expected);
      }
    );
  });
  describe("assertByokChatModels()", () => {
    it("rejects a mixed batch and accepts chat-only models (https://github.com/Brevilabs/obsidian-copilot-private/issues/386)", () => {
      const chat = { id: "chat", displayName: "Chat" };
      expect(() => assertByokChatModels([chat])).not.toThrow();
      expect(() => assertByokChatModels([chat, { id: "embed", displayName: "Embed" }])).toThrow(
        BYOK_EMBEDDING_ERROR
      );
    });
  });
});
