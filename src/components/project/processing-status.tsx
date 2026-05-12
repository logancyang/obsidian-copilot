/**
 * Content conversion status panel for project context.
 *
 * Shows non-markdown files and URLs that need conversion,
 * grouped by source (Files vs URLs). Supports retry for failed items.
 * Adapted from the prototype's ProcessingStatus component.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { TruncatedText } from "@/components/TruncatedText";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ArrowUpRight,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  Globe,
  HelpCircle,
  Loader2,
  RefreshCw,
  X,
  Youtube,
} from "lucide-react";
import React, { useCallback, useRef, useState } from "react";

interface ProcessingStatusProps {
  items: ProcessingItem[];
  /** Optional: only provided for the currently active project. */
  onRetry?: (id: string) => void;
  /** Optional: callback to open a cached item's parsed content (file or URL). */
  onOpenCachedItem?: (item: ProcessingItem) => void;
  /** Optional: callback to remove a failed URL from the project config. */
  onRemoveUrl?: (item: ProcessingItem) => void;
  defaultExpanded?: boolean;
  maxHeight?: string;
  /** When false, hides the title and description. Use for embedding inside another panel. */
  showHeader?: boolean;
}

/**
 * Renders the status icon for a ProcessingItem.
 * For ready+contentEmpty items, shows a warning HelpCircle instead of a green checkmark.
 */
function StatusIcon({
  status,
  contentEmpty,
}: {
  status: ProcessingItem["status"];
  contentEmpty?: boolean;
}) {
  // Reason: contentEmpty is a sub-state of "ready" — item was fetched but had no extractable content.
  if (status === "ready" && contentEmpty) {
    return <HelpCircle className="tw-size-3.5 tw-text-warning" />;
  }

  switch (status) {
    case "ready":
      return <CheckCircle2 className="tw-size-3.5 tw-text-success" />;
    case "processing":
      return <Loader2 className="tw-size-3.5 tw-animate-spin tw-text-loading" />;
    case "failed":
      return <AlertCircle className="tw-size-3.5 tw-text-error" />;
    case "pending":
      return <Clock className="tw-size-3.5 tw-text-muted" />;
    case "unsupported":
      return <HelpCircle className="tw-size-3.5 tw-text-muted" />;
  }
}

function FileTypeIcon({ fileType }: { fileType: ProcessingItem["fileType"] }) {
  switch (fileType) {
    case "pdf":
      return <FileText className="tw-size-3.5 tw-text-error" />;
    case "image":
      return <FileImage className="tw-size-3.5 tw-text-accent" />;
    case "web":
      return <Globe className="tw-size-3.5 tw-text-accent" />;
    case "youtube":
      return <Youtube className="tw-size-3.5 tw-text-error" />;
    case "audio":
      return <FileVideo className="tw-size-3.5 tw-text-warning" />;
    default:
      return <FileText className="tw-size-3.5 tw-text-muted" />;
  }
}

/** Returns counts for each status category, including unsupported. */
function getStatusCounts(items: ProcessingItem[]) {
  return {
    ready: items.filter((i) => i.status === "ready").length,
    processing: items.filter((i) => i.status === "processing").length,
    failed: items.filter((i) => i.status === "failed").length,
    pending: items.filter((i) => i.status === "pending").length,
    unsupported: items.filter((i) => i.status === "unsupported").length,
    total: items.length,
  };
}

/**
 * Returns the human-readable label for a given status.
 * For ready+contentEmpty items the caller should override to "No content".
 */
