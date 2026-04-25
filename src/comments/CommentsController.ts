/**
 * CommentsController - the top-level facade for the inline comments feature.
 *
 * Composed once in `main.ts`. Owns:
 *   - The in-memory CommentStore
 *   - The CM6 overlay controller (`CommentOverlayController`)
 *   - The JSON sidecar persistence (`CommentPersistenceManager`)
 *   - The anchor resolver for re-attaching highlights on note open
 *   - The vault watcher for rename/delete sync
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor, MarkdownView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import type CopilotPlugin from "@/main";
import { logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { commentHighlights } from "@/editor/commentHighlights";
import { commentOverlayPlugin } from "@/editor/commentOverlayExtension";
import { CommentOverlayController } from "@/editor/commentOverlayController";
import {
  clearPreviewEffect,
  commentDiffPreviewsField,
  onPreviewInvalidated,
  setPreviewEffect,
} from "@/editor/commentDiffPreviewsField";
import { commentStreamingIndicator, setCommentStreaming } from "@/editor/commentStreamingIndicator";
import { captureAnchor, resolveAnchor } from "./CommentAnchorResolver";
import { CommentPersistenceManager } from "./CommentPersistenceManager";
import { CommentSessionManager } from "./CommentSessionManager";
import { CommentsVaultWatcher } from "./CommentsVaultWatcher";
import { commentStore } from "./CommentStore";
import type { Comment, CommentAnchor } from "./types";

interface SelectionCapture {
  view: EditorView;
  from: number;
  to: number;
  exactText: string;
}

export class CommentsController {
  private overlayController = new CommentOverlayController();
  private persistence: CommentPersistenceManager;
  private vaultWatcher: CommentsVaultWatcher;
  private sessionManager: CommentSessionManager;
  private clickListeners = new WeakMap<EditorView, (ev: Event) => void>();
  private loadedNotes = new Set<string>();
  private storeUnsubscribe: (() => void) | null = null;
  private sessionStateUnsubscribe: (() => void) | null = null;

  constructor(private readonly plugin: CopilotPlugin) {
    this.persistence = new CommentPersistenceManager({
      app: plugin.app,
      getFolder: () => getSettings().commentsFolder,
    });
    this.vaultWatcher = new CommentsVaultWatcher(plugin, this.persistence);
    this.sessionManager = new CommentSessionManager(plugin);
  }

  createExtension(): Extension {
    return [
      commentHighlights.extension,
      commentDiffPreviewsField,
      commentOverlayPlugin,
      commentStreamingIndicator,
    ];
  }

  async init(): Promise<void> {
    await this.persistence.init();

    // Auto-persist store mutations.
    this.storeUnsubscribe = commentStore.subscribe((notePath) => {
      void this.schedulePersistFor(notePath);
    });

    // Forward session streaming state to the streaming-indicator extension so
    // the editor shows a pulsing dot while an agent is running in the background.
    this.sessionStateUnsubscribe = this.sessionManager.onAnyStateChange(
      ({ notePath, commentId, state }) => {
        const view = this.findViewForNotePath(notePath);
        if (!view) return;
        try {
          setCommentStreaming(view, commentId, state.isStreaming);
        } catch (error) {
          logWarn("CommentsController: setCommentStreaming failed", error);
        }
      }
    );

    // On workspace file-open, lazy-load persisted comments and re-add highlights.
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("file-open", (file) => {
        if (file instanceof TFile) void this.onFileOpen(file);
      })
    );

    // Track active-leaf-change to attach click listeners on newly-visible views.
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf || !(leaf.view instanceof MarkdownView)) return;
        const cm = leaf.view.editor?.cm;
        if (cm) this.attachClickListener(cm);
      })
    );

    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const cm = leaf.view.editor?.cm;
      if (cm) this.attachClickListener(cm);
    });

    // React to preview invalidation.
    onPreviewInvalidated((commentId) => {
      new Notice("Preview invalidated — ask again if you still want a revision.");
      this.markSuggestedEditRejected(commentId);
    });

    // Watch for renames/deletes of host notes.
    this.vaultWatcher.register();

    // Load comments for the currently-active file, if any.
    const active = this.plugin.app.workspace.getActiveFile();
    if (active) void this.onFileOpen(active);
  }

  async flushAndDispose(): Promise<void> {
    this.overlayController.close();
    this.sessionStateUnsubscribe?.();
    this.sessionStateUnsubscribe = null;
    this.sessionManager.disposeAll();
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    // Flush any pending writes by re-serializing every note's sidecar
    // synchronously (the persistence manager only debounces; final state may
    // differ from what was last scheduled).
    for (const notePath of commentStore.getAllNotePaths()) {
      await this.writeSidecarNow(notePath);
    }
    await this.persistence.flush();
  }

  // -- Commands --------------------------------------------------------------

  /** Entry point for the "Add Copilot comment" command. */
  startFromSelection(editor: Editor, markdownView: MarkdownView): void {
    const capture = this.captureActiveSelection(markdownView);
    if (!capture) return;
    const file = markdownView.file;
    if (!file) {
      new Notice("No active note — cannot add comment.");
      return;
    }

    const anchor = this.buildAnchorFromSelection(capture);
    const now = Date.now();
    const comment: Comment = {
      id: uuidv4(),
      anchor,
      state: "active",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    void this.persistence.ensureStableId(file.path);
    commentStore.upsertComment(file.path, comment);
    commentHighlights.add(capture.view, {
      id: comment.id,
      from: capture.from,
      to: capture.to,
      focused: true,
    });
    this.openComment(capture.view, file.path, comment.id);
  }

  openComment(view: EditorView, notePath: string, commentId: string): void {
    const comment = commentStore.getComment(notePath, commentId);
    if (!comment) return;
    this.overlayController.open({
      view,
      comment,
      notePath,
      panelOptions: {
        plugin: this.plugin,
        notePath,
        commentId,
        initialComment: comment,
        sessionManager: this.sessionManager,
        onResolveToggle: () => this.toggleResolved(view, notePath, commentId),
        onDelete: () => this.deleteComment(view, notePath, commentId),
        onReviewSuggestedEdit: (messageId) =>
          this.showEditPreview(view, notePath, commentId, messageId),
      },
    });
  }

  closeOverlay(): void {
    this.overlayController.close();
  }

  // -- Suggest-edit flows ----------------------------------------------------

  showEditPreview(view: EditorView, notePath: string, commentId: string, messageId: string): void {
    const comment = commentStore.getComment(notePath, commentId);
    if (!comment) return;
    const message = comment.messages.find((m) => m.id === messageId);
    const edit = message?.suggestedEdit;
    if (!edit || edit.status !== "pending") return;

    const entry = commentHighlights.get(view, commentId);
    if (!entry) {
      new Notice("Highlight for this comment is no longer available.");
      return;
    }
    const originalText = view.state.doc.sliceString(entry.from, entry.to);

    try {
      view.dispatch({
        effects: setPreviewEffect.of({
          commentId,
          from: entry.from,
          to: entry.to,
          originalText,
          proposedText: edit.proposedText,
          callbacks: {
            onAccept: () => this.acceptEdit(view, notePath, commentId, messageId),
            onReject: () => this.rejectEdit(view, notePath, commentId, messageId),
          },
        }),
      });
    } catch (error) {
      logWarn("showEditPreview: failed to dispatch preview effect", error);
    }
  }

  private acceptEdit(
    view: EditorView,
    notePath: string,
    commentId: string,
    messageId: string
  ): void {
    const comment = commentStore.getComment(notePath, commentId);
    if (!comment) return;
    const message = comment.messages.find((m) => m.id === messageId);
    const edit = message?.suggestedEdit;
    if (!edit || edit.status !== "pending") return;

    const preview = view.state.field(commentDiffPreviewsField).get(commentId);
    if (!preview) return;

    const currentText = view.state.doc.sliceString(preview.from, preview.to);
    if (currentText !== preview.originalText) {
      new Notice("Cannot apply edit: content has changed since preview.");
      return;
    }

    const insertText = view.state.toText(edit.proposedText);
    try {
      view.dispatch({
        changes: { from: preview.from, to: preview.to, insert: insertText },
        selection: { anchor: preview.from, head: preview.from + insertText.length },
        effects: [clearPreviewEffect.of(commentId)],
      });
    } catch (error) {
      logWarn("acceptEdit: dispatch failed", error);
      new Notice("Could not apply edit.");
      return;
    }

    const now = Date.now();
    commentStore.updateMessage(notePath, commentId, messageId, {
      suggestedEdit: { ...edit, status: "accepted", acceptedAt: now },
    });
    commentHighlights.remove(view, commentId);
  }

  private rejectEdit(
    view: EditorView,
    notePath: string,
    commentId: string,
    messageId: string
  ): void {
    const comment = commentStore.getComment(notePath, commentId);
    if (!comment) return;
    const message = comment.messages.find((m) => m.id === messageId);
    const edit = message?.suggestedEdit;
    if (!edit || edit.status !== "pending") return;

    commentStore.updateMessage(notePath, commentId, messageId, {
      suggestedEdit: { ...edit, status: "rejected", rejectedAt: Date.now() },
    });
    try {
      view.dispatch({ effects: clearPreviewEffect.of(commentId) });
    } catch (error) {
      logWarn("rejectEdit: failed to clear preview", error);
    }
  }

  private markSuggestedEditRejected(commentId: string): void {
    for (const notePath of commentStore.getAllNotePaths()) {
      const comment = commentStore.getComment(notePath, commentId);
      if (!comment) continue;
      const pending = [...comment.messages]
        .reverse()
        .find((m) => m.suggestedEdit?.status === "pending");
      if (!pending?.suggestedEdit) return;
      commentStore.updateMessage(notePath, commentId, pending.id, {
        suggestedEdit: { ...pending.suggestedEdit, status: "rejected", rejectedAt: Date.now() },
      });
      return;
    }
  }

  // -- Resolve / delete ------------------------------------------------------

  private toggleResolved(view: EditorView, notePath: string, commentId: string): void {
    const existing = commentStore.getComment(notePath, commentId);
    if (!existing) return;
    const nextState = existing.state === "resolved" ? "active" : "resolved";
    commentStore.setCommentState(notePath, commentId, nextState);
    if (nextState === "resolved") {
      commentHighlights.remove(view, commentId);
      this.overlayController.close();
    } else {
      // Try to re-add the highlight using the anchor.
      const resolved = resolveAnchor(view.state.doc.toString(), existing.anchor);
      if (resolved) {
        commentHighlights.add(view, {
          id: commentId,
          from: resolved.from,
          to: resolved.to,
        });
      } else {
        commentStore.setCommentState(notePath, commentId, "orphaned");
      }
    }
  }

  private deleteComment(view: EditorView, notePath: string, commentId: string): void {
    commentHighlights.remove(view, commentId);
    commentStore.removeComment(notePath, commentId);
    this.sessionManager.dispose(notePath, commentId);
    this.overlayController.close();
  }

  // -- File lifecycle --------------------------------------------------------

  private async onFileOpen(file: TFile): Promise<void> {
    const notePath = file.path;
    if (!this.loadedNotes.has(notePath)) {
      this.loadedNotes.add(notePath);
      await this.loadCommentsForNote(notePath);
    }
    this.restoreHighlightsForFile(file);
  }

  private async loadCommentsForNote(notePath: string): Promise<void> {
    const sidecar = await this.persistence.loadSidecarByNotePath(notePath);
    if (!sidecar) return;
    commentStore.setCommentsForNote(notePath, sidecar.comments);
  }

  private restoreHighlightsForFile(file: TFile): void {
    const view = this.findViewForNotePath(file.path);
    if (!view) return;
    const notePath = file.path;
    const comments = commentStore.getCommentsForNote(notePath);
    if (comments.length === 0) return;
    const docText = view.state.doc.toString();
    for (const c of comments) {
      if (c.state !== "active") continue;
      if (commentHighlights.get(view, c.id)) continue;
      const resolved = resolveAnchor(docText, c.anchor);
      if (resolved) {
        commentHighlights.add(view, {
          id: c.id,
          from: resolved.from,
          to: resolved.to,
        });
      } else {
        commentStore.setCommentState(notePath, c.id, "orphaned");
      }
    }
  }

  // -- Persistence scheduling ------------------------------------------------

  private async schedulePersistFor(notePath: string): Promise<void> {
    const comments = commentStore.getCommentsForNote(notePath);
    if (comments.length === 0) {
      // All comments removed — keep the sidecar (for history) but nothing to do.
      return;
    }
    const stableId = await this.persistence.ensureStableId(notePath);
    const sidecar = this.persistence.buildSidecar(stableId, notePath, comments);
    this.persistence.scheduleWrite(sidecar);
  }

  private async writeSidecarNow(notePath: string): Promise<void> {
    const comments = commentStore.getCommentsForNote(notePath);
    if (comments.length === 0) return;
    const stableId = await this.persistence.ensureStableId(notePath);
    const sidecar = this.persistence.buildSidecar(stableId, notePath, comments);
    await this.persistence.writeSidecarNow(sidecar);
  }

  // -- Helpers ---------------------------------------------------------------

  private captureActiveSelection(markdownView: MarkdownView): SelectionCapture | null {
    const view = markdownView.editor?.cm;
    if (!view) {
      new Notice("Could not access editor.");
      return null;
    }
    const sel = view.state.selection.main;
    if (sel.from === sel.to) {
      new Notice("Select text first to add a Copilot comment.");
      return null;
    }
    const exactText = view.state.doc.sliceString(sel.from, sel.to);
    return { view, from: sel.from, to: sel.to, exactText };
  }

  private buildAnchorFromSelection(capture: SelectionCapture): CommentAnchor {
    return captureAnchor({
      doc: capture.view.state.doc.toString(),
      from: capture.from,
      to: capture.to,
    });
  }

  private attachClickListener(view: EditorView): void {
    if (this.clickListeners.has(view)) return;
    const listener = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      const commentId = detail?.commentId;
      if (typeof commentId !== "string") return;
      const notePath = this.getNotePathForView(view);
      if (!notePath) return;
      this.openComment(view, notePath, commentId);
    };
    view.dom.addEventListener("copilot-comment-highlight-click", listener as EventListener);
    this.clickListeners.set(view, listener);
  }

  private getNotePathForView(view: EditorView): string | null {
    const leaf = this.getLeafForView(view);
    if (!leaf || !(leaf.view instanceof MarkdownView)) return null;
    return leaf.view.file?.path ?? null;
  }

  private getLeafForView(view: EditorView): WorkspaceLeaf | null {
    const leaves = this.plugin.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      if (leaf.view.editor?.cm === view) return leaf;
    }
    return null;
  }

  private findViewForNotePath(notePath: string): EditorView | null {
    const leaves = this.plugin.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      if (leaf.view.file?.path === notePath) {
        const cm = leaf.view.editor?.cm;
        if (cm) return cm;
      }
    }
    return null;
  }
}
