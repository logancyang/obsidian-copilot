/**
 * CommentsListModal - lists every comment on the active note with state
 * filters. Lets the user jump to an active comment or delete an orphaned one.
 */

import React, { useMemo, useState } from "react";
import { App, MarkdownView, Modal } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { commentHighlights } from "@/editor/commentHighlights";
import { commentStore } from "@/comments/CommentStore";
import type { Comment, CommentState } from "@/comments/types";
import type { CommentsController } from "@/comments/CommentsController";
import { cn } from "@/lib/utils";

interface CommentsListProps {
  notePath: string;
  onJump: (comment: Comment) => void;
  onDelete: (comment: Comment) => void;
  onClose: () => void;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function CommentsList(props: CommentsListProps) {
  const { notePath, onJump, onDelete, onClose } = props;
  const [filter, setFilter] = useState<CommentState | "all">("all");
  const [comments, setComments] = useState<Comment[]>(() =>
    commentStore.getCommentsForNote(notePath)
  );

  React.useEffect(() => {
    return commentStore.subscribe((path) => {
      if (path !== notePath) return;
      setComments(commentStore.getCommentsForNote(notePath));
    });
  }, [notePath]);

  const filtered = useMemo(() => {
    if (filter === "all") return comments;
    return comments.filter((c) => c.state === filter);
  }, [comments, filter]);

  const counts = useMemo(() => {
    const result = { all: comments.length, active: 0, resolved: 0, orphaned: 0 };
    for (const c of comments) result[c.state]++;
    return result;
  }, [comments]);

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <div className="tw-flex tw-gap-1 tw-text-sm">
        <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>
          All ({counts.all})
        </FilterTab>
        <FilterTab active={filter === "active"} onClick={() => setFilter("active")}>
          Active ({counts.active})
        </FilterTab>
        <FilterTab active={filter === "resolved"} onClick={() => setFilter("resolved")}>
          Resolved ({counts.resolved})
        </FilterTab>
        <FilterTab active={filter === "orphaned"} onClick={() => setFilter("orphaned")}>
          Orphaned ({counts.orphaned})
        </FilterTab>
      </div>

      <div className="tw-flex tw-max-h-96 tw-flex-col tw-gap-2 tw-overflow-y-auto">
        {filtered.length === 0 && <div className="tw-text-sm tw-text-faint">No comments.</div>}
        {filtered.map((c) => (
          <div
            key={c.id}
            className="tw-flex tw-flex-col tw-gap-1 tw-rounded tw-border tw-border-border tw-px-2 tw-py-1.5"
          >
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
              <span
                className={cn(
                  "tw-rounded tw-px-1.5 tw-py-0.5 tw-text-xs",
                  c.state === "active" && "tw-bg-interactive-accent tw-text-on-accent",
                  c.state === "resolved" && "tw-bg-success tw-text-success",
                  c.state === "orphaned" && "tw-bg-error tw-text-error"
                )}
              >
                {c.state}
              </span>
              <span className="tw-text-xs tw-text-faint">
                {c.messages.length} message{c.messages.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="tw-text-sm tw-text-normal">“{truncate(c.anchor.exactText, 120)}”</div>
            <div className="tw-flex tw-justify-end tw-gap-1">
              {c.state === "active" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onJump(c);
                    onClose();
                  }}
                >
                  Open
                </Button>
              )}
              <Button size="sm" variant="destructive" onClick={() => onDelete(c)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "tw-rounded tw-px-2 tw-py-1 tw-text-xs tw-transition-colors",
        active
          ? "tw-bg-interactive-accent tw-text-on-accent"
          : "tw-bg-secondary tw-text-normal hover:tw-bg-interactive-hover"
      )}
    >
      {children}
    </button>
  );
}

export class CommentsListModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private notePath: string,
    private controller: CommentsController
  ) {
    super(app);
    // @ts-ignore - Modal.setTitle is available at runtime
    this.setTitle(`Copilot comments — ${notePath}`);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.root = createRoot(contentEl);
    this.root.render(
      <CommentsList
        notePath={this.notePath}
        onJump={(c) => this.jumpTo(c)}
        onDelete={(c) => this.deleteComment(c)}
        onClose={() => this.close()}
      />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
  }

  private jumpTo(comment: Comment): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = view?.editor?.cm;
    if (!cm) return;
    const entry = commentHighlights.get(cm, comment.id);
    if (entry) {
      cm.dispatch({ selection: { anchor: entry.from, head: entry.to }, scrollIntoView: true });
      this.controller.openComment(cm, this.notePath, comment.id);
    }
  }

  private deleteComment(comment: Comment): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = view?.editor?.cm;
    if (cm) commentHighlights.remove(cm, comment.id);
    commentStore.removeComment(this.notePath, comment.id);
  }
}
