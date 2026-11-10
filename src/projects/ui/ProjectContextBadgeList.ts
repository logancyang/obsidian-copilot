import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
  parsePropertyPattern,
} from "@/search/searchUtils";

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

export function getBadgeLabel(item: BadgeItem): string {
  if (item.type !== "property") return item.pattern;
  const parsed = parsePropertyPattern(item.pattern);
  if (!parsed) return item.pattern;
  return parsed.value ? `${parsed.key}: ${parsed.value}` : `${parsed.key}: (any)`;
}

export function buildBadgeItems(value: string | undefined): BadgeItem[] {
  const patterns = [...new Set(getDecodedPatterns(value || ""))];
  const categorized = categorizePatterns(patterns);
  const items: BadgeItem[] = [];
  PATTERN_TYPES.forEach((type) => {
    categorized[CATEGORY_MAP[type]].forEach((p) => items.push({ pattern: p, type }));
  });
  return items;
}

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
