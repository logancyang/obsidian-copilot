import { MetadataCache } from "obsidian";
import { z } from "zod";
import { createTool } from "./SimpleTool";

const TAG_LIST_SIZE_LIMIT_BYTES = 500_000;
const DEFAULT_MAX_TAG_ENTRIES = 500;
const MIN_TAG_ENTRIES = 50;

type MetadataCacheWithTags = MetadataCache & {
  getTags?: () => Record<string, number> | null;
  getFrontmatterTags?: () => Record<string, number> | null;
};

export const TagListToolSchema = z
  .object({
    includeInline: z
      .boolean()
      .optional()
      .describe("Include inline tags in addition to frontmatter tags. Defaults to true."),
    maxEntries: z
      .number()
      .int()
      .positive()
      .max(5000)
      .optional()
      .describe(
        "Maximum number of tag entries to return, sorted by occurrences. Responses are capped at ~500KB."
      ),
  })
  .describe("Parameters for retrieving the tag list.");

interface TagCountEntry {
  tag: string;
  occurrences: number;
  frontmatterOccurrences: number;
  inlineOccurrences: number;
}

interface TagListPayload {
  totalUniqueTags: number;
  returnedTagCount: number;
  totalOccurrences: number;
  includedSources: Array<"frontmatter" | "inline">;
  truncated: boolean;
  tags: TagCountEntry[];
  note?: string;
}

/**
 * Safely retrieves the metadata cache from the global Obsidian app instance.
 *
 * @returns The metadata cache when available, otherwise null.
 */
function getMetadataCache(): MetadataCache | null {
  if (typeof app === "undefined" || !app?.metadataCache) {
    return null;
  }
  return app.metadataCache;
}

/**
 * Normalizes tag maps from Obsidian so tags always include a leading hash and counts are non-negative integers.
 *
 * @param tagMap - Raw tag map returned by the metadata cache.
 * @returns A cleaned tag map keyed by canonical tag strings.
 */
