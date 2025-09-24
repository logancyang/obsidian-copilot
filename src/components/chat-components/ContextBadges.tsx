import React from "react";
import { ExternalLink, FileText, Folder, Hash, X } from "lucide-react";
import { TFile } from "obsidian";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/TruncatedText";

interface BaseContextBadgeProps {
  onRemove?: () => void;
}

interface ContextNoteBadgeProps extends BaseContextBadgeProps {
  note: TFile;
  isActive?: boolean;
}

interface ContextUrlBadgeProps extends BaseContextBadgeProps {
  url: string;
}

interface ContextTagBadgeProps extends BaseContextBadgeProps {
  tag: string;
}

interface ContextFolderBadgeProps extends BaseContextBadgeProps {
  folder: string;
}

export function ContextNoteBadge({ note, isActive = false, onRemove }: ContextNoteBadgeProps) {
  const tooltipContent = <div className="tw-text-left">{note.path}</div>;

  return (
    <Badge
      className={`tw-items-center tw-py-0 tw-pl-2 tw-text-xs ${onRemove ? "tw-pr-0.5" : "tw-pr-2"}`}
    >
      <div className="tw-flex tw-items-center tw-gap-1">
        <FileText className="tw-size-3" />
        <TruncatedText className="tw-max-w-40" tooltipContent={tooltipContent}>
          {note.basename}
        </TruncatedText>
        {isActive && <span className="tw-text-xs tw-text-faint">Current</span>}
        {note.extension === "pdf" && <span className="tw-text-xs tw-text-faint">pdf</span>}
      </div>
      {onRemove && (
        <Button
          variant="ghost2"
          size="fit"
          onClick={onRemove}
          aria-label="Remove from context"
          className="tw-text-muted"
        >
          <X className="tw-size-4" />
        </Button>
      )}
    </Badge>
  );
}

export function ContextUrlBadge({ url, onRemove }: ContextUrlBadgeProps) {
  // Extract domain from URL for display
  const getDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };

  return (
    <Badge
      className={`tw-items-center tw-py-0 tw-pl-2 tw-text-xs ${onRemove ? "tw-pr-0.5" : "tw-pr-2"}`}
    >
      <div className="tw-flex tw-items-center tw-gap-1">
        <ExternalLink className="tw-size-3" />
        <TruncatedText className="tw-max-w-40" tooltipContent={url}>
          {getDomain(url)}
        </TruncatedText>
      </div>
      {onRemove && (
        <Button
          variant="ghost2"
          size="fit"
          onClick={onRemove}
          aria-label="Remove from context"
          className="tw-text-muted"
        >
          <X className="tw-size-4" />
        </Button>
      )}
    </Badge>
  );
}

export function ContextTagBadge({ tag, onRemove }: ContextTagBadgeProps) {
  // Remove # symbol for clean display
  const displayTag = tag.startsWith("#") ? tag.slice(1) : tag;

  return (
    <Badge
      className={`tw-items-center tw-py-0 tw-pl-2 tw-text-xs ${onRemove ? "tw-pr-0.5" : "tw-pr-2"}`}
    >
      <div className="tw-flex tw-items-center tw-gap-1">
        <Hash className="tw-size-3" />
        <TruncatedText className="tw-max-w-40" tooltipContent={tag}>
          {displayTag}
        </TruncatedText>
      </div>
      {onRemove && (
        <Button
          variant="ghost2"
          size="fit"
          onClick={onRemove}
          aria-label="Remove from context"
          className="tw-text-muted"
        >
          <X className="tw-size-4" />
        </Button>
      )}
    </Badge>
  );
}

export function ContextFolderBadge({ folder, onRemove }: ContextFolderBadgeProps) {
  return (
    <Badge
      className={`tw-items-center tw-py-0 tw-pl-2 tw-text-xs ${onRemove ? "tw-pr-0.5" : "tw-pr-2"}`}
    >
      <div className="tw-flex tw-items-center tw-gap-1">
        <Folder className="tw-size-3" />
        <TruncatedText className="tw-max-w-40" tooltipContent={folder}>
          {folder}
        </TruncatedText>
      </div>
      {onRemove && (
        <Button
          variant="ghost2"
          size="fit"
          onClick={onRemove}
          aria-label="Remove from context"
          className="tw-text-muted"
        >
          <X className="tw-size-4" />
        </Button>
      )}
    </Badge>
  );
}