function getStatusLabel(status: ProcessingItem["status"], contentEmpty?: boolean): string {
  // Reason: "No content" is a UI-only distinction within the "ready" status.
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

/** Status priority for sorting: active/problematic items first, completed last. */
const STATUS_SORT_PRIORITY: Record<ProcessingItem["status"], number> = {
  processing: 0,
  failed: 1,
  pending: 2,
  unsupported: 3,
  ready: 4,
};

/** Sort items by status priority. Same-status items retain their original relative order. */
function sortByStatusPriority(items: ProcessingItem[]): ProcessingItem[] {
  return [...items].sort(
    (a, b) => (STATUS_SORT_PRIORITY[a.status] ?? 99) - (STATUS_SORT_PRIORITY[b.status] ?? 99)
  );
}

export function ProcessingStatus({
  items,
  onRetry,
  onOpenCachedItem,
  onRemoveUrl,
  defaultExpanded = false,
  maxHeight,
  showHeader = true,
}: ProcessingStatusProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const counts = getStatusCounts(items);

  const sortedFileItems = sortByStatusPriority(items.filter((i) => i.source === "file"));
  const sortedUrlItems = sortByStatusPriority(items.filter((i) => i.source === "url"));

  return (
    <div className="tw-space-y-2">
      {/* Title Row — hidden when embedded inside another panel */}
      {showHeader && (
        <div className="tw-space-y-1">
          <div className="tw-flex tw-items-center tw-gap-2">
            <h4 className="tw-text-sm tw-font-medium tw-text-normal">Content Conversion</h4>
          </div>
          <p className="tw-text-ui-smaller tw-text-muted">
            Non-markdown files (PDF, images, web pages, ...) are converted to text for AI.
          </p>
        </div>
      )}

      {/* Empty state when no non-markdown files or URLs exist */}
      {items.length === 0 && (
        <div className="tw-rounded-lg tw-border tw-border-border tw-p-3 tw-bg-muted/10">
          <div className="tw-text-ui-smaller tw-text-muted">
            No non-markdown files or URLs need conversion for this project.
          </div>
        </div>
      )}

      {/* Status Panel — only when there are items to show */}
      {items.length > 0 && (
        <div className="tw-rounded-lg tw-border tw-border-border">
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            {/* Summary Bar */}
            <CollapsibleTrigger asChild>
              <Button
                variant="secondary"
                className=" tw-flex tw-h-auto tw-w-full tw-items-center tw-justify-between tw-rounded-lg tw-p-3 tw-text-left tw-transition-colors hover:tw-bg-modifier-hover"
              >
                <div className="tw-flex tw-items-center tw-gap-2">
                  <div className="tw-flex tw-items-center tw-gap-1.5">
                    {counts.ready > 0 && (
                      <Badge
                        variant="secondary"
                        className="tw-h-5 tw-gap-1 tw-bg-success tw-px-1.5 tw-text-ui-smaller tw-text-success"
                      >
                        <CheckCircle2 className="tw-size-3" />
                        {counts.ready}
                      </Badge>
                    )}
                    {counts.processing > 0 && (
                      <Badge
                        variant="secondary"
                        className="tw-h-5 tw-gap-1 tw-px-1.5 tw-text-ui-smaller"
                      >
                        <Loader2 className="tw-size-3 tw-animate-spin" />
                        {counts.processing}
                      </Badge>
                    )}
                    {counts.pending > 0 && (
                      <Badge
                        variant="secondary"
                        className="tw-h-5 tw-gap-1 tw-px-1.5 tw-text-ui-smaller"
                      >
                        <Clock className="tw-size-3" />
                        {counts.pending}
                      </Badge>
                    )}
                    {counts.failed > 0 && (
                      <Badge
                        variant="secondary"
                        className="tw-h-5 tw-gap-1 tw-bg-error tw-px-1.5 tw-text-ui-smaller tw-text-error"
                      >
                        <AlertCircle className="tw-size-3" />
                        {counts.failed}
                      </Badge>
                    )}
                    {/* Reason: unsupported items get a neutral gray badge to distinguish
                        them from errors — they're not failures, just unprocessable file types. */}
                    {counts.unsupported > 0 && (
                      <Badge
                        variant="secondary"
                        className="tw-h-5 tw-gap-1 tw-px-1.5 tw-text-ui-smaller tw-text-muted"
                      >
                        <HelpCircle className="tw-size-3" />
                        {counts.unsupported}
                      </Badge>
                    )}
                  </div>
                  <span className="tw-text-ui-smaller tw-text-muted">{counts.total} items</span>
                </div>
                {isExpanded ? (
                  <ChevronDown className="tw-size-4 tw-text-muted" />
                ) : (
                  <ChevronRight className="tw-size-4 tw-text-muted" />
                )}
              </Button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              {/* Reason: each section scrolls independently so files don't push URLs out of view */}
              <div className="tw-space-y-3 tw-border-t tw-border-border tw-p-3">
                {/* From Files Section */}
                {sortedFileItems.length > 0 && (
                  <div className="tw-space-y-2">
                    <div className="tw-flex tw-items-center tw-gap-1.5 tw-px-1">
                      <FolderOpen className="tw-size-3.5 tw-text-accent" />
                      <span className="tw-text-ui-smaller tw-font-medium tw-text-muted">
                        From Files ({sortedFileItems.length})
                      </span>
                    </div>
                    <ScrollableList maxHeight={maxHeight || "200px"}>
                      {sortedFileItems.map((item) => (
                        <ProcessingItemRow
                          key={item.id}
                          item={item}
                          onRetry={onRetry}
                          onOpenCached={onOpenCachedItem ? () => onOpenCachedItem(item) : undefined}
                        />
                      ))}
                    </ScrollableList>
                  </div>
                )}

                {/* From URLs Section */}
                {sortedUrlItems.length > 0 && (
                  <div className="tw-space-y-2">
                    <div className="tw-flex tw-items-center tw-gap-1.5 tw-px-1">
                      <Globe className="tw-size-3.5 tw-text-accent" />
                      <span className="tw-text-ui-smaller tw-font-medium tw-text-muted">
                        From URLs ({sortedUrlItems.length})
                      </span>
                    </div>
                    <ScrollableList maxHeight={maxHeight || "200px"}>
                      {sortedUrlItems.map((item) => (
                        <ProcessingItemRow
                          key={item.id}
                          item={item}
                          onRetry={onRetry}
                          onOpenCached={onOpenCachedItem ? () => onOpenCachedItem(item) : undefined}
                          onRemove={onRemoveUrl ? () => onRemoveUrl(item) : undefined}
                        />
                      ))}
                    </ScrollableList>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
}

/**
 * Scroll container with a bottom fade mask when content overflows.
 * Reuses the existing `.copilot-fade-mask-bottom` CSS class from PatternListEditor.
 */
function ScrollableList({ maxHeight, children }: { maxHeight: string; children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const checkOverflow = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (el) {
      setIsOverflowing(el.scrollHeight > el.clientHeight);
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Reason: hide fade mask when scrolled to bottom
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    setIsOverflowing(!atBottom);
  }, []);

  return (
    <div className="tw-relative">
      <div
        ref={checkOverflow}
        className="tw-space-y-1 tw-overflow-y-auto"
        style={{ maxHeight }}
        onScroll={handleScroll}
      >
        {children}
      </div>
      {isOverflowing && (
        <div className="copilot-fade-mask-bottom tw-pointer-events-none tw-absolute tw-inset-x-0 tw-bottom-0 tw-h-8 tw-rounded-b-md" />
      )}
    </div>
  );
}

function ProcessingItemRow({
  item,
  onRetry,
  onOpenCached,
  onRemove,
}: {
  item: ProcessingItem;
  onRetry?: (id: string) => void;
  /** Callback to open the cached parsed content for this file item. */
  onOpenCached?: () => void;
  /** Callback to remove this URL from the project config. Only for URL items. */
  onRemove?: () => void;
}) {
  const isProcessing = item.status === "processing";
  const isFailed = item.status === "failed";
  // Reason: show open button for any item that is ready with actual content (file or URL)
  const canOpenCached = onOpenCached && item.status === "ready" && !item.contentEmpty;

  return (
    <div className="tw-group tw-rounded-md tw-border tw-border-border tw-bg-primary tw-p-2.5">
      <div className="tw-flex tw-items-center tw-gap-2">
        <FileTypeIcon fileType={item.fileType} />
        <div className="tw-min-w-0 tw-flex-1">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
            <TruncatedText className="tw-text-sm tw-text-normal">
              {item.source === "url" ? item.id : item.name}
            </TruncatedText>
            <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1.5">
              {canOpenCached && (
                <Button
                  variant="ghost2"
                  size="icon"
                  aria-label="View Parsed Content"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCached();
                  }}
                  title="View Parsed Content"
                  className="tw-size-5"
                >
                  <ArrowUpRight className="tw-size-4" />
                </Button>
              )}
              {/* Reason: ready items only show the checkmark icon, no text label —
                  the icon is sufficient and saves horizontal space for the name.
                  Exception: contentEmpty items need a visible "No content" label. */}
              {(item.status !== "ready" || item.contentEmpty) && (
                <span className="tw-text-ui-smaller tw-text-muted">
                  {getStatusLabel(item.status, item.contentEmpty)}
                </span>
              )}
              <StatusIcon status={item.status} contentEmpty={item.contentEmpty} />
            </div>
          </div>
        </div>
      </div>

      {/* Progress bar for processing items */}
      {isProcessing && item.progress !== undefined && (
        <div className="tw-mt-2 tw-flex tw-items-center tw-gap-2">
          <Progress value={item.progress} className="tw-h-1.5 tw-flex-1" />
          <span className="tw-w-8 tw-text-ui-smaller tw-text-muted">{item.progress}%</span>
        </div>
      )}

      {/* Error row for failed items:
          - Retry icon only when onRetry is provided (i.e. active project).
          - Remove icon only when onRemove is provided (URL items only).
          - Non-active projects display the error text without actions. */}
      {isFailed && (
        <div className="tw-mt-2 tw-flex tw-items-center tw-justify-between">
          <TruncatedText className="tw-flex-1 tw-text-ui-smaller tw-text-error">
            {item.error || "Conversion failed"}
          </TruncatedText>
          <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1">
            {onRetry && (
              <Button
                variant="ghost2"
                size="icon"
                aria-label="Retry"
                onClick={() => onRetry(item.id)}
                title="Retry"
                className="tw-size-5 tw-text-muted hover:tw-text-accent"
              >
                <RefreshCw className="tw-size-3.5" />
              </Button>
            )}
            {onRemove && (
              <Button
                variant="ghost2"
                size="icon"
                aria-label="Remove URL from project"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Remove URL from project"
                className="tw-size-5 tw-text-muted hover:tw-text-error"
              >
                <X className="tw-size-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
