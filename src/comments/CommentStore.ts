/**
 * CommentStore - in-memory storage for inline Copilot comments.
 *
 * Keyed by notePath, then commentId. UI and controllers subscribe via
 * `subscribe()` for change notifications.
 */

import { atom, createStore } from "jotai";
import type { Comment, CommentMessage, CommentState } from "./types";

const store = createStore();

export interface NoteCommentsSnapshot {
  notePath: string;
  comments: Comment[];
}

/** Map<notePath, Map<commentId, Comment>>. */
const commentsAtom = atom<Map<string, Map<string, Comment>>>(new Map());

type Listener = (notePath: string) => void;

class CommentStoreImpl {
  private listeners = new Set<Listener>();

  /** Subscribe to all changes. Listener receives the affected note path. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(notePath: string): void {
    for (const listener of this.listeners) listener(notePath);
  }

  getCommentsForNote(notePath: string): Comment[] {
    const all = store.get(commentsAtom);
    const noteMap = all.get(notePath);
    if (!noteMap) return [];
    return Array.from(noteMap.values());
  }

  getComment(notePath: string, commentId: string): Comment | null {
    const all = store.get(commentsAtom);
    return all.get(notePath)?.get(commentId) ?? null;
  }

  upsertComment(notePath: string, comment: Comment): void {
    const all = store.get(commentsAtom);
    const next = new Map(all);
    const noteMap = new Map(next.get(notePath) ?? []);
    noteMap.set(comment.id, { ...comment, updatedAt: Date.now() });
    next.set(notePath, noteMap);
    store.set(commentsAtom, next);
    this.notify(notePath);
  }

  removeComment(notePath: string, commentId: string): void {
    const all = store.get(commentsAtom);
    const noteMap = all.get(notePath);
    if (!noteMap?.has(commentId)) return;
    const next = new Map(all);
    const nextNoteMap = new Map(noteMap);
    nextNoteMap.delete(commentId);
    if (nextNoteMap.size === 0) {
      next.delete(notePath);
    } else {
      next.set(notePath, nextNoteMap);
    }
    store.set(commentsAtom, next);
    this.notify(notePath);
  }

  setCommentState(notePath: string, commentId: string, state: CommentState): void {
    const existing = this.getComment(notePath, commentId);
    if (!existing || existing.state === state) return;
    this.upsertComment(notePath, { ...existing, state });
  }

  appendMessage(notePath: string, commentId: string, message: CommentMessage): void {
    const existing = this.getComment(notePath, commentId);
    if (!existing) return;
    this.upsertComment(notePath, {
      ...existing,
      messages: [...existing.messages, message],
    });
  }

  updateMessage(
    notePath: string,
    commentId: string,
    messageId: string,
    patch: Partial<CommentMessage>
  ): void {
    const existing = this.getComment(notePath, commentId);
    if (!existing) return;
    const nextMessages = existing.messages.map((m) =>
      m.id === messageId ? { ...m, ...patch } : m
    );
    this.upsertComment(notePath, { ...existing, messages: nextMessages });
  }

  /** Replace all comments for a given note (e.g., after loading from disk). */
  setCommentsForNote(notePath: string, comments: Comment[]): void {
    const all = store.get(commentsAtom);
    const next = new Map(all);
    if (comments.length === 0) {
      next.delete(notePath);
    } else {
      const noteMap = new Map<string, Comment>();
      for (const c of comments) noteMap.set(c.id, c);
      next.set(notePath, noteMap);
    }
    store.set(commentsAtom, next);
    this.notify(notePath);
  }

  /** Returns all note paths that currently have at least one comment. */
  getAllNotePaths(): string[] {
    return Array.from(store.get(commentsAtom).keys());
  }
}

export const commentStore = new CommentStoreImpl();
export type { Listener as CommentStoreListener };
