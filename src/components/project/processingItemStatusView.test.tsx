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
    source: "url",
    fileType: "web",
    status: "ready",
    cacheKind: "web",
    ...overrides,
  };
}

describe("processing item keys", () => {
  it("keys files by path and URLs by url under their cache bucket", () => {
    expect(processingSourceKey("file", "data/x.xlsx")).toBe("file:data/x.xlsx");
    expect(processingSourceKey("web", "https://a.com")).toBe("web:https://a.com");
  });

  it("does NOT let the same URL configured as both web and youtube collide", () => {
    const web = makeItem({ id: "https://v", cacheKind: "web", status: "ready" });
    const youtube = makeItem({ id: "https://v", cacheKind: "youtube", status: "failed" });
    const lookup = buildProcessingItemLookup([web, youtube]);

    expect(lookup.get(processingSourceKey("web", "https://v"))?.status).toBe("ready");
    expect(lookup.get(processingSourceKey("youtube", "https://v"))?.status).toBe("failed");
    expect(lookup.size).toBe(2);
  });

  it("indexes file and url items in one lookup", () => {
    const file = makeItem({
      id: "notes/a.pdf",
      source: "file",
      cacheKind: "file",
      fileType: "pdf",
    });
    const url = makeItem({ id: "https://a.com", source: "url", cacheKind: "web" });
    const lookup = buildProcessingItemLookup([file, url]);

    expect(lookup.get(processingItemKey(file))).toBe(file);
    expect(lookup.get(processingSourceKey("file", "notes/a.pdf"))).toBe(file);
    expect(lookup.get(processingSourceKey("web", "https://a.com"))).toBe(url);
  });
});

describe("getProcessingStatusLabel", () => {
  it("surfaces a fetched-but-empty ready item as 'No content'", () => {
    expect(getProcessingStatusLabel("ready", true)).toBe("No content");
    expect(getProcessingStatusLabel("ready", false)).toBe("Converted");
  });

  it("labels each status", () => {
    expect(getProcessingStatusLabel("processing")).toBe("Converting...");
    expect(getProcessingStatusLabel("failed")).toBe("Failed");
    expect(getProcessingStatusLabel("pending")).toBe("Queued");
    expect(getProcessingStatusLabel("unsupported")).toBe("Unsupported");
  });
});
