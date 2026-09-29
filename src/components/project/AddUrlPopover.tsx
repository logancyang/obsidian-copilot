import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UrlInputRow } from "@/components/project/UrlInputRow";
import { UrlTypeIcon } from "@/components/project/UrlTypeIcon";
import { cn } from "@/lib/utils";
import { createUrlItem, normalizeUrl, resolveInputUrls, type UrlItem } from "@/utils/urlTagUtils";
import { Link, Plus, X } from "lucide-react";
import React, { useMemo, useState } from "react";

interface AddUrlPopoverProps {
  existingUrls: string[];
  onAdd: (urls: UrlItem[]) => void;
  container?: HTMLElement | null;
  trigger?: React.ReactNode;
}

interface PendingUrl {
  item: UrlItem;
  duplicate: boolean;
}

export function AddUrlPopover({ existingUrls, onAdd, container, trigger }: AddUrlPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingUrl[]>([]);

  const existingSet = useMemo(() => new Set(existingUrls.map(normalizeUrl)), [existingUrls]);

  const validCount = pending.reduce((n, p) => (p.duplicate ? n : n + 1), 0);
  const dupCount = pending.length - validCount;

  const stageFromText = (text: string) => {
    const parsed = resolveInputUrls(text);
    if (parsed.length === 0) return;
    setPending((prev) => {
      const staged = new Set(prev.map((p) => p.item.url));
      const additions: PendingUrl[] = [];
      for (const raw of parsed) {
        const item = createUrlItem(raw);
        if (staged.has(item.url)) continue;
        staged.add(item.url);
        additions.push({ item, duplicate: existingSet.has(item.url) });
      }
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  };

  const resetAndClose = () => {
    setPending([]);
    setOpen(false);
  };

  const commit = () => {
    const valid = pending.filter((p) => !p.duplicate).map((p) => p.item);
    if (valid.length === 0) return;
    onAdd(valid);
    resetAndClose();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPending([]);
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost2"
            size="sm"
            className="tw-h-auto tw-gap-1 tw-px-0 tw-text-context-manager-cyan hover:tw-text-context-manager-cyan"
          >
            <Plus className="tw-size-3.5" />
            URL
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" container={container} className="tw-w-80 tw-p-0">
        <div className="tw-flex tw-items-center tw-gap-2 tw-border-x-0 tw-border-b tw-border-t-0 tw-border-solid tw-border-border tw-px-3.5 tw-pb-2.5 tw-pt-3 tw-text-sm tw-font-semibold tw-text-normal">
          <Link className="tw-size-3.5" />
          Add URLs
          <Button
            variant="ghost2"
            size="icon"
            aria-label="Close"
            onClick={resetAndClose}
            className="tw-ml-auto"
          >
            <X className="tw-size-3.5" />
          </Button>
        </div>

        <div className="tw-flex tw-flex-col tw-gap-2 tw-px-3.5 tw-py-3">
          <UrlInputRow autoFocus onSubmit={stageFromText} placeholder="Enter a URL…" />

          <div className="tw-flex tw-h-28 tw-flex-col tw-gap-1.5 tw-overflow-y-auto">
            {pending.length === 0 ? (
              <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-gap-1 tw-text-center tw-text-xs tw-text-faint">
                <Link className="tw-mb-1 tw-size-5" />
                No URLs queued yet — type or paste above
              </div>
            ) : (
              pending.map(({ item, duplicate }) => (
                <div
                  key={item.id}
                  className={cn(
                    "tw-flex tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-px-2.5 tw-py-1.5 tw-text-sm",
                    duplicate ? "tw-border-error tw-bg-error/10" : "tw-border-border"
                  )}
                >
                  <UrlTypeIcon type={item.type} className="tw-size-3.5 tw-shrink-0" />
                  <span
                    className={cn(
                      "tw-min-w-0 tw-flex-1 tw-truncate",
                      duplicate ? "tw-text-error" : "tw-text-normal"
                    )}
                    title={item.url}
                  >
                    {item.url.replace(/^https?:\/\//, "")}
                  </span>
                  {duplicate && (
                    <span className="tw-shrink-0 tw-rounded tw-border tw-border-solid tw-border-error tw-px-1 tw-font-mono tw-text-ui-smaller tw-text-error">
                      Exists
                    </span>
                  )}
                  <Button
                    variant="ghost2"
                    size="icon"
                    aria-label="Remove"
                    className="tw-shrink-0"
                    onClick={() => setPending((prev) => prev.filter((p) => p.item.id !== item.id))}
                  >
                    <X className="tw-size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="tw-flex tw-items-center tw-gap-2 tw-border-x-0 tw-border-b-0 tw-border-t tw-border-solid tw-border-border tw-px-3.5 tw-py-2.5">
          <span className="tw-text-xs tw-text-faint">
            {validCount} to add
            {dupCount > 0 && ` · ${dupCount} exist`}
          </span>
          <div className="tw-ml-auto tw-flex tw-gap-2">
            <Button variant="ghost" size="sm" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={validCount === 0} onClick={commit}>
              Add{validCount > 0 ? ` ${validCount}` : ""}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
