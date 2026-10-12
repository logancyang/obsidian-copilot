import type { ProcessingItem } from "@/components/project/processingAdapter";
import {
  buildProcessingItemLookup,
  getProcessingStatusLabel,
  processingItemKey,
  processingSourceKey,
} from "@/components/project/processingItemStatusView";

function makeItem(overrides: Partial<ProcessingItem>): ProcessingItem {
  return {
    id: "x",
    name: "x",
    status: "ready",
    cacheKind: "web",
    ...overrides,
  };
}

describe("processingItemStatusView", () => {
  describe("processingSourceKey()", () => {
    it("keys URLs by url under their cache bucket", () => {
      expect(processingSourceKey("web", "https://a.com")).toBe("web:https://a.com");
      expect(processingSourceKey("youtube", "https://youtu.be/x")).toBe(
        "youtube:https://youtu.be/x"
      );
    });
  });

  describe("buildProcessingItemLookup()", () => {
    it("indexes items by cache bucket and id", () => {
      const url = makeItem({ id: "https://a.com", cacheKind: "web" });
      const lookup = buildProcessingItemLookup([url]);

      expect(lookup.get(processingItemKey(url))).toBe(url);
      expect(lookup.get(processingSourceKey("web", "https://a.com"))).toBe(url);
    });

    it("keeps the same URL configured as both web and youtube as separate entries", () => {
      const web = makeItem({ id: "https://v", cacheKind: "web", status: "ready" });
      const youtube = makeItem({ id: "https://v", cacheKind: "youtube", status: "failed" });
      const lookup = buildProcessingItemLookup([web, youtube]);

      expect(lookup.get(processingSourceKey("web", "https://v"))?.status).toBe("ready");
      expect(lookup.get(processingSourceKey("youtube", "https://v"))?.status).toBe("failed");
      expect(lookup.size).toBe(2);
    });
  });

  describe("getProcessingStatusLabel()", () => {
    it("labels each status", () => {
      expect(getProcessingStatusLabel("processing")).toBe("Converting...");
      expect(getProcessingStatusLabel("failed")).toBe("Failed");
      expect(getProcessingStatusLabel("pending")).toBe("Queued");
      expect(getProcessingStatusLabel("unsupported")).toBe("Unsupported");
    });

    it("surfaces a fetched-but-empty ready item as 'No content'", () => {
      expect(getProcessingStatusLabel("ready", true)).toBe("No content");
      expect(getProcessingStatusLabel("ready", false)).toBe("Converted");
    });
  });
});
