import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UrlInputRow } from "@/components/project/UrlInputRow";
import { UrlTypeIcon } from "@/components/project/UrlTypeIcon";
import { cn } from "@/lib/utils";
import { createUrlItem, normalizeUrl, resolveInputUrls, type UrlItem } from "@/utils/urlTagUtils";
import { Link, Plus, X } from "lucide-react";
import React, { useMemo, useState } from "react";

interface AddUrlPopoverProps {
  /** Existing URLs (raw or normalized) so already-added entries flag as duplicates. */
  existingUrls: string[];
  /** The deduped, non-duplicate URLs the user confirmed. The caller merges them. */
  onAdd: (urls: UrlItem[]) => void;
  /** Portal target. Pass the host modal's `contentEl` so the popover stacks
   * above it: the popover layer (30) sits below the modal layer (50), so a
   * body-portaled popover would render behind the Edit-project modal. */
  container?: HTMLElement | null;
  /** Custom trigger (e.g. the Manage sidebar's PlusCircle). Defaults to the
   * footer's cyan "+ URL" link. */
  trigger?: React.ReactNode;
}

/** A URL staged for adding, tagged with whether it already lives in the project's
 * context (a duplicate is shown but not committed). */
interface PendingUrl {
  item: UrlItem;
  duplicate: boolean;
}

/**
 * The "+ URL" control (design ⑤): a trigger opening a small popover that stages
 * URLs in a **pending list** before committing. The input's right-side button is
 * one control with two states — empty → paste from clipboard, non-empty → add
 * the typed value (Enter does the same) — and a paste anywhere routes straight
 * into the list. Each staged URL is auto-classified web/YouTube and deduped:
 * within the list it collapses, against the project's existing URLs it flags as
 * "Exists" and is excluded from the commit. "Add N" sends the valid items out
 * through `onAdd`; the caller merges them into its context source.
 *
 * A Popover, NOT a Modal, so it never stacks a second modal over the Edit-project
 * modal (see the agent layer rules' modal/dialog note). Parsing reuses the shared
 * {@link resolveInputUrls} (scheme-anchored extraction + single-token fallback),
 * so a pasted document can't smuggle bare-host prose tokens into the list.
 */
export function AddUrlPopover({ existingUrls, onAdd, container, trigger }: AddUrlPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingUrl[]>([]);

  const existingSet = useMemo(() => new Set(existingUrls.map(normalizeUrl)), [existingUrls]);

  const validCount = pending.reduce((n, p) => (p.duplicate ? n : n + 1), 0);
  const dupCount = pending.length - validCount;

  // Stage every URL parsed from `text`, skipping ones already staged and tagging
  // ones already in the project. The single source of truth for all three input
  // paths (Add button, Enter, paste).
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
        <div className="tw-flex tw-items-center tw-gap-2 tw-border-x-[0px] tw-border-b tw-border-t-[0px] tw-border-solid tw-border-border tw-px-3.5 tw-pb-2.5 tw-pt-3 tw-text-sm tw-font-semibold tw-text-normal">
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

          {/* Fixed height (not max-height): the popover's total height stays
              constant as items are staged, so Radix never re-flips it to dodge a
              growing box — which read as a jarring jump when opened from the
              Manage sidebar's tight top corner. */}
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
                  {/* The leading icon already conveys web/YouTube, so only the
                      duplicate case needs a label — "Exists" explains why it's
                      excluded from the commit. */}
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

        <div className="tw-flex tw-items-center tw-gap-2 tw-border-x-[0px] tw-border-b-[0px] tw-border-t tw-border-solid tw-border-border tw-px-3.5 tw-py-2.5">
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
