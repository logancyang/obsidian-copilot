import type { ProcessingItem } from "@/components/project/processingAdapter";
import {
  ProcessingStatusIcon,
  processingSourceKey,
} from "@/components/project/processingItemStatusView";
import { AddUrlPopover } from "@/components/project/AddUrlPopover";
import { UrlTypeIcon } from "@/components/project/UrlTypeIcon";
import { TruncatedText } from "@/components/TruncatedText";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openAgentCachedItemPreview } from "@/utils/cacheFileOpener";
import type { UrlItem, UrlKind } from "@/utils/urlTagUtils";
import { ArrowUpRight, Globe, Link, PlusCircle, X, Youtube } from "lucide-react";
import { App } from "obsidian";
import React from "react";

/** The three Links-related selections in the Manage sidebar. */
export type LinksSection = "links" | "web" | "youtube";

interface LinksSidebarSectionProps {
  activeSection: string | null;
  webCount: number;
  youtubeCount: number;
  onSelect: (section: LinksSection) => void;
  /** Saved URLs so the +URL popover dedups re-adds. */
  existingUrls: string[];
  /** Parsed, deduped URLs from the +URL popover → merge into the draft. */
  onAddUrls: (urls: UrlItem[]) => void;
  /** Portal target for the +URL popover (the Manage modal's contentEl). */
  popoverContainer?: HTMLElement | null;
}

/**
 * Left-sidebar "Links" group (design M): a cyan parent "Links" + Web / YouTube
 * children with counts. Clicking the parent lists both groups on the right;
 * clicking a child filters to that one. Mirrors the existing file sections'
 * look (hover + active highlight) without reaching into the modal's private
 * SectionHeader.
 */
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
        Icon={Youtube}
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
  app: App;
  urlItems: UrlItem[];
  filter: LinksSection;
  /** Agent conversion status by {@link processingSourceKey}, supplied by the
   * modal (one shared lookup across Links + File Context). */
  agentProcessingByKey: ReadonlyMap<string, ProcessingItem>;
  onRemove: (id: string) => void;
}

/**
 * Right-pane Links viewer: the saved URLs grouped under Web / YouTube labels.
 * Each row shows its conversion status badge + a preview arrow (converted
 * snapshot) + a hover delete. Adding is handled solely by the sidebar's "+"
 * popover, matching every other context type (Tags / Folders / Files), whose
 * right pane is a pure list with no inline add affordance.
 *
 * Status reflects the SAVED config — a freshly added (unsaved) URL has no status
 * yet. The status lookup is passed in (not derived here) so the URL rows and the
 * File Context list share ONE {@link ProcessingStatusIcon} judgment.
 */
export function LinksContentPanel({
  app,
  urlItems,
  filter,
  agentProcessingByKey,
  onRemove,
}: LinksContentPanelProps) {
  const handlePreview = (item: ProcessingItem) => {
    // Snapshots are off-vault and keyed by source identity, so the preview no
    // longer needs the project folder — just the item's kind + id.
    void openAgentCachedItemPreview(app, item);
  };

  const webItems = urlItems.filter((u) => u.type === "web");
  const youtubeItems = urlItems.filter((u) => u.type === "youtube");
  const showWeb = filter === "links" || filter === "web";
  const showYoutube = filter === "links" || filter === "youtube";

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      {showWeb && webItems.length > 0 && (
        <UrlGroup
          label="Web"
          type="web"
          items={webItems}
          agentProcessingByKey={agentProcessingByKey}
          onRemove={onRemove}
          onPreview={handlePreview}
        />
      )}
      {showYoutube && youtubeItems.length > 0 && (
        <UrlGroup
          label="YouTube"
          type="youtube"
          items={youtubeItems}
          agentProcessingByKey={agentProcessingByKey}
          onRemove={onRemove}
          onPreview={handlePreview}
        />
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
  agentProcessingByKey,
  onRemove,
  onPreview,
}: {
  label: string;
  type: UrlKind;
  items: UrlItem[];
  agentProcessingByKey: ReadonlyMap<string, ProcessingItem>;
  onRemove: (id: string) => void;
  onPreview: (item: ProcessingItem) => void;
}) {
  return (
    <div className="tw-mb-2">
      <div className="tw-mb-1.5 tw-mt-2 tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-font-bold tw-text-faint">
        <UrlTypeIcon type={type} className="tw-size-3.5" />
        {label} <span className="tw-font-medium">({items.length})</span>
      </div>
      {items.map((item) => {
        const status = agentProcessingByKey.get(processingSourceKey(type, item.url));
        const isReady = status?.status === "ready";
        return (
          <div
            key={item.id}
            className="tw-group tw-mb-1.5 tw-flex tw-items-center tw-gap-2.5 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-px-3 tw-py-2"
          >
            <UrlTypeIcon type={item.type} className="tw-size-4 tw-shrink-0" />
            <TruncatedText className="tw-min-w-0 tw-flex-1 tw-text-sm" tooltipContent={item.url}>
              {item.url.replace(/^https?:\/\//, "")}
            </TruncatedText>
            {isReady && status && (
              <ArrowUpRight
                className="tw-size-4 tw-shrink-0 tw-cursor-pointer tw-text-faint tw-opacity-0 hover:tw-text-normal group-hover:tw-opacity-100"
                onClick={() => onPreview(status)}
                aria-label="View converted content"
              />
            )}
            {status && <ProcessingStatusIcon item={status} revealReadyOnHover />}
            <X
              className="tw-size-4 tw-shrink-0 tw-cursor-pointer tw-text-faint tw-opacity-0 hover:tw-text-error group-hover:tw-opacity-100"
              onClick={() => onRemove(item.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
