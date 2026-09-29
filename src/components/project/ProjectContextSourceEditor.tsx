import type { ProjectConfig } from "@/aiParams";
import { AddUrlPopover } from "@/components/project/AddUrlPopover";
import { ContextChip } from "@/components/project/ContextChip";
import {
  buildBadgeItems,
  getBadgeLabel,
  removePattern,
} from "@/components/project/ProjectContextBadgeList";
import { UrlTypeIcon } from "@/components/project/UrlTypeIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseProjectUrls, serializeProjectUrls, type UrlItem } from "@/utils/urlTagUtils";
import { FileText, Folder, Hash, Inbox, Settings, SlidersHorizontal, Tag } from "lucide-react";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

type ContextSource = NonNullable<ProjectConfig["contextSource"]>;

interface ProjectContextSourceEditorProps {
  contextSource: ProjectConfig["contextSource"] | undefined;
  onChange: (patch: Partial<ContextSource>) => void;
  onManage: () => void;
  popoverContainer?: HTMLElement | null;
  isDragging?: boolean;
  droppable?: boolean;
  solidManageButton?: boolean;
  className?: string;
  showHelperText?: boolean;
}

const FILE_CHIP_CONFIG = {
  folder: { Icon: Folder, colorClass: "tw-text-context-manager-yellow" },
  tag: { Icon: Tag, colorClass: "tw-text-context-manager-orange" },
  note: { Icon: FileText, colorClass: "tw-text-context-manager-blue" },
  extension: { Icon: Hash, colorClass: "tw-text-context-manager-green" },
  property: { Icon: SlidersHorizontal, colorClass: "tw-text-context-manager-purple" },
} as const;

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

  const [overflowing, setOverflowing] = useState(false);
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
            label={getBadgeLabel(item)}
            onRemove={() => handleRemoveFile(item.pattern, item.type)}
          />
        );
      })}
      {urlItems.map((item) => (
        <ContextChip
          key={item.id}
          icon={<UrlTypeIcon type={item.type} className="tw-size-3.5" />}
          colorClass=""
          label={item.url.replace(/^https?:\/\//, "")}
          tooltip={item.url}
          onRemove={() => handleRemoveUrl(item.id)}
        />
      ))}
    </>
  );

  const exclusionChips = exclusionItems.map((item) => {
    const { Icon, colorClass } = FILE_CHIP_CONFIG[item.type];
    return (
      <ContextChip
        key={`ex:${item.type}:${item.pattern}`}
        icon={<Icon className="tw-size-3.5" />}
        colorClass={colorClass}
        label={getBadgeLabel(item)}
        dim
        onRemove={() => handleRemoveExclusion(item.pattern, item.type)}
      />
    );
  });

  const editorBox = (
    <div
      className={cn(
        "tw-flex tw-max-h-60 tw-min-h-[200px] tw-flex-col tw-rounded-xl tw-border tw-p-3 tw-transition-colors",
        isDragging
          ? "tw-border-solid tw-border-interactive-accent"
          : "tw-border-dashed tw-border-border",
        className
      )}
    >
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
              {droppable
                ? "or use Manage to add inclusion / tag / property / URL"
                : "Add via + URL or Manage"}
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
        {droppable && !isEmpty && (
          <div
            aria-hidden={!isDragging}
            className={cn(
              "tw-pointer-events-none tw-absolute tw-inset-0 tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-1 tw-rounded-md tw-transition-opacity tw-duration-150 motion-reduce:tw-transition-none",
              isDragging ? "tw-opacity-100" : "tw-opacity-0"
            )}
          >
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
  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <div className="tw-text-sm tw-text-muted">
        Define patterns to include specific files, folders, tags or properties in the project
        context. You can also add web pages or YouTube videos.
      </div>
      {editorBox}
    </div>
  );
}
