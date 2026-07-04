import type { ProjectConfig } from "@/aiParams";
import { AddUrlPopover } from "@/components/project/AddUrlPopover";
import { ContextChip } from "@/components/project/ContextChip";
import { buildBadgeItems, removePattern } from "@/components/project/ProjectContextBadgeList";
import { UrlTypeIcon } from "@/components/project/UrlTypeIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseProjectUrls, serializeProjectUrls, type UrlItem } from "@/utils/urlTagUtils";
import { FileText, Folder, Hash, Inbox, Settings, Tag } from "lucide-react";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

type ContextSource = NonNullable<ProjectConfig["contextSource"]>;

interface ProjectContextSourceEditorProps {
  contextSource: ProjectConfig["contextSource"] | undefined;
  /** Apply a partial context-source patch (a chip delete / URL add). The caller
   * decides persistence: the home section persists immediately, the Edit modal
   * folds it into its draft. */
  onChange: (patch: Partial<ContextSource>) => void;
  /** Open the full Manage modal. */
  onManage: () => void;
  /** Portal target for the footer +URL popover. Pass the host modal's `contentEl`
   * (Edit project) so it stacks above the modal; omit on the home shelf (body). */
  popoverContainer?: HTMLElement | null;
  /** Drag is hovering this editor's drop zone (owned by the caller). */
  isDragging?: boolean;
  /** Whether this placement accepts drag-and-drop (the home shelf does; the Edit
   * modal can't). When false the drag hints are hidden — only +URL / Manage show. */
  droppable?: boolean;
  /** Render Manage as the solid CTA button (Edit Project) rather than the home
   * shelf's plain text link. Both open the same Manage modal. */
  solidManageButton?: boolean;
  /** Extra classes for the outer box (e.g. `tw-grow` to fill the home shelf floor). */
  className?: string;
  /** Render the two-line helper description above the box. On (Edit project) so
   * the modal keeps the old sub-cards' guidance; off on the compact home tab,
   * whose height is tuned to match its sibling tabs and shouldn't grow. */
  showHelperText?: boolean;
}

const FILE_CHIP_CONFIG = {
  folder: { Icon: Folder, colorClass: "tw-text-context-manager-yellow" },
  tag: { Icon: Tag, colorClass: "tw-text-context-manager-orange" },
  note: { Icon: FileText, colorClass: "tw-text-context-manager-blue" },
  extension: { Icon: Hash, colorClass: "tw-text-context-manager-green" },
} as const;

/**
 * The shared, controlled mixed file+URL context editor (design H / E). Renders
 * inclusions (folder/tag/file/extension via {@link buildBadgeItems}) and URLs
 * (via {@link parseProjectUrls}) as one wrapped {@link ContextChip} flow that
 * fills the box and scrolls internally when it overflows, then a footer pinned at
 * the box floor (drag hint · +URL · Manage). Pure / controlled: deletes and the
 * +URL action go out through `onChange` as
 * context-source patches, so the home placement can persist immediately while
 * the Edit modal keeps them in a draft.
 *
 * Reuses the pattern pure-functions from ProjectContextBadgeList but NOT its
 * pill rendering — the design's chips are square bordered tiles, and that
 * component is shared with the legacy CAG modal whose look must not change.
 */
