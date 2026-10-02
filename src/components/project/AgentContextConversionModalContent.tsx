import { ProcessingStatus } from "@/components/project/processing-status";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckCircle2, Inbox, Loader2, RotateCcw, SquarePen, XCircle } from "lucide-react";
import React, { useMemo, useState } from "react";

interface AgentContextConversionModalContentProps {
  items: ProcessingItem[];
  hasConfiguredContextSource: boolean;
  skippedMarkdownCount: number;
  onRetryItem: (item: ProcessingItem) => void;
  onRetryAll: () => void;
  onEditContext: () => void;
  onOpenCachedItem?: (item: ProcessingItem) => void;
}

type Filter = "all" | "failed" | "processing";

export function AgentContextConversionModalContent({
  items,
  hasConfiguredContextSource,
  skippedMarkdownCount,
  onRetryItem,
  onRetryAll,
  onEditContext,
  onOpenCachedItem,
}: AgentContextConversionModalContentProps) {
  const total = items.length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const inFlightCount = items.filter(
    (i) => i.status === "processing" || i.status === "pending"
  ).length;
  const doneCount = total - inFlightCount;
  const successRatio =
    total === 0 ? 0 : (items.filter((i) => i.status === "ready").length / total) * 100;
  const failedRatio = total === 0 ? 0 : (failedCount / total) * 100;
  const doneRatio = total === 0 ? 0 : (doneCount / total) * 100;

  const overall: "success" | "processing" | "failed" =
    inFlightCount > 0 ? "processing" : failedCount > 0 ? "failed" : "success";

  const [filter, setFilter] = useState<Filter>(() =>
    items.some((i) => i.status === "failed") ? "failed" : "all"
  );

  const effectiveFilter: Filter =
    (filter === "failed" && failedCount === 0) || (filter === "processing" && inFlightCount === 0)
      ? "all"
      : filter;

  const filteredItems = useMemo(() => {
    if (effectiveFilter === "failed") return items.filter((i) => i.status === "failed");
    if (effectiveFilter === "processing")
      return items.filter((i) => i.status === "processing" || i.status === "pending");
    return items;
  }, [items, effectiveFilter]);

  if (total === 0) {
    const hasConversionFreeContext = hasConfiguredContextSource || skippedMarkdownCount > 0;
    return (
      <div className="tw-flex tw-w-[368px] tw-max-w-full tw-flex-col">
        <div className="tw-flex tw-items-center tw-gap-2 tw-border-x-0 tw-border-b tw-border-t-0 tw-border-solid tw-border-border tw-px-3.5 tw-py-3 tw-text-sm tw-font-semibold tw-text-normal">
          {hasConversionFreeContext ? (
            <CheckCircle2 className="tw-size-4 tw-text-success" />
          ) : (
            <Inbox className="tw-size-4 tw-text-muted" />
          )}
          {hasConversionFreeContext ? "No conversion needed" : "No context loaded"}
        </div>
        <div className="tw-px-3.5 tw-py-6 tw-text-center tw-text-sm tw-text-muted">
          {hasConversionFreeContext ? (
            <>
              Context sources are configured and ready to use.
              {skippedMarkdownCount > 0 && (
                <div className="tw-mt-1 tw-text-xs tw-text-faint">
                  {skippedMarkdownCount} markdown {skippedMarkdownCount === 1 ? "file" : "files"} —
                  no conversion needed
                </div>
              )}
            </>
          ) : (
            "This project has no context sources yet."
          )}
        </div>
        <div className="tw-flex tw-justify-end tw-border-x-0 tw-border-b-0 tw-border-t tw-border-solid tw-border-border tw-px-3.5 tw-py-2.5">
          <Button
            variant="ghost"
            size="sm"
            className="tw-gap-1.5 tw-text-muted"
            onClick={onEditContext}
          >
            <SquarePen className="tw-size-3.5" />
            Edit context
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-min-h-0 tw-w-[368px] tw-max-w-full tw-flex-col">
      <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2 tw-border-x-0 tw-border-b tw-border-t-0 tw-border-solid tw-border-border tw-px-3.5 tw-py-3 tw-text-sm tw-font-semibold tw-text-normal">
        {overall === "success" && <CheckCircle2 className="tw-size-4 tw-text-success" />}
        {overall === "processing" && (
          <Loader2 className="tw-size-4 tw-animate-spin tw-text-accent" />
        )}
        {overall === "failed" && <XCircle className="tw-size-4 tw-text-error" />}
        <span>
          {overall === "success" && "Context ready"}
          {overall === "processing" && "Processing…"}
          {overall === "failed" && `${failedCount} failed`}
        </span>
        <span
          className={cn(
            "tw-ml-auto tw-font-mono tw-text-xs tw-font-medium",
            overall === "processing" ? "tw-text-accent" : "tw-text-faint"
          )}
        >
          {overall === "processing"
            ? `${doneCount} / ${total}`
            : `${total} ${overall === "failed" ? "total" : "items"}`}
        </span>
      </div>

      <div className="tw-flex tw-h-1 tw-w-full tw-shrink-0 tw-overflow-hidden tw-bg-secondary">
        {overall === "success" && <div className="tw-size-full tw-bg-success" />}
        {overall === "processing" && (
          <div
            className="tw-h-full tw-bg-interactive-accent tw-transition-all"
            style={{ width: `${doneRatio}%` }}
          />
        )}
        {overall === "failed" && (
          <>
            <div className="tw-h-full tw-bg-success" style={{ width: `${successRatio}%` }} />
            <div className="tw-h-full tw-bg-error" style={{ width: `${failedRatio}%` }} />
          </>
        )}
      </div>

      <div className="tw-flex tw-shrink-0 tw-gap-1.5 tw-px-3.5 tw-pb-1 tw-pt-2">
        <FilterChip
          label="All"
          active={effectiveFilter === "all"}
          onClick={() => setFilter("all")}
        />
        {failedCount > 0 && (
          <FilterChip
            label={`Failed (${failedCount})`}
            active={effectiveFilter === "failed"}
            onClick={() => setFilter("failed")}
          />
        )}
        {inFlightCount > 0 && (
          <FilterChip
            label="Processing"
            active={effectiveFilter === "processing"}
            onClick={() => setFilter("processing")}
          />
        )}
      </div>

      <div className="tw-max-h-[280px] tw-min-h-0 tw-overflow-y-auto tw-px-3.5 tw-pb-2 tw-pt-1">
        <ProcessingStatus
          items={filteredItems}
          onRetryItem={onRetryItem}
          skippedMarkdownCount={skippedMarkdownCount}
          maxHeight="none"
          onOpenCachedItem={onOpenCachedItem}
        />
      </div>

      <div className="tw-flex tw-shrink-0 tw-gap-1.5 tw-border-x-0 tw-border-b-0 tw-border-t tw-border-solid tw-border-border tw-px-3.5 tw-py-2.5">
        <Button variant="ghost" size="sm" className="tw-gap-1.5 tw-text-muted" onClick={onRetryAll}>
          <RotateCcw className="tw-size-3.5" />
          {failedCount > 0 ? "Retry failed" : "Retry all"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="tw-gap-1.5 tw-text-muted"
          onClick={onEditContext}
        >
          <SquarePen className="tw-size-3.5" />
          Edit context
        </Button>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost2"
      size="sm"
      className={cn(
        "tw-h-auto tw-rounded-full tw-bg-secondary tw-px-2.5 tw-py-0.5 tw-text-xs tw-font-medium tw-text-muted hover:tw-bg-secondary hover:tw-text-normal",
        active &&
          "tw-text-accent tw-bg-interactive-accent/10 hover:tw-text-accent hover:tw-bg-interactive-accent/10"
      )}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
