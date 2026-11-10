import type { ProjectConfig } from "@/aiParams";
import { AddUrlPopover } from "@/projects/ui/AddUrlPopover";
import { ContextChip } from "@/projects/ui/ContextChip";
import {
  buildBadgeItems,
  getBadgeLabel,
  removePattern,
} from "@/projects/ui/ProjectContextBadgeList";
import { UrlTypeIcon } from "@/projects/ui/UrlTypeIcon";
import { Button } from "@/components/ui/button";
import { parseProjectUrls, serializeProjectUrls, type UrlItem } from "@/projects/urlTagUtils";
import { FileText, Folder, Hash, Inbox, Settings, SlidersHorizontal, Tag } from "lucide-react";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

type ContextSource = NonNullable<ProjectConfig["contextSource"]>;

interface ProjectContextSourceEditorProps {
  contextSource: ProjectConfig["contextSource"] | undefined;
  onChange: (patch: Partial<ContextSource>) => void;
  onManage: () => void;
  popoverContainer?: HTMLElement | null;
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
    <div className="tw-flex tw-max-h-60 tw-min-h-[200px] tw-flex-col tw-rounded-xl tw-border tw-border-dashed tw-border-border tw-p-3">
      <div className="tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
        {isEmpty ? (
          <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-gap-1 tw-py-8 tw-text-center">
            <Inbox className="tw-mb-1 tw-size-6 tw-text-muted" />
            <div className="tw-text-sm tw-text-normal">No context yet</div>
            <div className="tw-text-xs tw-text-muted">Add via + URL or Manage</div>
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
      </div>

      <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-text-xs tw-text-faint">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-3">
          <span className="tw-truncate">Add a web / YouTube link</span>
          <AddUrlPopover
            existingUrls={urlItems.map((u) => u.url)}
            onAdd={handleAddUrls}
            container={popoverContainer}
          />
        </div>
        <div className="tw-ml-auto tw-flex tw-shrink-0 tw-items-center">
          <Button size="sm" className="tw-gap-1.5" onClick={onManage}>
            <Settings className="tw-size-3.5" />
            Manage context
          </Button>
        </div>
      </div>
    </div>
  );

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
