import { ToolManager } from "@/tools/toolManager";
import { createGetTagListTool, enforceSizeLimit } from "./TagTools";

interface TagEntry {
  tag: string;
  occurrences: number;
  frontmatterOccurrences: number;
  inlineOccurrences: number;
}

interface TagPayload {
  totalUniqueTags: number;
  returnedTagCount: number;
  totalOccurrences: number;
  truncated: boolean;
  includedSources: Array<"frontmatter" | "inline">;
  tags: TagEntry[];
}

interface MockApp {
  metadataCache: {
    getTags: jest.Mock;
    getFrontmatterTags: jest.Mock;
  };
}

const getMockApp = (): MockApp => (window as unknown as { app: MockApp }).app;
const setMockApp = (value: MockApp | undefined): void => {
  (window as unknown as { app: MockApp | undefined }).app = value;
};

describe("TagTools", () => {
  const originalApp = getMockApp();

  const parsePayload = (result: string): TagPayload => {
    const startIndex = result.indexOf('{"');
    const endIndex = result.lastIndexOf("}");

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    const jsonSegment = result.slice(startIndex, endIndex + 1);
    try {
      return JSON.parse(jsonSegment) as TagPayload;
    } catch (error) {
      console.error("Failed to parse tag tool payload:", jsonSegment);
      throw error;
    }
  };

  beforeEach(() => {
    setMockApp({
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
    });
  });

  afterEach(() => {
    setMockApp(originalApp);
    jest.clearAllMocks();
  });

  it("returns combined tag statistics by default", async () => {
    const tool = createGetTagListTool();
    const result = (await ToolManager.callTool(tool, {})) as string;

    const payload = parsePayload(result);

    expect(getMockApp().metadataCache.getTags).toHaveBeenCalled();
    expect(getMockApp().metadataCache.getFrontmatterTags).toHaveBeenCalled();
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
    const result = (await ToolManager.callTool(tool, { includeInline: false })) as string;

    const payload = parsePayload(result);

    expect(getMockApp().metadataCache.getTags).not.toHaveBeenCalled();
    expect(getMockApp().metadataCache.getFrontmatterTags).toHaveBeenCalled();
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
    const result = (await ToolManager.callTool(tool, { maxEntries: 2 })) as string;

    const payload = parsePayload(result);

    expect(payload.totalUniqueTags).toBe(3);
    expect(payload.returnedTagCount).toBe(2);
    expect(payload.truncated).toBe(true);
    expect(payload.tags).toHaveLength(2);
    expect(payload.tags[0].tag).toBe("#project");
    expect(payload.tags[1].tag).toBe("#daily");
  });

  it("handles empty vault gracefully", async () => {
    getMockApp().metadataCache.getTags.mockReturnValue({});
    getMockApp().metadataCache.getFrontmatterTags.mockReturnValue({});

    const tool = createGetTagListTool();
    const result = (await ToolManager.callTool(tool, {})) as string;

    const payload = parsePayload(result);

    expect(payload.totalUniqueTags).toBe(0);
    expect(payload.tags).toEqual([]);
    expect(payload.totalOccurrences).toBe(0);
  });

  it("normalizes malformed tags correctly", async () => {
    getMockApp().metadataCache.getTags.mockReturnValue({
      project: 5,
      "##Weird/Tag": 4,
    });
    getMockApp().metadataCache.getFrontmatterTags.mockReturnValue({
      "  #Project ": 3,
      "##Weird/Tag": 1,
    });

    const tool = createGetTagListTool();
    const result = (await ToolManager.callTool(tool, {})) as string;

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
    getMockApp().metadataCache.getTags.mockReturnValue({
      "#project": 1,
    });
    getMockApp().metadataCache.getFrontmatterTags.mockReturnValue({
      "#project": 3,
    });

    const tool = createGetTagListTool();
    const result = (await ToolManager.callTool(tool, {})) as string;

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
