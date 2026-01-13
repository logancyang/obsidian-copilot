import React from "react";
import { ExternalLink, FileText, Folder, Globe, Hash, X, CircleDashed } from "lucide-react";
import { TFile } from "obsidian";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/TruncatedText";
import { getDomainFromUrl } from "@/utils";
import { cn } from "@/lib/utils";
import { ContextBadgeWrapper } from "./ContextBadgeWrapper";
import {
  SelectedTextContext,
  WebTabContext,
  isWebSelectedTextContext,
} from "@/types/message";

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

interface ContextWebTabBadgeProps extends BaseContextBadgeProps {
  webTab: WebTabContext;
}

interface ContextTagBadgeProps extends BaseContextBadgeProps {
  tag: string;
}

interface ContextFolderBadgeProps extends BaseContextBadgeProps {
  folder: string;
}

interface ContextSelectedTextBadgeProps extends BaseContextBadgeProps {
  selectedText: SelectedTextContext;
}

interface ContextActiveNoteBadgeProps extends BaseContextBadgeProps {
  currentActiveFile: TFile | null;
}

/**
 * Shared favicon renderer component for web tab badges.
 * Shows favicon image if available, falls back to Globe icon.
 * Handles image load errors gracefully.
 */
interface FaviconOrGlobeProps {
  faviconUrl?: string;
  isLoaded?: boolean;
  className?: string;
}

export function FaviconOrGlobe({ faviconUrl, isLoaded = true, className = "tw-size-3" }: FaviconOrGlobeProps) {
  const [showFavicon, setShowFavicon] = React.useState<boolean>(Boolean(faviconUrl));

  React.useEffect(() => {
    setShowFavicon(Boolean(faviconUrl));
  }, [faviconUrl]);

  if (!isLoaded) {
    return <CircleDashed className={cn(className, "tw-text-muted")} />;
  }

  if (showFavicon && faviconUrl) {
    return (
      <img
        src={faviconUrl}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        className={cn(className, "tw-rounded-sm")}
        onError={() => setShowFavicon(false)}
      />
    );
  }

  return <Globe className={className} />;
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

interface ContextActiveWebTabBadgeProps extends BaseContextBadgeProps {
  activeWebTab: WebTabContext | null;
}

export function ContextActiveWebTabBadge({
  activeWebTab,
  onRemove,
  onClick,
}: ContextActiveWebTabBadgeProps) {
  if (!activeWebTab) {
    return null;
  }

  const domain = getDomainFromUrl(activeWebTab.url);
  const displayText = activeWebTab.title || domain || activeWebTab.url || "Untitled";
  const tooltipContent = <div className="tw-text-left">{activeWebTab.url}</div>;

  return (
    <ContextBadgeWrapper hasRemoveButton={!!onRemove} isClickable={!!onClick} onClick={onClick}>
      <div className="tw-flex tw-items-center tw-gap-1">
        <FaviconOrGlobe faviconUrl={activeWebTab.faviconUrl} />
        <TruncatedText className="tw-max-w-40" tooltipContent={tooltipContent} alwaysShowTooltip>
          {displayText}
        </TruncatedText>
        <span className="tw-text-xs tw-text-faint">Current</span>
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
  return (
    <ContextBadgeWrapper hasRemoveButton={!!onRemove}>
      <div className="tw-flex tw-items-center tw-gap-1">
        <ExternalLink className="tw-size-3" />
        <TruncatedText className="tw-max-w-40" tooltipContent={url}>
          {getDomainFromUrl(url)}
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

/**
 * Renders a context badge for a Web Viewer tab.
 * Shows favicon (if available) or Globe icon, with title or domain as display text.
 * Displays a special "unloaded" state for tabs that haven't loaded their content yet.
 */
export function ContextWebTabBadge({ webTab, onRemove, onClick }: ContextWebTabBadgeProps) {
  const isLoaded = webTab.isLoaded !== false;
  const domain = getDomainFromUrl(webTab.url);
  const displayText = webTab.title || domain || webTab.url || "Untitled";
  const tooltipText = isLoaded ? webTab.url : "Tab not loaded - switch to this tab to load content";

  return (
    <ContextBadgeWrapper
      hasRemoveButton={!!onRemove}
      isClickable={!!onClick}
      onClick={onClick}
      className={cn(!isLoaded && "tw-opacity-60")}
    >
      <div className="tw-flex tw-items-center tw-gap-1">
        <FaviconOrGlobe faviconUrl={webTab.faviconUrl} isLoaded={isLoaded} />
        <TruncatedText
          className={cn("tw-max-w-40", !isLoaded && "tw-italic")}
          tooltipContent={tooltipText}
        >
          {displayText}
        </TruncatedText>
        {!isLoaded && <span className="tw-text-xs tw-text-muted">(not loaded)</span>}
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

export function ContextSelectedTextBadge({
  selectedText,
  onRemove,
}: ContextSelectedTextBadgeProps) {
  // Handle web selected text
  if (isWebSelectedTextContext(selectedText)) {
    const domain = getDomainFromUrl(selectedText.url);
    const tooltipContent = (
      <div className="tw-text-left">
        {selectedText.url}
      </div>
    );

    return (
      <ContextBadgeWrapper hasRemoveButton={!!onRemove}>
        <div className="tw-flex tw-items-center tw-gap-1">
          <FaviconOrGlobe faviconUrl={selectedText.faviconUrl} />
          <TruncatedText className="tw-max-w-40" tooltipContent={tooltipContent} alwaysShowTooltip>
            {selectedText.title || domain}
          </TruncatedText>
          <span className="tw-text-xs tw-text-faint">Selection</span>
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

  // Handle note selected text (default)
  const lineRange =
    selectedText.startLine === selectedText.endLine
      ? `L${selectedText.startLine}`
      : `L${selectedText.startLine}-${selectedText.endLine}`;

  const tooltipContent = (
    <div className="tw-text-left">
      {selectedText.notePath} ({lineRange})
    </div>
  );

  return (
    <ContextBadgeWrapper hasRemoveButton={!!onRemove}>
      <div className="tw-flex tw-items-center tw-gap-1">
        <FileText className="tw-size-3" />
        <TruncatedText className="tw-max-w-40" tooltipContent={tooltipContent} alwaysShowTooltip>
          {selectedText.noteTitle}
        </TruncatedText>
        <span className="tw-text-xs tw-text-faint">{lineRange}</span>
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
