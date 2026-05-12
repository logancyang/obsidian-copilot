/**
 * Tag-style URL input component for project context URLs.
 *
 * Supports:
 * - Single URL entry via Enter key
 * - Batch paste (newline/space separated)
 * - Automatic web/youtube classification
 * - Grouped display (Web section + YouTube section)
 * - Duplicate detection on add
 */

import { Button } from "@/components/ui/button";
import { type UrlItem, detectUrlType, isValidUrl } from "@/utils/urlTagUtils";
import { TruncatedText } from "@/components/TruncatedText";
import { ClipboardPaste, Globe, Link, X, Youtube } from "lucide-react";
import React, {
  useCallback,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

interface UrlTagInputProps {
  urls: UrlItem[];
  onAdd: (urls: UrlItem[]) => void;
  onRemove: (id: string) => void;
}

/** Generate a short random ID */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function UrlTagInput({ urls, onAdd, onRemove }: UrlTagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reason: Existing URL set for dedup — prevents duplicate entries on add
  const existingUrls = new Set(urls.map((u) => u.url.trim()));

  const parseAndAddUrls = (text: string) => {
    const urlStrings = text
      .split(/[\n\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && isValidUrl(s));

    if (urlStrings.length === 0) return;

    const newUrls: UrlItem[] = [];
    for (const raw of urlStrings) {
      const url = raw.startsWith("http") ? raw : `https://${raw}`;
      if (existingUrls.has(url)) continue;
      existingUrls.add(url);
      newUrls.push({ id: generateId(), url, type: detectUrlType(raw) });
    }

    if (newUrls.length > 0) {
      onAdd(newUrls);
    }
    setInputValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      parseAndAddUrls(inputValue);
    }
    if (e.key === "Backspace" && !inputValue && urls.length > 0) {
      onRemove(urls[urls.length - 1].id);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData("text");
    // Reason: If paste contains multiple URLs, intercept and batch-process
    if (pastedText.includes("\n") || pastedText.split(/\s+/).filter(isValidUrl).length > 1) {
      e.preventDefault();
      parseAndAddUrls(pastedText);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        parseAndAddUrls(text);
      }
    } catch {
      // Clipboard API not available or permission denied in Obsidian
    }
  };

  const webUrls = urls.filter((u) => u.type === "web");
  const youtubeUrls = urls.filter((u) => u.type === "youtube");

  return (
    <div className="tw-space-y-3">
      {/* Input Row */}
      <div className="tw-flex tw-gap-2">
        <div
          className={`tw-flex tw-min-h-[40px] tw-flex-1 tw-items-center tw-rounded-md tw-border tw-border-border tw-px-3 tw-transition-colors ${
            isFocused ? "tw-border-interactive-accent tw-ring-1 tw-ring-ring" : ""
          }`}
          onClick={() => inputRef.current?.focus()}
        >
          <Link className="tw-mr-2 tw-size-4 tw-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="tw-flex-1 tw-bg-transparent tw-text-sm tw-text-normal tw-outline-none placeholder:tw-text-muted"
            placeholder="Enter URL and press Enter..."
          />
        </div>
        <Button
          variant="secondary"
          onClick={handlePasteFromClipboard}
          title="Paste from clipboard"
          className="tw-px-2"
        >
          <ClipboardPaste className="tw-size-4" />
        </Button>
      </div>

      {/* URL List - Grouped */}
      {urls.length > 0 && (
        <div className="tw-divide-y tw-divide-border tw-rounded-md tw-border tw-border-border">
          {/* Web URLs Section */}
          {webUrls.length > 0 && (
            <div className="tw-p-2">
              <div className="tw-mb-2 tw-flex tw-items-center tw-gap-1.5 tw-px-1">
                <Globe className="tw-size-3.5 tw-text-accent" />
                <span className="tw-text-ui-smaller tw-font-medium tw-text-muted">
                  Web ({webUrls.length})
                </span>
              </div>
              {/* Reason: Each section scrolls independently so YouTube is always visible */}
              {/* Reason: reverse so newly added URLs appear at top */}
              <FadingScrollArea maxHeight="120px">
                {[...webUrls].reverse().map((url) => (
                  <UrlItemRow key={url.id} url={url} onRemove={onRemove} />
                ))}
              </FadingScrollArea>
            </div>
          )}

          {/* YouTube Section */}
          {youtubeUrls.length > 0 && (
            <div className="tw-p-2">
              <div className="tw-mb-2 tw-flex tw-items-center tw-gap-1.5 tw-px-1">
                <Youtube className="tw-size-3.5 tw-text-error" />
                <span className="tw-text-ui-smaller tw-font-medium tw-text-muted">
                  YouTube ({youtubeUrls.length})
                </span>
              </div>
              {/* Reason: reverse so newly added URLs appear at top */}
              <FadingScrollArea maxHeight="120px">
                {[...youtubeUrls].reverse().map((url) => (
                  <UrlItemRow key={url.id} url={url} onRemove={onRemove} />
                ))}
              </FadingScrollArea>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {urls.length === 0 && (
        <p className="tw-text-ui-smaller tw-text-muted">
          Add web pages or YouTube videos. Supports batch paste (one URL per line).
        </p>
      )}
    </div>
  );
}

/** Scroll area with a bottom fade mask when content overflows. */
function FadingScrollArea({
  maxHeight,
  children,
}: {
  maxHeight: string;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showFade, setShowFade] = useState(false);

  const refCallback = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (el) setShowFade(el.scrollHeight > el.clientHeight);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    setShowFade(!atBottom);
  }, []);

  return (
    <div className="tw-relative">
      <div
        ref={refCallback}
        className="tw-space-y-1 tw-overflow-y-auto"
        style={{ maxHeight }}
        onScroll={handleScroll}
      >
        {children}
      </div>
      {showFade && (
        <div className="copilot-fade-mask-bottom tw-pointer-events-none tw-absolute tw-inset-x-0 tw-bottom-0 tw-h-8 tw-rounded-b-md" />
      )}
    </div>
  );
}

function UrlItemRow({ url, onRemove }: { url: UrlItem; onRemove: (id: string) => void }) {
  return (
    <div className="tw-group tw-flex tw-items-center tw-justify-between tw-rounded tw-px-2 tw-py-1.5 hover:tw-bg-modifier-hover">
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
        {url.type === "youtube" ? (
          <Youtube className="tw-size-3.5 tw-shrink-0 tw-text-error" />
        ) : (
          <Globe className="tw-size-3.5 tw-shrink-0 tw-text-accent" />
        )}
        <TruncatedText className="tw-text-sm tw-text-normal" tooltipContent={url.url}>
          {url.url.replace(/^https?:\/\//, "")}
        </TruncatedText>
      </div>
      <Button
        type="button"
        variant="ghost2"
        size="fit"
        onClick={() => onRemove(url.id)}
        className="tw-rounded tw-p-1 tw-opacity-0 tw-transition-opacity hover:tw-bg-modifier-hover group-hover:tw-opacity-100"
        title="Remove"
      >
        <X className="tw-size-3.5 tw-text-muted" />
      </Button>
    </div>
  );
}
