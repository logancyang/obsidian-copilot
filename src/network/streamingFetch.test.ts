import { getNativeStreamingFetch } from "@/network/streamingFetch";

describe("streamingFetch", () => {
  describe("getNativeStreamingFetch()", () => {
    it("uses the active Obsidian window as the native fetch receiver", async () => {
      const response = {} as Response;
      const fetchMock = jest.fn(function (this: Window) {
        expect(this).toBe(activeWindow);
        return Promise.resolve(response);
      });
      const originalFetch = activeWindow.fetch;
      activeWindow.fetch = fetchMock;

      try {
        const streamingFetch = getNativeStreamingFetch();

        await expect(streamingFetch("https://example.com/stream")).resolves.toBe(response);
      } finally {
        activeWindow.fetch = originalFetch;
      }
    });
  });
});
