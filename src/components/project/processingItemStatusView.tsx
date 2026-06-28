import type { ProcessingItem } from "@/components/project/processingAdapter";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Clock, HelpCircle, Loader2 } from "lucide-react";
import React from "react";

/**
 * Single source of truth for rendering an agent {@link ProcessingItem}'s
 * conversion status — the key it's looked up by, its status glyph, and its label.
 *
 * Every agent surface (the composer status popover, the Manage modal's Links
 * panel, and its File Context list) routes through here so the status semantics
 * never drift across them. The legacy CAG status (`ProjectContextItemStatus` in
 * the Manage modal) is deliberately NOT folded in: it reads a different cache
 * (`ProjectContextCache`) with different semantics, so it stays separate.
 */

/** Canonical lookup key for a processing item: `<cacheKind>:<id>`. Keying on the
 * cache bucket (not just the id) keeps a URL configured as BOTH web and youtube
 * — two items sharing one id — from clobbering each other. */
export function processingSourceKey(kind: ProcessingItem["cacheKind"], id: string): string {
  return `${kind}:${id}`;
}

export function processingItemKey(item: ProcessingItem): string {
  return processingSourceKey(item.cacheKind, item.id);
}

/** Index a processing-item list by {@link processingItemKey} for O(1) per-row lookup. */
export function buildProcessingItemLookup(
  items: readonly ProcessingItem[]
): ReadonlyMap<string, ProcessingItem> {
  const map = new Map<string, ProcessingItem>();
  for (const item of items) map.set(processingItemKey(item), item);
  return map;
}

/** Human-readable status label. `contentEmpty` is a sub-state of `ready` (fetched
 * but no extractable content), surfaced as "No content". */
export function getProcessingStatusLabel(
  status: ProcessingItem["status"],
  contentEmpty?: boolean
): string {
  if (status === "ready" && contentEmpty) return "No content";
  switch (status) {
    case "ready":
      return "Converted";
    case "processing":
      return "Converting...";
    case "failed":
      return "Failed";
    case "pending":
      return "Queued";
    case "unsupported":
      return "Unsupported";
  }
}

function ProcessingStatusGlyph({ item, className }: { item: ProcessingItem; className?: string }) {
  // contentEmpty rides on "ready": fetched OK but empty, so it warns rather than
  // resting on the green check.
  if (item.status === "ready" && item.contentEmpty) {
    return <HelpCircle className={cn("tw-size-3.5 tw-text-warning", className)} />;
  }
  switch (item.status) {
    case "ready":
      return <CheckCircle2 className={cn("tw-size-3.5 tw-text-success", className)} />;
    case "processing":
      return <Loader2 className={cn("tw-size-3.5 tw-animate-spin tw-text-loading", className)} />;
    case "failed":
      return <AlertCircle className={cn("tw-size-3.5 tw-text-error", className)} />;
    case "pending":
      return <Clock className={cn("tw-size-3.5 tw-text-muted", className)} />;
    case "unsupported":
      return <HelpCircle className={cn("tw-size-3.5 tw-text-muted", className)} />;
  }
}

interface ProcessingStatusIconProps {
  item: ProcessingItem;
  className?: string;
  /** Dense rows: a settled `ready` item rests hidden until the row is hovered
   * (it needs no attention), while processing/failed/queued stay visible. The
   * parent row must carry `tw-group`. */
  revealReadyOnHover?: boolean;
  /** Wrap the glyph in a tooltip showing the label (or the error when failed).
   * Off for surfaces that already render the label as adjacent text. */
  tooltip?: boolean;
}

/** The shared per-item status glyph. */
export function ProcessingStatusIcon({
  item,
  className,
  revealReadyOnHover = false,
  tooltip = true,
}: ProcessingStatusIconProps) {
  const restsHidden = revealReadyOnHover && item.status === "ready" && !item.contentEmpty;
  const glyph = (
    <span
      className={cn(
        "tw-flex tw-size-5 tw-shrink-0 tw-items-center tw-justify-center",
        restsHidden && "tw-opacity-0 group-hover:tw-opacity-100",
        className
      )}
    >
      <ProcessingStatusGlyph item={item} />
    </span>
  );
  if (!tooltip) return glyph;

  const label =
    item.status === "failed" && item.error
      ? `Failed: ${item.error}`
      : getProcessingStatusLabel(item.status, item.contentEmpty);
  return (
    <HelpTooltip
      side="top"
      contentClassName="tw-z-[60]"
      content={<div className="tw-max-w-80">{label}</div>}
    >
      {glyph}
    </HelpTooltip>
  );
}
