import React from "react";
import { ExternalLink, FileText, Folder, Hash, X } from "lucide-react";
import { TFile } from "obsidian";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/TruncatedText";
import { ContextBadgeWrapper } from "./ContextBadgeWrapper";

interface BaseContextBadgeProps {
  onRemove?: () => void;
  onClick?: () => void;
}

interface ContextNoteBadgeProps extends BaseContextBadgeProps {
  note: TFile;
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

interface ContextActiveNoteBadgeProps extends BaseContextBadgeProps {
  currentActiveFile: TFile | null;
}

export function ContextActiveNoteBadge({
  currentActiveFile,
  onRemove,
  onClick,
}: ContextActiveNoteBadgeProps) {
  if (!currentActiveFile) {
    return null;
  }

  const tooltipContent = <div className="tw-text-left">{currentActiveFile.path}</div>;
  const isPdf = currentActiveFile.extension === "pdf";
  const isCanvas = currentActiveFile.extension === "canvas";

  return (
    <ContextBadgeWrapper hasRemoveButton={!!onRemove} isClickable={!!onClick} onClick={onClick}>
      <div className="tw-flex tw-items-center tw-gap-1">
        <FileText className="tw-size-3" />
        <TruncatedText className="tw-max-w-40" tooltipContent={tooltipContent} alwaysShowTooltip>
          {currentActiveFile.basename}
        </TruncatedText>
        <span className="tw-text-xs tw-text-faint">Current</span>
        {isPdf && <span className="tw-text-xs tw-text-faint">pdf</span>}
        {isCanvas && <span className="tw-text-xs tw-text-faint">canvas</span>}
      </div>
      {onRemove && (
        <Button
          variant="ghost2"
          size="fit"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove from context"
          className="tw-text-muted"
        >
          <X className="tw-size-4" />
        </Button>
      )}
    </ContextBadgeWrapper>
  );
}

export function ContextNoteBadge({ note, onRemove, onClick }: ContextNoteBadgeProps) {
  const tooltipContent = <div className="tw-text-left">{note.path}</div>;
  const isPdf = note.extension === "pdf";
  const isCanvas = note.extension === "canvas";

  return (
    <ContextBadgeWrapper hasRemoveButton={!!onRemove} isClickable={!!onClick} onClick={onClick}>
      <div className="tw-flex tw-items-center tw-gap-1">
        <FileText className="tw-size-3" />
        <TruncatedText className="tw-max-w-40" tooltipContent={tooltipContent} alwaysShowTooltip>
          {note.basename}
        </TruncatedText>
        {isPdf && <span className="tw-text-xs tw-text-faint">pdf</span>}
        {isCanvas && <span className="tw-text-xs tw-text-faint">canvas</span>}
      </div>
      {onRemove && (
        <Button
          variant="ghost2"
          size="fit"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove from context"
          className="tw-text-muted"
        >
          <X className="tw-size-4" />
        </Button>
      )}
    </ContextBadgeWrapper>
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
    <ContextBadgeWrapper hasRemoveButton={!!onRemove}>
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
    </ContextBadgeWrapper>
  );
}

export function ContextTagBadge({ tag, onRemove }: ContextTagBadgeProps) {
  // Remove # symbol for clean display
  const displayTag = tag.startsWith("#") ? tag.slice(1) : tag;

  return (
    <ContextBadgeWrapper hasRemoveButton={!!onRemove}>
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
    </ContextBadgeWrapper>
  );
}

export function ContextFolderBadge({ folder, onRemove }: ContextFolderBadgeProps) {
  return (
    <ContextBadgeWrapper hasRemoveButton={!!onRemove}>
      <div className="tw-flex tw-items-center tw-gap-1">
        <Folder className="tw-size-3" />
        <TruncatedText className="tw-max-w-40" tooltipContent={folder} alwaysShowTooltip>
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
    </ContextBadgeWrapper>
  );
}
