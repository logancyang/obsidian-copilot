import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

import { ChevronDown, ChevronUp, FileText, Folder, Hash, Tag, X } from "lucide-react";

import { TruncatedText } from "@/components/TruncatedText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  categorizePatterns,
  createPatternSettingsValue,
  getDecodedPatterns,
} from "@/search/searchUtils";

const PATTERN_TYPE_CONFIG = {
  folder: { icon: Folder, colorClass: "tw-text-context-manager-yellow" },
  tag: { icon: Tag, colorClass: "tw-text-context-manager-orange" },
  note: { icon: FileText, colorClass: "tw-text-context-manager-blue" },
  extension: { icon: Hash, colorClass: "tw-text-context-manager-green" },
} as const;

type PatternType = keyof typeof PATTERN_TYPE_CONFIG;

/** Ordered list of pattern types for consistent badge rendering */
const PATTERN_TYPES: PatternType[] = ["folder", "tag", "note", "extension"];

const CATEGORY_MAP = {
  folder: "folderPatterns",
  tag: "tagPatterns",
  note: "notePatterns",
  extension: "extensionPatterns",
} as const;

interface BadgeItem {
  pattern: string;
  type: PatternType;
}

interface ProjectContextBadgeListProps {
  inclusions?: string;
  exclusions?: string;
  /** When provided, badges show X button for deletion. When absent, badges are read-only. */
  onInclusionsChange?: (value: string) => void;
  /** When provided, exclusion badges show X button. When absent, exclusion badges are read-only. */
  onExclusionsChange?: (value: string) => void;
  maxCollapsedHeight?: number;
  /** Max height when expanded — content scrolls beyond this. */
  maxExpandedHeight?: number;
  /** Optional action element rendered on the right of the control bar (e.g. "Manage Context" button). */
  actionSlot?: React.ReactNode;
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
export function removePattern(value: string | undefined, pattern: string, type: PatternType): string {
  const patterns = [...new Set(getDecodedPatterns(value || ""))];
  const categorized = categorizePatterns(patterns);
  const categoryKey = CATEGORY_MAP[type];
  return createPatternSettingsValue({
    ...categorized,
    [categoryKey]: categorized[categoryKey].filter((p) => p !== pattern),
  });
}

export const ProjectContextBadgeList: React.FC<ProjectContextBadgeListProps> = ({
  inclusions,
  exclusions,
  onInclusionsChange,
  onExclusionsChange,
  maxCollapsedHeight = 84,
  maxExpandedHeight = 200,
  actionSlot,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [contentHeight, setContentHeight] = useState<number>(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const inclusionBadges = useMemo(() => buildBadgeItems(inclusions), [inclusions]);
  const exclusionBadges = useMemo(() => buildBadgeItems(exclusions), [exclusions]);
  const hasPatterns = inclusionBadges.length > 0 || exclusionBadges.length > 0;

  // Detect overflow with ResizeObserver (same pattern as PatternListEditor)
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkOverflow = () => {
      const scrollH = el.scrollHeight;
      setContentHeight(scrollH);
      const overflows = scrollH > maxCollapsedHeight;
      setIsOverflowing(overflows);
      // Reason: Reset expanded state when content shrinks below threshold after deletion
      if (!overflows) setIsExpanded(false);
    };

    checkOverflow();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxCollapsedHeight, inclusionBadges, exclusionBadges]);

  const isTruncated = isOverflowing && !isExpanded;
  // Reason: Cap expanded height so the badge list scrolls instead of pushing the modal off-screen.
  const animatedMaxHeight = isExpanded
    ? Math.min(contentHeight, maxExpandedHeight)
    : maxCollapsedHeight;

  const handleRemoveInclusion = (pattern: string, type: PatternType) => {
    onInclusionsChange?.(removePattern(inclusions, pattern, type));
  };

  const handleRemoveExclusion = (pattern: string, type: PatternType) => {
    onExclusionsChange?.(removePattern(exclusions, pattern, type));
  };

  const renderBadge = (
    item: BadgeItem,
    isExclusion: boolean,
    onRemove?: (pattern: string, type: PatternType) => void
  ) => {
    const config = PATTERN_TYPE_CONFIG[item.type];
    const Icon = config.icon;
    return (
      <Badge
        key={`${isExclusion ? "ex" : "in"}:${item.type}:${item.pattern}`}
        variant="secondary"
        className={cn(
          "tw-group tw-flex tw-h-7 tw-items-center tw-gap-1.5 tw-py-1 tw-pl-2 tw-pr-1.5 sm:tw-h-6 sm:tw-py-0.5 sm:tw-pl-1.5",
          isExclusion && "tw-opacity-60"
        )}
      >
        <Icon className={cn("tw-size-4 tw-shrink-0 sm:tw-size-3", config.colorClass)} />
        <TruncatedText className="tw-max-w-[100px] sm:tw-max-w-[120px]">
          {item.pattern}
        </TruncatedText>
        {onRemove && (
          <Button
            variant="ghost2"
            size="fit"
            aria-label={`Remove ${item.pattern}`}
            className="tw-h-auto tw-p-0"
            onClick={() => onRemove(item.pattern, item.type)}
          >
            <X className="tw-size-4 tw-shrink-0 tw-text-muted hover:tw-text-warning sm:tw-size-3" />
          </Button>
        )}
      </Badge>
    );
  };

  // Empty state
  if (!hasPatterns) {
    return (
      <div className="tw-flex tw-flex-col tw-gap-2">
        <div className="tw-rounded-md tw-border tw-border-dashed tw-border-border tw-py-4 tw-text-center">
          <span className="tw-text-sm tw-italic tw-text-muted">No file patterns configured</span>
        </div>
        {actionSlot && (
          <div className="tw-flex tw-justify-end">{actionSlot}</div>
        )}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {/* Content container */}
      <div className="tw-relative tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-2">
        <div
          ref={contentRef}
          className={cn(
            "tw-transition-[max-height] tw-duration-300 tw-ease-in-out",
            isExpanded && contentHeight > maxExpandedHeight
              ? "tw-overflow-y-auto"
              : "tw-overflow-hidden"
          )}
          style={{ maxHeight: isOverflowing ? animatedMaxHeight : undefined }}
        >
          {/* Inclusion badges */}
          {inclusionBadges.length > 0 && (
            <div className="tw-flex tw-flex-wrap tw-gap-1.5">
              {inclusionBadges.map((b) =>
                renderBadge(b, false, onInclusionsChange ? handleRemoveInclusion : undefined)
              )}
            </div>
          )}

          {/* Exclusion area: dashed separator + "Excluded:" label + badges */}
          {exclusionBadges.length > 0 && (
            <>
              {inclusionBadges.length > 0 && (
                <div className="tw-my-2 tw-border-t tw-border-dashed tw-border-border" />
              )}
              <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
                <span className="tw-mr-1 tw-text-xs tw-font-medium tw-text-muted">Excluded:</span>
                {exclusionBadges.map((b) =>
                  renderBadge(b, true, onExclusionsChange ? handleRemoveExclusion : undefined)
                )}
              </div>
            </>
          )}
        </div>

        {/* Gradient fade mask when truncated */}
        {isTruncated && (
          <div className="copilot-fade-mask-bottom tw-pointer-events-none tw-absolute tw-inset-x-0 tw-bottom-0 tw-h-10 tw-rounded-b-md" />
        )}
      </div>

      {/* Control bar: Show on left, action slot on right */}
      {(isOverflowing || actionSlot) && (
        <div className="tw-flex tw-flex-row tw-items-center tw-justify-between">
          {isOverflowing ? (
            <Button
              variant="ghost2"
              size="sm"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="tw-h-9 tw-gap-1 tw-px-3 tw-text-accent sm:tw-h-auto sm:tw-px-2"
            >
              {isExpanded ? (
                <>
                  Show less <ChevronUp className="tw-size-4 sm:tw-size-3" />
                </>
              ) : (
                <>
                  Show all ({inclusionBadges.length + exclusionBadges.length}){" "}
                  <ChevronDown className="tw-size-4 sm:tw-size-3" />
                </>
              )}
            </Button>
          ) : (
            <div />
          )}
          {actionSlot}
        </div>
      )}
    </div>
  );
};
