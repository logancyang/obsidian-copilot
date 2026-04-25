/**
 * CommentSessionManager - owns per-comment agent sessions.
 *
 * One `CommentAgentSession` per (notePath, commentId). Sessions outlive the
 * popover component so the agent can finish running in the background when
 * the user closes the popover or moves to another comment.
 */
import type CopilotPlugin from "@/main";
import { CommentAgentSession, type CommentAgentSessionState } from "./CommentAgentSession";

function keyFor(notePath: string, commentId: string): string {
  return `${notePath}::${commentId}`;
}

export interface CommentSessionStateEvent {
  notePath: string;
  commentId: string;
  state: CommentAgentSessionState;
}

type GlobalListener = (event: CommentSessionStateEvent) => void;

export class CommentSessionManager {
  private sessions = new Map<string, CommentAgentSession>();
  private sessionUnsubs = new Map<string, () => void>();
  private globalListeners = new Set<GlobalListener>();

  constructor(private readonly plugin: CopilotPlugin) {}

  getOrCreate(notePath: string, commentId: string): CommentAgentSession {
    const key = keyFor(notePath, commentId);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const session = new CommentAgentSession({ plugin: this.plugin, notePath, commentId });
    this.sessions.set(key, session);
    const unsub = session.subscribe((state) => {
      for (const listener of this.globalListeners) {
        listener({ notePath, commentId, state });
      }
    });
    this.sessionUnsubs.set(key, unsub);
    return session;
  }

  get(notePath: string, commentId: string): CommentAgentSession | null {
    return this.sessions.get(keyFor(notePath, commentId)) ?? null;
  }

  /**
   * Subscribe to every session's state changes. Useful for UI layers (e.g.
   * the editor's streaming-indicator extension) that need to react to
   * streaming starting/stopping for any comment.
   */
  onAnyStateChange(listener: GlobalListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  dispose(notePath: string, commentId: string): void {
    const key = keyFor(notePath, commentId);
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessionUnsubs.get(key)?.();
    this.sessionUnsubs.delete(key);
    session.dispose();
    this.sessions.delete(key);
    for (const listener of this.globalListeners) {
      listener({
        notePath,
        commentId,
        state: { isStreaming: false, streamingText: "" },
      });
    }
  }

  disposeAll(): void {
    for (const unsub of this.sessionUnsubs.values()) unsub();
    this.sessionUnsubs.clear();
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }
}
