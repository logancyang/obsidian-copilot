import { CustomJinaEmbeddings } from "@/LLMProviders/CustomJinaEmbeddings";

const mockFetch = jest.fn<Promise<unknown>, [string, RequestInit | undefined]>();

jest.mock("@/utils", () => {
  const actual = jest.requireActual<Record<string, unknown>>("@/utils");
  return {
    ...actual,
    safeFetchNoThrow: (url: string, options?: RequestInit): unknown => mockFetch(url, options),
  };
});

/**
 * Builds a minimal safeFetchNoThrow-shaped response. safeFetchNoThrow never
 * throws on HTTP error status, so error bodies arrive through json() exactly
 * like success bodies.
 */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function makeEmbeddings(fields?: Partial<ConstructorParameters<typeof CustomJinaEmbeddings>[0]>) {
  return new CustomJinaEmbeddings({
    apiKey: "test-key",
    model: "jina-clip-v2",
    maxRetries: 0,
    ...fields,
  });
}

describe("CustomJinaEmbeddings", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("CustomJinaEmbeddings", () => {
    describe("embedQuery()", () => {
      it("sends a JSON POST through safeFetchNoThrow with auth header and retrieval.query task", async () => {
        mockFetch.mockResolvedValue(jsonResponse({ data: [{ index: 0, embedding: [1, 2, 3] }] }));

        await makeEmbeddings().embedQuery("hello\nworld");

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toBe("https://api.jina.ai/v1/embeddings");
        expect(options?.method).toBe("POST");
        expect(options?.headers).toMatchObject({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        });
        expect(JSON.parse(options?.body as string)).toMatchObject({
          model: "jina-clip-v2",
          input: ["hello world"],
          task: "retrieval.query",
        });
      });

      it("forwards configured headers alongside the content-type and auth headers", async () => {
        mockFetch.mockResolvedValue(jsonResponse({ data: [{ index: 0, embedding: [0.25] }] }));

        await expect(
          makeEmbeddings({
            apiKey: "plus-token",
            headers: { "X-Client-Version": "4.0.0-preview-260802" },
          }).embedQuery("hello")
        ).resolves.toEqual([0.25]);

        const [, options] = mockFetch.mock.calls[0];
        expect(options?.headers).toEqual({
          "Content-Type": "application/json",
          Authorization: "Bearer plus-token",
          "X-Client-Version": "4.0.0-preview-260802",
        });
      });

      it("returns the first embedding vector from the response", async () => {
        mockFetch.mockResolvedValue(
          jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] })
        );

        await expect(makeEmbeddings().embedQuery("hello")).resolves.toEqual([0.1, 0.2, 0.3]);
      });

      it("throws an error carrying the JSON `detail` message on a non-200 error body", async () => {
        mockFetch.mockResolvedValue(jsonResponse({ detail: "Invalid API key" }, 401));

        await expect(makeEmbeddings().embedQuery("hello")).rejects.toThrow("Invalid API key");
      });

      it("propagates the parse error when the response body is not JSON", async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 502,
          json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
        });

        await expect(makeEmbeddings().embedQuery("hello")).rejects.toThrow(SyntaxError);
      });

      it("propagates a network failure rejection from safeFetchNoThrow", async () => {
        mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

        await expect(makeEmbeddings().embedQuery("hello")).rejects.toThrow("Failed to fetch");
      });
    });

    describe("embedDocuments()", () => {
      it("sends passages with the retrieval.passage task and returns vectors in input order", async () => {
        mockFetch.mockResolvedValue(
          jsonResponse({
            data: [
              { index: 0, embedding: [1] },
              { index: 1, embedding: [2] },
            ],
          })
        );

        const result = await makeEmbeddings().embedDocuments(["a", "b"]);

        expect(result).toEqual([[1], [2]]);
        const [, options] = mockFetch.mock.calls[0];
        expect(JSON.parse(options?.body as string)).toMatchObject({
          input: ["a", "b"],
          task: "retrieval.passage",
        });
      });

      it("throws an error carrying the JSON `detail` message on a non-200 error body", async () => {
        mockFetch.mockResolvedValue(jsonResponse({ detail: "Rate limit exceeded" }, 429));

        await expect(makeEmbeddings().embedDocuments(["a"])).rejects.toThrow("Rate limit exceeded");
      });
    });
  });
});
