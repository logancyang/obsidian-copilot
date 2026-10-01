import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TruncatedText } from "@/components/TruncatedText";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import {
  getProcessingStatusLabel,
  processingItemKey,
  ProcessingStatusIcon,
} from "@/components/project/processingItemStatusView";
import {
  ArrowUpRight,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  Globe,
  RefreshCw,
} from "lucide-react";
import React, { useCallback, useRef, useState } from "react";

interface ProcessingStatusProps {
  items: ProcessingItem[];
  onOpenCachedItem?: (item: ProcessingItem) => void;
  maxHeight?: string;
  onRetryItem?: (item: ProcessingItem) => void;
  skippedMarkdownCount?: number;
}

function FileTypeIcon({ fileType }: { fileType: ProcessingItem["fileType"] }) {
  switch (fileType) {
    case "pdf":
      return <FileText className="tw-size-3.5 tw-text-error" />;
    case "image":
      return <FileImage className="tw-size-3.5 tw-text-accent" />;
    case "web":
    case "youtube":
      return <Globe className="tw-size-3.5 tw-text-accent" />;
    case "audio":
      return <FileVideo className="tw-size-3.5 tw-text-warning" />;
    default:
      return <FileText className="tw-size-3.5 tw-text-muted" />;
  }
}

const STATUS_SORT_PRIORITY: Record<ProcessingItem["status"], number> = {
  processing: 0,
  failed: 1,
  pending: 2,
  unsupported: 3,
  ready: 4,
};

function sortByStatusPriority(items: ProcessingItem[]): ProcessingItem[] {
  return [...items].sort(
    (a, b) => (STATUS_SORT_PRIORITY[a.status] ?? 99) - (STATUS_SORT_PRIORITY[b.status] ?? 99)
  );
}

export function ProcessingStatus({
  items,
  onOpenCachedItem,
  maxHeight,
  onRetryItem,
  skippedMarkdownCount = 0,
}: ProcessingStatusProps) {
  const sortedFileItems = sortByStatusPriority(items.filter((i) => i.source === "file"));
  const sortedUrlItems = sortByStatusPriority(items.filter((i) => i.source === "url"));

  const groupsBody = (
    <div className="tw-space-y-3 tw-p-3">
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
                key={processingItemKey(item)}
                item={item}
                onRetryItem={onRetryItem}
                onOpenCached={onOpenCachedItem ? () => onOpenCachedItem(item) : undefined}
              />
            ))}
          </ScrollableList>
          {skippedMarkdownCount > 0 && (
            <div className="tw-px-1 tw-text-ui-smaller tw-text-faint">
              {skippedMarkdownCount} markdown {skippedMarkdownCount === 1 ? "file" : "files"} — no
              conversion needed
            </div>
          )}
        </div>
      )}

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
                key={processingItemKey(item)}
                item={item}
                onRetryItem={onRetryItem}
                onOpenCached={onOpenCachedItem ? () => onOpenCachedItem(item) : undefined}
              />
            ))}
          </ScrollableList>
        </div>
      )}
    </div>
  );

  return (
    <div className="tw-space-y-2">
      {items.length === 0 && (
        <div className="tw-rounded-lg tw-border tw-border-border tw-p-3 tw-bg-muted/10">
          <div className="tw-text-ui-smaller tw-text-muted">
            No non-markdown files or URLs need conversion for this project.
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="tw-rounded-lg tw-border tw-border-border">{groupsBody}</div>
      )}
    </div>
  );
}

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
  onRetryItem,
  onOpenCached,
}: {
  item: ProcessingItem;
  onRetryItem?: (item: ProcessingItem) => void;
  onOpenCached?: () => void;
}) {
  const isProcessing = item.status === "processing";
  const isFailed = item.status === "failed";
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
              {(item.status !== "ready" || item.contentEmpty) && (
                <span className="tw-text-ui-smaller tw-text-muted">
                  {getProcessingStatusLabel(item.status, item.contentEmpty)}
                </span>
              )}
              <ProcessingStatusIcon item={item} tooltip={false} />
            </div>
          </div>
        </div>
      </div>

      {isProcessing && item.progress !== undefined && (
        <div className="tw-mt-2 tw-flex tw-items-center tw-gap-2">
          <Progress value={item.progress} className="tw-h-1.5 tw-flex-1" />
          <span className="tw-w-8 tw-text-ui-smaller tw-text-muted">{item.progress}%</span>
        </div>
      )}

      {isFailed && (
        <div className="tw-mt-2 tw-flex tw-items-center tw-justify-between">
          <TruncatedText className="tw-flex-1 tw-text-ui-smaller tw-text-error">
            {item.error || "Conversion failed"}
          </TruncatedText>
          <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1">
            {onRetryItem && (
              <Button
                variant="ghost2"
                size="icon"
                aria-label="Retry"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryItem(item);
                }}
                title="Retry"
                className="tw-size-5 tw-text-muted hover:tw-text-accent"
              >
                <RefreshCw className="tw-size-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