function normalizeTagMap(tagMap?: Record<string, number> | null): Record<string, number> {
  const normalized: Record<string, number> = {};

  if (!tagMap) {
    return normalized;
  }

  for (const [rawTag, rawCount] of Object.entries(tagMap)) {
    const trimmedTag = rawTag?.trim();
    if (!trimmedTag) {
      continue;
    }

    const canonicalBody = trimmedTag.replace(/^#+/, "").trim().toLowerCase();
    if (!canonicalBody) {
      continue;
    }
    const canonicalTag = `#${canonicalBody}`;

    if (canonicalTag === "#") {
      continue;
    }

    const count = Number.isFinite(rawCount) ? Math.max(0, Math.floor(rawCount)) : 0;
    normalized[canonicalTag] = (normalized[canonicalTag] || 0) + count;
  }

  return normalized;
}

/**
 * Collects tag statistics from the metadata cache for inclusion in the tool response.
 *
 * @param cache - Obsidian metadata cache instance.
 * @param includeInline - Whether inline tags should be included.
 * @param maxEntries - Maximum number of tag entries to return.
 * @returns Aggregate tag payload including counts and truncation metadata.
 */
function collectTagEntries(
  cache: MetadataCache,
  includeInline: boolean,
  maxEntries: number
): TagListPayload {
  const cacheWithTags = cache as MetadataCacheWithTags;
  const frontmatterMap = normalizeTagMap(cacheWithTags.getFrontmatterTags?.());
  const allTagMap = includeInline ? normalizeTagMap(cacheWithTags.getTags?.()) : {};

  const tagKeys = new Set<string>([
    ...Object.keys(frontmatterMap),
    ...(includeInline ? Object.keys(allTagMap) : []),
  ]);

  const entries: TagCountEntry[] = [];
  let totalOccurrences = 0;

  for (const tag of tagKeys) {
    const frontmatterOccurrences = frontmatterMap[tag] ?? 0;
    const totalFromCache = includeInline ? Math.max(0, allTagMap[tag] ?? 0) : 0;

    // Obsidian's metadataCache.getTags() returns aggregate counts including frontmatter.
    // When third-party plugins override this behaviour or the cache is still warming,
    // fall back to additive aggregation to prevent under-reporting inline usage.
    let inlineOccurrences = 0;
    let combinedOccurrences = frontmatterOccurrences;

    if (includeInline) {
      if (totalFromCache >= frontmatterOccurrences) {
        inlineOccurrences = totalFromCache - frontmatterOccurrences;
        combinedOccurrences = totalFromCache;
      } else if (totalFromCache > 0) {
        inlineOccurrences = totalFromCache;
        combinedOccurrences = frontmatterOccurrences + inlineOccurrences;
      }
    }

    if (combinedOccurrences === 0) {
      continue;
    }

    totalOccurrences += combinedOccurrences;

    entries.push({
      tag,
      occurrences: combinedOccurrences,
      frontmatterOccurrences,
      inlineOccurrences,
    });
  }

  entries.sort((first, second) => {
    if (second.occurrences === first.occurrences) {
      return first.tag.localeCompare(second.tag);
    }
    return second.occurrences - first.occurrences;
  });

  const trimmedEntries = entries.slice(0, maxEntries);

  return {
    totalUniqueTags: entries.length,
    returnedTagCount: trimmedEntries.length,
    totalOccurrences,
    includedSources: includeInline ? ["frontmatter", "inline"] : ["frontmatter"],
    truncated: trimmedEntries.length < entries.length,
    tags: trimmedEntries,
  };
}

/**
 * Ensures the payload stays within the configured size limit, progressively trimming entries when needed.
 *
 * @param payload - Tag payload to evaluate.
 * @returns The original payload if within size limits, otherwise a trimmed version.
 */
function enforceSizeLimit(payload: TagListPayload): TagListPayload {
  let currentPayload = payload;
  let serialized = JSON.stringify(currentPayload);

  if (serialized.length <= TAG_LIST_SIZE_LIMIT_BYTES) {
    return currentPayload;
  }

  let maxEntries = currentPayload.tags.length;
  while (serialized.length > TAG_LIST_SIZE_LIMIT_BYTES && maxEntries > MIN_TAG_ENTRIES) {
    maxEntries = Math.max(MIN_TAG_ENTRIES, Math.floor(maxEntries / 2));
    currentPayload = {
      ...currentPayload,
      tags: payload.tags.slice(0, maxEntries),
      returnedTagCount: maxEntries,
      truncated: true,
    };
    serialized = JSON.stringify(currentPayload);
  }

  if (serialized.length > TAG_LIST_SIZE_LIMIT_BYTES) {
    return {
      totalUniqueTags: payload.totalUniqueTags,
      returnedTagCount: 0,
      totalOccurrences: payload.totalOccurrences,
      includedSources: payload.includedSources,
      truncated: true,
      tags: [],
      note: "Tag list exceeded the size limit. Request a narrower scope or specify a smaller maxEntries value.",
    };
  }

  return currentPayload;
}

/**
 * Formats the payload with a leading prompt so downstream consumers understand the structure.
 *
 * @param payload - Tag payload to format.
 * @returns Prompt-prefixed JSON string describing the tag inventory.
 */
function formatTagListResult(payload: TagListPayload): string {
  const prompt = `A JSON object lists the vault tags and their occurrence counts:
* totalUniqueTags: number of unique tags indexed across the vault
* returnedTagCount: number of tag entries included in this response
* totalOccurrences: total tag occurrences across included sources
* includedSources: sources represented in the counts (frontmatter, inline)
* truncated: whether the list was shortened due to limits
* tags: array of tag objects { tag, occurrences, frontmatterOccurrences, inlineOccurrences }
`;
  return `${prompt}${JSON.stringify(payload)}`;
}

/**
 * Creates a tool that returns the current tag inventory with aggregated counts.
 *
 * @returns A tool for retrieving vault tag statistics.
 */
export const createGetTagListTool = () =>
  createTool({
    name: "getTagList",
    description: "Get the list of tags in the vault with occurrence statistics.",
    schema: TagListToolSchema,
    handler: async (args) => {
      const metadataCache = getMetadataCache();
      const includeInline = args?.includeInline ?? true;
      const maxEntries = args?.maxEntries ?? DEFAULT_MAX_TAG_ENTRIES;

      if (!metadataCache) {
        const emptyPayload: TagListPayload = {
          totalUniqueTags: 0,
          returnedTagCount: 0,
          totalOccurrences: 0,
          includedSources: includeInline ? ["frontmatter", "inline"] : ["frontmatter"],
          truncated: false,
          tags: [],
          note: "Metadata cache is unavailable. Try again after the vault finishes indexing.",
        };
        return formatTagListResult(emptyPayload);
      }

      const payload = collectTagEntries(metadataCache, includeInline, maxEntries);
      const boundedPayload = enforceSizeLimit(payload);
      return formatTagListResult(boundedPayload);
    },
    isBackground: true,
  });

export { collectTagEntries, enforceSizeLimit };
