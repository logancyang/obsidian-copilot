import { ToolManager } from "@/tools/toolManager";
import { createGetTagListTool, enforceSizeLimit } from "./TagTools";

describe("TagTools", () => {
  const originalApp = (window as any).app;

  const parsePayload = (result: string) => {
    const startIndex = result.indexOf('{"');
    const endIndex = result.lastIndexOf("}");

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    const jsonSegment = result.slice(startIndex, endIndex + 1);
    try {
      return JSON.parse(jsonSegment);
    } catch (error) {
      // eslint-disable-next-line no-console -- helpful context when assertions fail
      console.error("Failed to parse tag tool payload:", jsonSegment);
      throw error;
    }
  };

  beforeEach(() => {
    (window as any).app = {
      metadataCache: {
        getTags: jest.fn().mockReturnValue({
          "#project": 5,
          "#daily": 4,
          "#idea": 1,
        }),
        getFrontmatterTags: jest.fn().mockReturnValue({
          "#project": 3,
          "#daily": 2,
        }),
      },
    };
  });

  afterEach(() => {
    (window as any).app = originalApp;
    jest.clearAllMocks();
  });

  it("returns combined tag statistics by default", async () => {
    const tool = createGetTagListTool();
    const result = await ToolManager.callTool(tool, {});

    const payload = parsePayload(result);

    expect((window as any).app.metadataCache.getTags).toHaveBeenCalled();
    expect((window as any).app.metadataCache.getFrontmatterTags).toHaveBeenCalled();
    expect(payload.totalUniqueTags).toBe(3);
    expect(payload.returnedTagCount).toBe(3);
    expect(payload.totalOccurrences).toBe(10);
    expect(payload.truncated).toBe(false);
    expect(payload.includedSources).toEqual(["frontmatter", "inline"]);
    expect(payload.tags).toEqual([
      {
        tag: "#project",
        occurrences: 5,
        frontmatterOccurrences: 3,
        inlineOccurrences: 2,
      },
      {
        tag: "#daily",
        occurrences: 4,
        frontmatterOccurrences: 2,
        inlineOccurrences: 2,
      },
      {
        tag: "#idea",
        occurrences: 1,
        frontmatterOccurrences: 0,
        inlineOccurrences: 1,
      },
    ]);
  });

  it("supports frontmatter-only mode", async () => {
    const tool = createGetTagListTool();
    const result = await ToolManager.callTool(tool, { includeInline: false });

    const payload = parsePayload(result);

    expect((window as any).app.metadataCache.getTags).not.toHaveBeenCalled();
    expect((window as any).app.metadataCache.getFrontmatterTags).toHaveBeenCalled();
    expect(payload.totalUniqueTags).toBe(2);
    expect(payload.includedSources).toEqual(["frontmatter"]);
    expect(payload.tags).toEqual([
      {
        tag: "#project",
        occurrences: 3,
        frontmatterOccurrences: 3,
        inlineOccurrences: 0,
      },
      {
        tag: "#daily",
        occurrences: 2,
        frontmatterOccurrences: 2,
        inlineOccurrences: 0,
      },
    ]);
  });

  it("limits entries when maxEntries is provided", async () => {
    const tool = createGetTagListTool();
    const result = await ToolManager.callTool(tool, { maxEntries: 2 });

    const payload = parsePayload(result);

    expect(payload.totalUniqueTags).toBe(3);
    expect(payload.returnedTagCount).toBe(2);
    expect(payload.truncated).toBe(true);
    expect(payload.tags).toHaveLength(2);
    expect(payload.tags[0].tag).toBe("#project");
    expect(payload.tags[1].tag).toBe("#daily");
  });

  it("handles empty vault gracefully", async () => {
    (window as any).app.metadataCache.getTags.mockReturnValue({});
    (window as any).app.metadataCache.getFrontmatterTags.mockReturnValue({});

    const tool = createGetTagListTool();
    const result = await ToolManager.callTool(tool, {});

    const payload = parsePayload(result);

    expect(payload.totalUniqueTags).toBe(0);
    expect(payload.tags).toEqual([]);
    expect(payload.totalOccurrences).toBe(0);
  });

  it("normalizes malformed tags correctly", async () => {
    (window as any).app.metadataCache.getTags.mockReturnValue({
      project: 5,
      "##Weird/Tag": 4,
    });
    (window as any).app.metadataCache.getFrontmatterTags.mockReturnValue({
      "  #Project ": 3,
      "##Weird/Tag": 1,
    });

    const tool = createGetTagListTool();
    const result = await ToolManager.callTool(tool, {});

    const payload = parsePayload(result);

    expect(payload.tags).toEqual([
      {
        tag: "#project",
        occurrences: 5,
        frontmatterOccurrences: 3,
        inlineOccurrences: 2,
      },
      {
        tag: "#weird/tag",
        occurrences: 4,
        frontmatterOccurrences: 1,
        inlineOccurrences: 3,
      },
    ]);
  });

  it("falls back when inline counts omit frontmatter occurrences", async () => {
    (window as any).app.metadataCache.getTags.mockReturnValue({
      "#project": 1,
    });
    (window as any).app.metadataCache.getFrontmatterTags.mockReturnValue({
      "#project": 3,
    });

    const tool = createGetTagListTool();
    const result = await ToolManager.callTool(tool, {});

    const payload = parsePayload(result);

    expect(payload.tags).toEqual([
      {
        tag: "#project",
        occurrences: 4,
        frontmatterOccurrences: 3,
        inlineOccurrences: 1,
      },
    ]);
  });

  it("enforces size limits when payload is too large", () => {
    const payload = {
      totalUniqueTags: 6000,
      returnedTagCount: 6000,
      totalOccurrences: 6000,
      includedSources: ["frontmatter", "inline"] as Array<"frontmatter" | "inline">,
      truncated: false,
      tags: Array.from({ length: 6000 }).map((_, index) => ({
        tag: `#tag${index}`,
        occurrences: 1,
        frontmatterOccurrences: 0,
        inlineOccurrences: 1,
      })),
    };

    const bounded = enforceSizeLimit(payload);

    expect(bounded.truncated).toBe(true);
    expect(bounded.tags.length).toBeLessThan(payload.tags.length);
    expect(bounded.returnedTagCount).toBe(bounded.tags.length);
  });
});
