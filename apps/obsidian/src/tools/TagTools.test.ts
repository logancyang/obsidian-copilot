import type { App } from "obsidian";
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

const parsePayload = (result: string): TagPayload => {
  const startIndex = result.indexOf('{"');
  const endIndex = result.lastIndexOf("}");
  return JSON.parse(result.slice(startIndex, endIndex + 1)) as TagPayload;
};

describe("TagTools", () => {
  describe("createGetTagListTool()", () => {
    let inlineAndFrontmatterTags: Record<string, number>;
    let frontmatterTags: Record<string, number>;

    const callTool = async (args: Record<string, unknown> = {}): Promise<TagPayload> => {
      const app = {
        metadataCache: {
          getTags: () => inlineAndFrontmatterTags,
          getFrontmatterTags: () => frontmatterTags,
        },
      } as unknown as App;
      const result = (await ToolManager.callTool(createGetTagListTool(app), args)) as string;
      return parsePayload(result);
    };

    beforeEach(() => {
      inlineAndFrontmatterTags = { "#project": 5, "#daily": 4, "#idea": 1 };
      frontmatterTags = { "#project": 3, "#daily": 2 };
    });

    it("returns frontmatter and inline counts per tag, most frequent first", async () => {
      const payload = await callTool();

      expect(payload.totalUniqueTags).toBe(3);
      expect(payload.returnedTagCount).toBe(3);
      expect(payload.totalOccurrences).toBe(10);
      expect(payload.truncated).toBe(false);
      expect(payload.includedSources).toEqual(["frontmatter", "inline"]);
      expect(payload.tags).toEqual([
        { tag: "#project", occurrences: 5, frontmatterOccurrences: 3, inlineOccurrences: 2 },
        { tag: "#daily", occurrences: 4, frontmatterOccurrences: 2, inlineOccurrences: 2 },
        { tag: "#idea", occurrences: 1, frontmatterOccurrences: 0, inlineOccurrences: 1 },
      ]);
    });

    it("counts only frontmatter tags when includeInline is false", async () => {
      const payload = await callTool({ includeInline: false });

      expect(payload.totalUniqueTags).toBe(2);
      expect(payload.includedSources).toEqual(["frontmatter"]);
      expect(payload.tags).toEqual([
        { tag: "#project", occurrences: 3, frontmatterOccurrences: 3, inlineOccurrences: 0 },
        { tag: "#daily", occurrences: 2, frontmatterOccurrences: 2, inlineOccurrences: 0 },
      ]);
    });

    it("keeps only the top maxEntries tags and marks the result truncated", async () => {
      const payload = await callTool({ maxEntries: 2 });

      expect(payload.totalUniqueTags).toBe(3);
      expect(payload.returnedTagCount).toBe(2);
      expect(payload.truncated).toBe(true);
      expect(payload.tags.map((entry) => entry.tag)).toEqual(["#project", "#daily"]);
    });

    it("reports zero tags for a vault without any", async () => {
      inlineAndFrontmatterTags = {};
      frontmatterTags = {};

      const payload = await callTool();

      expect(payload.totalUniqueTags).toBe(0);
      expect(payload.tags).toEqual([]);
      expect(payload.totalOccurrences).toBe(0);
    });

    it("merges tags that differ only by case, padding or leading hashes", async () => {
      inlineAndFrontmatterTags = { project: 5, "##Weird/Tag": 4 };
      frontmatterTags = { "  #Project ": 3, "##Weird/Tag": 1 };

      const payload = await callTool();

      expect(payload.tags).toEqual([
        { tag: "#project", occurrences: 5, frontmatterOccurrences: 3, inlineOccurrences: 2 },
        { tag: "#weird/tag", occurrences: 4, frontmatterOccurrences: 1, inlineOccurrences: 3 },
      ]);
    });

    it("adds frontmatter occurrences on top of the inline count when the inline total omits them", async () => {
      inlineAndFrontmatterTags = { "#project": 1 };
      frontmatterTags = { "#project": 3 };

      const payload = await callTool();

      expect(payload.tags).toEqual([
        { tag: "#project", occurrences: 4, frontmatterOccurrences: 3, inlineOccurrences: 1 },
      ]);
    });
  });

  describe("enforceSizeLimit()", () => {
    it("returns a payload under the size limit unchanged", () => {
      const payload = {
        totalUniqueTags: 1,
        returnedTagCount: 1,
        totalOccurrences: 1,
        includedSources: ["frontmatter", "inline"] as Array<"frontmatter" | "inline">,
        truncated: false,
        tags: [{ tag: "#a", occurrences: 1, frontmatterOccurrences: 0, inlineOccurrences: 1 }],
      };

      expect(enforceSizeLimit(payload)).toEqual(payload);
    });

    it("drops tags until the serialized payload fits and marks it truncated", () => {
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
      expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(500_000);
    });
  });
});