export function ProjectContextSourceEditor({
  contextSource,
  onChange,
  onManage,
  popoverContainer,
  isDragging,
  droppable = true,
  solidManageButton = false,
  className,
  showHelperText = false,
}: ProjectContextSourceEditorProps) {
  const inclusions = contextSource?.inclusions;
  const exclusions = contextSource?.exclusions;

  const fileItems = useMemo(() => buildBadgeItems(inclusions), [inclusions]);
  const exclusionItems = useMemo(() => buildBadgeItems(exclusions), [exclusions]);
  const urlItems = useMemo(
    () => parseProjectUrls(contextSource?.webUrls ?? "", contextSource?.youtubeUrls ?? ""),
    [contextSource?.webUrls, contextSource?.youtubeUrls]
  );

  const totalCount = fileItems.length + urlItems.length + exclusionItems.length;
  const isEmpty = totalCount === 0;

  const handleRemoveFile = (pattern: string, type: (typeof fileItems)[number]["type"]) => {
    onChange({ inclusions: removePattern(inclusions, pattern, type) });
  };

  const handleRemoveExclusion = (
    pattern: string,
    type: (typeof exclusionItems)[number]["type"]
  ) => {
    onChange({ exclusions: removePattern(exclusions, pattern, type) });
  };

  const handleRemoveUrl = (id: string) => {
    const remaining: UrlItem[] = urlItems.filter((u) => u.id !== id);
    const { webUrls, youtubeUrls } = serializeProjectUrls(remaining);
    onChange({ webUrls, youtubeUrls });
  };

  const handleAddUrls = (added: UrlItem[]) => {
    const { webUrls, youtubeUrls } = serializeProjectUrls([...urlItems, ...added]);
    onChange({ webUrls, youtubeUrls });
  };

  // The chip flow fills the box and scrolls internally when it overflows; the box's
  // own min/max-height (see the wrapper below) bounds it so the footer stays pinned
  // at the box floor and a long context never grows the surrounding tab.
  const [overflowing, setOverflowing] = useState(false);
  // Whether the scroll container is at its bottom — drives the fade so "there's more
  // below" stays signalled until you've scrolled to the end.
  const [scrollAtBottom, setScrollAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
      setScrollAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 2);
    };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fileItems, urlItems, exclusionItems]);

  const showBottomFade = overflowing && !scrollAtBottom;

  const chips = (
    <>
      {fileItems.map((item) => {
        const { Icon, colorClass } = FILE_CHIP_CONFIG[item.type];
        return (
          <ContextChip
            key={`file:${item.type}:${item.pattern}`}
            icon={<Icon className="tw-size-3.5" />}
            colorClass={colorClass}
            label={item.pattern}
            onRemove={() => handleRemoveFile(item.pattern, item.type)}
          />
        );
      })}
      {urlItems.map((item) => (
        <ContextChip
          key={item.id}
          // UrlTypeIcon owns both glyph and color (the single source of truth for
          // web=cyan / youtube=red), so the chip wrapper carries no colorClass.
          icon={<UrlTypeIcon type={item.type} className="tw-size-3.5" />}
          colorClass=""
          label={item.url.replace(/^https?:\/\//, "")}
          tooltip={item.url}
          onRemove={() => handleRemoveUrl(item.id)}
        />
      ))}
    </>
  );

  // Excluded patterns render dim, after a dashed separator + "Excluded:" label —
  // mirroring the legacy ProjectContextBadgeList so the two read consistently.
  const exclusionChips = exclusionItems.map((item) => {
    const { Icon, colorClass } = FILE_CHIP_CONFIG[item.type];
    return (
      <ContextChip
        key={`ex:${item.type}:${item.pattern}`}
        icon={<Icon className="tw-size-3.5" />}
        colorClass={colorClass}
        label={item.pattern}
        dim
        onRemove={() => handleRemoveExclusion(item.pattern, item.type)}
      />
    );
  });

  const editorBox = (
    <div
      className={cn(
        // min/max keep the box ≈ one shelf-tab tall (the home Recent Chats / project
        // tabs land near the `SHELF_BODY_FLOOR_CLASS` floor at ~200px), so the
        // Context tab matches its siblings instead of growing with the chip count;
        // a long context scrolls inside the box. The caller's `tw-grow` fills up to
        // this cap.
        "tw-flex tw-max-h-60 tw-min-h-[200px] tw-flex-col tw-rounded-xl tw-border tw-p-3 tw-transition-colors",
        isDragging
          ? "tw-border-solid tw-border-interactive-accent"
          : "tw-border-dashed tw-border-border",
        className
      )}
    >
      {/* Content region — flex-1 pushes the footer to the box floor in every state
          (empty / sparse / full). The box's height bound comes from the caller.
          tw-relative anchors the drag scrim below. */}
      <div className="tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
        {isEmpty ? (
          <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-gap-1 tw-py-8 tw-text-center">
            <Inbox
              className={cn("tw-mb-1 tw-size-6", isDragging ? "tw-text-accent" : "tw-text-muted")}
            />
            <div
              className={cn(
                "tw-text-sm",
                isDragging ? "tw-font-medium tw-text-accent" : "tw-text-normal"
              )}
            >
              {droppable
                ? isDragging
                  ? "Drop to add to context"
                  : "Drag files / folders here"
                : "No context yet"}
            </div>
            <div className="tw-text-xs tw-text-muted">
              {droppable ? "or use Manage to add inclusion / tag / URL" : "Add via + URL or Manage"}
            </div>
          </div>
        ) : (
          <div className="tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                setScrollAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 2);
              }}
              className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto"
            >
              <div className="tw-flex tw-flex-wrap tw-gap-2">{chips}</div>
              {exclusionItems.length > 0 && (
                <>
                  {(fileItems.length > 0 || urlItems.length > 0) && (
                    <div className="tw-my-2 tw-border-t tw-border-dashed tw-border-border" />
                  )}
                  <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
                    <span className="tw-mr-1 tw-text-xs tw-font-medium tw-text-muted">
                      Excluded:
                    </span>
                    {exclusionChips}
                  </div>
                </>
              )}
            </div>
            {showBottomFade && (
              <div className="copilot-fade-mask-bottom tw-pointer-events-none tw-absolute tw-inset-x-0 tw-bottom-0 tw-h-8 tw-rounded-b-md" />
            )}
          </div>
        )}
        {/* Drag scrim: dims the populated chips in place (no layout jump) and
            floats the drop prompt over them. As the content region's LAST
            positioned child it paints above the chips with no z-index (matching
            the legacy dropzone). pointer-events-none so the drag keeps hitting
            the droppable box underneath; the empty state has its OWN "Drop"
            affordance, so the scrim only covers a non-empty chip flow. */}
        {droppable && !isEmpty && (
          <div
            aria-hidden={!isDragging}
            className={cn(
              "tw-pointer-events-none tw-absolute tw-inset-0 tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-1 tw-rounded-md tw-transition-opacity tw-duration-150 motion-reduce:tw-transition-none",
              isDragging ? "tw-opacity-100" : "tw-opacity-0"
            )}
          >
            {/* Two stacked fills: a translucent primary layer dims the chips, an
                interactive-accent tint signals "active target". */}
            <div className="tw-absolute tw-inset-0 tw-rounded-md tw-bg-primary tw-opacity-80" />
            <div className="tw-absolute tw-inset-0 tw-rounded-md tw-bg-interactive-accent/10" />
            <Inbox className="tw-relative tw-size-5 tw-text-accent" />
            <div className="tw-relative tw-text-sm tw-font-medium tw-text-accent">
              Drop to add to context
            </div>
            <div className="tw-relative tw-text-xs tw-text-muted">Added as an inclusion</div>
          </div>
        )}
      </div>

      {/* Footer (design `.ctxfoot`): left = drag hint + URL, right = Manage. Same
          shape in every state so the box reads consistently empty or full. */}
      <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-text-xs tw-text-faint">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-3">
          {droppable ? (
            <div
              className={cn(
                "tw-flex tw-min-w-0 tw-items-center tw-gap-1.5",
                isDragging && "tw-font-medium tw-text-accent"
              )}
            >
              <Inbox className="tw-size-3.5 tw-shrink-0" />
              <span className="tw-truncate">
                {isDragging ? "Drop to add to context" : "Drag files / folders here"}
              </span>
            </div>
          ) : (
            <span className="tw-truncate">Add a web / YouTube link</span>
          )}
          <AddUrlPopover
            existingUrls={urlItems.map((u) => u.url)}
            onAdd={handleAddUrls}
            container={popoverContainer}
          />
        </div>
        <div className="tw-ml-auto tw-flex tw-shrink-0 tw-items-center">
          {solidManageButton ? (
            <Button size="sm" className="tw-gap-1.5" onClick={onManage}>
              <Settings className="tw-size-3.5" />
              Manage Context
            </Button>
          ) : (
            <Button
              variant="ghost2"
              size="sm"
              className="tw-h-auto tw-gap-1.5 tw-px-0 tw-text-muted hover:tw-text-normal"
              onClick={onManage}
            >
              <Settings className="tw-size-3.5" />
              Manage
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  if (!showHelperText) return editorBox;
  // Edit project: restore the old split sub-cards' guidance above the unified box.
  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <div className="tw-text-sm tw-text-muted">
        Define patterns to include specific files, folders or tags in the project context. You can
        also add web pages or YouTube videos.
      </div>
      {editorBox}
    </div>
  );
}
