import type { ProcessingItem } from "@/components/project/processingAdapter";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Clock, HelpCircle, Loader2 } from "lucide-react";
import React from "react";

export function processingSourceKey(kind: ProcessingItem["cacheKind"], id: string): string {
  return `${kind}:${id}`;
}

export function processingItemKey(item: ProcessingItem): string {
  return processingSourceKey(item.cacheKind, item.id);
}

export function buildProcessingItemLookup(
  items: readonly ProcessingItem[]
): ReadonlyMap<string, ProcessingItem> {
  const map = new Map<string, ProcessingItem>();
  for (const item of items) map.set(processingItemKey(item), item);
  return map;
}

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
  revealReadyOnHover?: boolean;
  tooltip?: boolean;
}

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
