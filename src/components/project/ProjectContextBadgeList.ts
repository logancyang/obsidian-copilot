import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  parsePropertyPattern,
} from "@/search/searchUtils";

/** Ordered list of pattern types for consistent badge rendering. */
const PATTERN_TYPES = ["folder", "tag", "note", "extension", "property"] as const;

type PatternType = (typeof PATTERN_TYPES)[number];

const CATEGORY_MAP = {
  folder: "folderPatterns",
  tag: "tagPatterns",
  note: "notePatterns",
  extension: "extensionPatterns",
  property: "propertyPatterns",
} as const;

interface BadgeItem {
  pattern: string;
  type: PatternType;
}

/**
 * Display label for a badge/chip. Property patterns render as `key: value` (or
 * `key: (any)` for the key-only form) so they read like the frontmatter the user
 * wrote; every other type shows its raw pattern unchanged.
 */
export function getBadgeLabel(item: BadgeItem): string {
  if (item.type !== "property") return item.pattern;
  const parsed = parsePropertyPattern(item.pattern);
  if (!parsed) return item.pattern;
  return parsed.value ? `${parsed.key}: ${parsed.value}` : `${parsed.key}: (any)`;
}

/** Decode, deduplicate, and categorize a pattern string into badge items */
export function buildBadgeItems(value: string | undefined): BadgeItem[] {
  const patterns = [...new Set(getDecodedPatterns(value || ""))];
  const categorized = categorizePatterns(patterns);
  const items: BadgeItem[] = [];
  PATTERN_TYPES.forEach((type) => {
    categorized[CATEGORY_MAP[type]].forEach((p) => items.push({ pattern: p, type }));
  });
  return items;
}

/**
 * Remove a pattern from a serialized pattern string.
 * Returns the new serialized string with the pattern removed.
 */
export function removePattern(
  value: string | undefined,
  pattern: string,
  type: PatternType
): string {
  const patterns = [...new Set(getDecodedPatterns(value || ""))];
  const categorized = categorizePatterns(patterns);
  const categoryKey = CATEGORY_MAP[type];
  return createPatternSettingsValue({
    ...categorized,
    [categoryKey]: categorized[categoryKey].filter((p) => p !== pattern),
  });
}
