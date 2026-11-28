import { QuotedPassage } from "@/components/chat-components/ContextBadges";
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
  passage: string;
  onAdd: (comment?: string) => void;
  startCommenting?: boolean;
}

const ACTION_CLASS = "tw-text-normal hover:tw-bg-modifier-hover";

export function ChatQuoteMenu({ passage, onAdd, startCommenting = false }: ChatQuoteMenuProps) {
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
      <QuotedPassage text={passage} className="tw-line-clamp-3 tw-text-xs" />
      <Textarea
        autoFocus
        aria-label="Comment"
        placeholder="Add a comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          // Shift+Enter starts a new line and Enter during IME composition picks a candidate, so neither adds the comment. https://github.com/Brevilabs/obsidian-copilot-private/issues/1045
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

interface SelectedPassage {
  text: string;
  anchor: React.RefObject<{ getBoundingClientRect: () => DOMRect; contextElement?: Element }>;
}

const EDITABLE_SELECTOR = "[contenteditable]:not([contenteditable='false']), textarea, input";

function selectedPassage(scopeEl: HTMLElement): SelectedPassage | null {
  const selection = scopeEl.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const text = selection.toString().trim();
  if (!text || !scopeEl.contains(range.commonAncestorContainer)) return null;
  // Text selected in the composer is the user's unsent draft, not a passage from the conversation. https://github.com/Brevilabs/obsidian-copilot-private/issues/1045
  const ancestor = range.commonAncestorContainer;
  const ancestorEl =
    ancestor.nodeType === Node.ELEMENT_NODE ? (ancestor as Element) : ancestor.parentElement;
  if (ancestorEl?.closest(EDITABLE_SELECTOR)) return null;
  return {
    text,
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
    // A selection made or resized with Shift+Arrow ends on a keyup, which reaches the document rather than the chat. https://github.com/Brevilabs/obsidian-copilot-private/issues/1045
    const readAfterShift = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === "Shift") read();
    };
    const doc = scopeEl.ownerDocument;
    scopeEl.addEventListener("pointerup", read);
    doc.addEventListener("keyup", readAfterShift);
    return () => {
      scopeEl.removeEventListener("pointerup", read);
      doc.removeEventListener("keyup", readAfterShift);
    };
  }, [scopeEl]);

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
        <ChatQuoteMenu passage={passage.text} onAdd={add} />
      </PopoverContent>
    </Popover>
  );
}
