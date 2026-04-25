/**
 * InlineDiffWidget - CM6 `WidgetType` that renders `<InlineDiffCard>` in place
 * of a commented passage during suggest-edit review.
 */

import { EditorView, WidgetType } from "@codemirror/view";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { InlineDiffCard, type InlineDiffCallbacks } from "@/components/comments/InlineDiffCard";

interface InlineDiffWidgetProps {
  commentId: string;
  originalText: string;
  proposedText: string;
  callbacks: InlineDiffCallbacks;
}

export class InlineDiffWidget extends WidgetType {
  private root: Root | null = null;

  constructor(private readonly props: InlineDiffWidgetProps) {
    super();
  }

  eq(other: InlineDiffWidget): boolean {
    return (
      other.props.commentId === this.props.commentId &&
      other.props.originalText === this.props.originalText &&
      other.props.proposedText === this.props.proposedText
    );
  }

  toDOM(_view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "copilot-inline-diff-widget";
    this.root = createRoot(el);
    this.root.render(<InlineDiffCard {...this.props} />);
    return el;
  }

  destroy(): void {
    try {
      this.root?.unmount();
    } catch {
      // noop
    }
    this.root = null;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
