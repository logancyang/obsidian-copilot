import { AddUrlPopover } from "@/components/project/AddUrlPopover";
import { UrlTypeIcon } from "@/components/project/UrlTypeIcon";
import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UrlItem, UrlKind } from "@/utils/urlTagUtils";
import { Globe, Link, PlusCircle, SquarePlay, X } from "lucide-react";
import React from "react";

export type LinksSection = "links" | "web" | "youtube";

interface LinksSidebarSectionProps {
  activeSection: string | null;
  webCount: number;
  youtubeCount: number;
  onSelect: (section: LinksSection) => void;
  existingUrls: string[];
  onAddUrls: (urls: UrlItem[]) => void;
  popoverContainer?: HTMLElement | null;
}

export function LinksSidebarSection({
  activeSection,
  webCount,
  youtubeCount,
  onSelect,
  existingUrls,
  onAddUrls,
  popoverContainer,
}: LinksSidebarSectionProps) {
  return (
    <div>
      <div
        className={cn(
          "tw-mb-1 tw-flex tw-cursor-pointer tw-items-center tw-rounded-md tw-p-2 hover:tw-bg-secondary/50",
          activeSection === "links" && "tw-bg-secondary"
        )}
        onClick={() => onSelect("links")}
      >
        <Link className="tw-mr-2 tw-size-4 tw-text-context-manager-cyan" />
        <h3 className="tw-text-sm tw-font-semibold tw-text-context-manager-cyan">Links</h3>
        <AddUrlPopover
          existingUrls={existingUrls}
          onAdd={onAddUrls}
          container={popoverContainer}
          trigger={
            <Button
              variant="ghost"
              size="fit"
              className="tw-ml-auto tw-text-muted hover:tw-bg-secondary"
              title="Add link"
              onClick={(e) => e.stopPropagation()}
            >
              <PlusCircle className="tw-size-4 tw-text-context-manager-cyan" />
            </Button>
          }
        />
      </div>
      <LinkSubItem
        Icon={Globe}
        label="Web"
        count={webCount}
        active={activeSection === "web"}
        onClick={() => onSelect("web")}
      />
      <LinkSubItem
        Icon={SquarePlay}
        label="YouTube"
        count={youtubeCount}
        active={activeSection === "youtube"}
        onClick={() => onSelect("youtube")}
      />
    </div>
  );
}

function LinkSubItem({
  Icon,
  label,
  count,
  active,
  onClick,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        "tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-md tw-py-1.5 tw-pl-6 tw-pr-2 tw-text-sm hover:tw-bg-secondary/50",
        active && "tw-bg-secondary tw-text-normal"
      )}
      onClick={onClick}
    >
      <Icon className="tw-size-4 tw-text-context-manager-cyan" />
      <span className="tw-flex-1">{label}</span>
      <span className="tw-text-xs tw-text-faint">{count}</span>
    </div>
  );
}

interface LinksContentPanelProps {
  urlItems: UrlItem[];
  filter: LinksSection;
  onRemove: (id: string) => void;
}

export function LinksContentPanel({ urlItems, filter, onRemove }: LinksContentPanelProps) {
  const webItems = urlItems.filter((u) => u.type === "web");
  const youtubeItems = urlItems.filter((u) => u.type === "youtube");
  const showWeb = filter === "links" || filter === "web";
  const showYoutube = filter === "links" || filter === "youtube";

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {showWeb && webItems.length > 0 && (
        <UrlGroup label="Web" type="web" items={webItems} onRemove={onRemove} />
      )}
      {showYoutube && youtubeItems.length > 0 && (
        <UrlGroup label="YouTube" type="youtube" items={youtubeItems} onRemove={onRemove} />
      )}
      {((showWeb && webItems.length > 0) || (showYoutube && youtubeItems.length > 0)) === false && (
        <div className="tw-py-6 tw-text-center tw-text-sm tw-text-muted">
          No links yet. Use the + next to Links in the sidebar to add one.
        </div>
      )}
    </div>
  );
}

function UrlGroup({
  label,
  type,
  items,
  onRemove,
}: {
  label: string;
  type: UrlKind;
  items: UrlItem[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="tw-mb-2">
      <div className="tw-mb-1.5 tw-mt-2 tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-font-bold tw-text-faint">
        <UrlTypeIcon type={type} className="tw-size-3.5" />
        {label} <span className="tw-font-medium">({items.length})</span>
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className="tw-group tw-mb-1.5 tw-flex tw-items-center tw-gap-2.5 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-px-3 tw-py-2"
        >
          <UrlTypeIcon type={item.type} className="tw-size-4 tw-shrink-0" />
          <TruncatedText className="tw-min-w-0 tw-flex-1 tw-text-sm" tooltipContent={item.url}>
            {item.url.replace(/^https?:\/\//, "")}
          </TruncatedText>
          <X
            className="tw-size-4 tw-shrink-0 tw-cursor-pointer tw-text-faint tw-opacity-0 hover:tw-text-error group-hover:tw-opacity-100"
            onClick={() => onRemove(item.id)}
          />
        </div>
      ))}
    </div>
  );
}
