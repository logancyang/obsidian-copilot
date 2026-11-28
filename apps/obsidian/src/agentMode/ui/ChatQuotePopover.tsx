import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquareText, TextQuote } from "lucide-react";
import React, { useEffect, useState } from "react";

export interface ChatQuote {
  content: string;
  comment?: string;
}

interface ChatQuoteMenuProps {
  onAdd: (comment?: string) => void;
  startCommenting?: boolean;
}

const ACTION_CLASS = "tw-text-normal hover:tw-bg-modifier-hover";

export function ChatQuoteMenu({ onAdd, startCommenting = false }: ChatQuoteMenuProps) {
  const [commenting, setCommenting] = useState(startCommenting);
  const [comment, setComment] = useState("");

  if (!commenting) {
    return (
      <div className="tw-flex tw-gap-0.5">
        <Button variant="ghost2" size="sm" className={ACTION_CLASS} onClick={() => onAdd()}>
          <TextQuote className="tw-size-4" />
          Quote
        </Button>
        <Button
          variant="ghost2"
          size="sm"
          className={ACTION_CLASS}
          onClick={() => setCommenting(true)}
        >
          <MessageSquareText className="tw-size-4" />
          Comment
        </Button>
      </div>
    );
  }

  const submit = () => {
    if (comment.trim()) onAdd(comment.trim());
  };
  return (
    <div className="tw-flex tw-w-72 tw-flex-col tw-gap-2 tw-p-1">
      <Textarea
        autoFocus
        aria-label="Comment"
        placeholder="Add a comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          submit();
        }}
      />
      <div className="tw-flex tw-justify-end">
        <Button size="sm" disabled={!comment.trim()} onClick={submit}>
          Add
        </Button>
      </div>
    </div>
  );
}

export const QUOTED_PASSAGE_HIGHLIGHT = "copilot-quoted-passage";

interface SelectedPassage {
  text: string;
  range: Range;
  anchor: React.RefObject<{ getBoundingClientRect: () => DOMRect; contextElement?: Element }>;
}

function selectedPassage(scopeEl: HTMLElement): SelectedPassage | null {
  const selection = scopeEl.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const text = selection.toString().trim();
  if (!text || !scopeEl.contains(range.commonAncestorContainer)) return null;
  return {
    text,
    range,
    anchor: {
      current: {
        getBoundingClientRect: () => range.getBoundingClientRect(),
        contextElement: range.startContainer.parentElement ?? undefined,
      },
    },
  };
}

interface ChatQuotePopoverProps {
  scopeEl: HTMLElement | null;
  container?: HTMLElement | null;
  onAdd: (quote: ChatQuote) => void;
}

export function ChatQuotePopover({ scopeEl, container, onAdd }: ChatQuotePopoverProps) {
  const [passage, setPassage] = useState<SelectedPassage | null>(null);

  useEffect(() => {
    if (!scopeEl) return;
    const read = () => {
      const next = selectedPassage(scopeEl);
      if (next) setPassage(next);
    };
    scopeEl.addEventListener("pointerup", read);
    return () => scopeEl.removeEventListener("pointerup", read);
  }, [scopeEl]);

  // The comment box takes focus, which clears the selection, so the passage stays marked as a named highlight; a popout's registry only takes its own window's Highlight.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/1045
  useEffect(() => {
    if (!passage || !scopeEl) return;
    const view = scopeEl.ownerDocument.defaultView as typeof window;
    view.CSS.highlights.set(QUOTED_PASSAGE_HIGHLIGHT, new view.Highlight(passage.range));
    return () => {
      view.CSS.highlights.delete(QUOTED_PASSAGE_HIGHLIGHT);
    };
  }, [passage, scopeEl]);

  if (!passage) return null;
  const add = (comment?: string) => {
    onAdd({ content: passage.text, ...(comment ? { comment } : {}) });
    scopeEl?.ownerDocument.getSelection()?.removeAllRanges();
    setPassage(null);
  };
  return (
    <Popover open onOpenChange={(open) => !open && setPassage(null)}>
      <PopoverAnchor virtualRef={passage.anchor} />
      <PopoverContent
        container={container}
        side="top"
        hideWhenDetached
        className="tw-w-auto tw-p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ChatQuoteMenu onAdd={add} />
      </PopoverContent>
    </Popover>
  );
}
