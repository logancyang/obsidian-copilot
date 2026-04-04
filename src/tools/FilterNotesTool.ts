import { logInfo } from "@/logger";
import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";

/**
 * Tool to filter and list notes by metadata properties (date, tags, folder, etc.).
 * Complements localSearch by providing metadata-based filtering without full-text search.
 */
const filterNotesTool = createLangChainTool({
  name: "filterNotes",
  description:
    "Filter and list vault notes by metadata: folder path, tags, date range, or file extension. Use for browsing and organizing rather than content search.",
  schema: z.object({
    folder: z
      .string()
      .optional()
      .describe("Filter to notes in this folder path (e.g. 'Projects' or 'Daily Notes')"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Filter to notes containing these tags (e.g. ['#project', '#active'])"),
    extension: z
      .string()
      .optional()
      .describe(
        "Filter by file extension (default: 'md'). Use 'canvas' for canvas files, 'base' for bases."
      ),
    modifiedAfter: z
      .number()
      .optional()
      .describe("Only include notes modified after this epoch timestamp (ms)"),
    modifiedBefore: z
      .number()
      .optional()
      .describe("Only include notes modified before this epoch timestamp (ms)"),
    sortBy: z
      .enum(["modified", "created", "name"])
      .optional()
      .describe(
        "Sort results by: modified (newest first), created (newest first), or name (alphabetical)"
      ),
    limit: z
      .number()
      .max(200)
      .optional()
      .describe("Maximum number of results to return (default: 50, max: 200)"),
  }),
  func: async ({ folder, tags, extension, modifiedAfter, modifiedBefore, sortBy, limit }) => {
    try {
      const vault = app.vault;
      const metadataCache = app.metadataCache;
      const effectiveLimit = limit || 50;
      const ext = extension || "md";

      // Get all files matching extension
      let files = vault.getFiles().filter((f) => f.extension === ext);

      // Filter by folder (ensure trailing slash for prefix match)
      if (folder) {
        const normalizedFolder = folder.endsWith("/") ? folder : folder + "/";
        files = files.filter((f) => f.path.startsWith(normalizedFolder));
      }

      // Filter by modification date
      if (modifiedAfter) {
        files = files.filter((f) => f.stat.mtime >= modifiedAfter);
      }
      if (modifiedBefore) {
        files = files.filter((f) => f.stat.mtime <= modifiedBefore);
      }

      // Filter by tags
      if (tags && tags.length > 0) {
        files = files.filter((f) => {
          const cache = metadataCache.getFileCache(f);
          if (!cache) return false;

          // Get tags from frontmatter
          const frontmatterTags: string[] = [];
          if (cache.frontmatter?.tags) {
            const fmTags = cache.frontmatter.tags;
            if (Array.isArray(fmTags)) {
              frontmatterTags.push(...fmTags.map((t: string) => (t.startsWith("#") ? t : "#" + t)));
            } else if (typeof fmTags === "string") {
              frontmatterTags.push(fmTags.startsWith("#") ? fmTags : "#" + fmTags);
            }
          }

          // Get inline tags
          const inlineTags = (cache.tags || []).map((t) => t.tag);

          const allTags = [...frontmatterTags, ...inlineTags];

          // Check if note has all required tags
          return tags.every((requiredTag) => {
            const normalized = requiredTag.startsWith("#") ? requiredTag : "#" + requiredTag;
            return allTags.some((t) => t.toLowerCase() === normalized.toLowerCase());
          });
        });
      }

      // Sort
      const sortField = sortBy || "modified";
      files.sort((a, b) => {
        switch (sortField) {
          case "modified":
            return b.stat.mtime - a.stat.mtime;
          case "created":
            return b.stat.ctime - a.stat.ctime;
          case "name":
            return a.basename.localeCompare(b.basename);
          default:
            return b.stat.mtime - a.stat.mtime;
        }
      });

      // Limit results
      const results = files.slice(0, effectiveLimit);

      logInfo(`[filterNotes] Found ${files.length} notes, returning ${results.length}`);

      return {
        type: "filter_results",
        totalMatches: files.length,
        returned: results.length,
        notes: results.map((f) => ({
          title: f.basename,
          path: f.path,
          modified: new Date(f.stat.mtime).toISOString(),
          created: new Date(f.stat.ctime).toISOString(),
          size: f.stat.size,
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to filter notes: ${error.message}`,
      };
    }
  },
});

export { filterNotesTool };
