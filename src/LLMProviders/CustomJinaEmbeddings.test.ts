import { CustomJinaEmbeddings } from "./CustomJinaEmbeddings";

describe("CustomJinaEmbeddings", () => {
  describe("CustomJinaEmbeddings", () => {
    describe("embedQuery()", () => {
      afterEach(() => {
        delete (window as { fetch?: typeof fetch }).fetch;
      });

      it("forwards configured headers with an embeddings request", async () => {
        const fetchSpy = jest.fn().mockResolvedValue({
          json: async () => ({
            model: "jina-clip-v2",
            object: "list",
            usage: { total_tokens: 1, prompt_tokens: 1 },
            data: [{ object: "embedding", index: 0, embedding: [0.25] }],
          }),
        });
        window.fetch = fetchSpy as typeof fetch;
        const embeddings = new CustomJinaEmbeddings({
          apiKey: "plus-token",
          headers: { "X-Client-Version": "4.0.0-preview-260802" },
        });

        await expect(embeddings.embedQuery("hello")).resolves.toEqual([0.25]);
        expect(fetchSpy).toHaveBeenCalledWith(
          "https://api.jina.ai/v1/embeddings",
          expect.objectContaining({
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer plus-token",
              "X-Client-Version": "4.0.0-preview-260802",
            },
          })
        );
      });
    });
  });
});
