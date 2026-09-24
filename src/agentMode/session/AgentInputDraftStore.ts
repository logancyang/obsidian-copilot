import type { BackendId, PromptContent } from "@/agentMode/session/types";
import { getSettings } from "@/settings/model";
import type { MessageContext } from "@/types/message";
import type { App, TFile } from "obsidian";

// Snapshotted at enqueue time so context (active note, selections) doesn't
// drift between when the user queues the message and when it actually flushes.
export interface QueuedAgentMessage {
  id: string;
  text: string;
  rawInput: string;
  context?: MessageContext;
  /**
   * Why the message entered the queue, snapshotted at enqueue time — an
   * enqueue reason, not a live "what's blocking now" (the blockers can evolve
   * before the queue drains; the label deliberately doesn't chase them).
   * Absent on combined flush items, which are sent immediately and never
   * rendered as queue rows.
   */
  queueReason?: "context" | "busy";
  /** Image blocks for the backend prompt. */
  promptContent?: PromptContent[];
  /**
   * Resolved answerer selection (the deduped `@`-mentioned installed agents).
   * Present only when the turn fans out; absent for the single-agent path (no
   * qualifying mentions, or only the main agent `@`-ed). Snapshotted at enqueue
   * time alongside the rest.
   */
  mentionedAgents?: ReadonlyArray<BackendId>;
}

/**
 * Per-chat-input compose state. Each logical input keeps its own draft so
 * unsent text, attachments, and queued follow-ups survive switching away and
 * back.
 *
 * `loading` (turn in flight) and `queue` live here too — a single shared flag
 * would bleed a backgrounded session's running state onto whichever session is
 * foregrounded. `selectedTextContexts` is deliberately NOT here: it's a global
 * ephemeral atom, snapshotted into the queued item at send time.
 */
export interface AgentInputDraft {
  input: string;
  images: File[];
  contextNotes: TFile[];
  includeActiveNote: boolean;
  includeActiveWebTab: boolean;
  loading: boolean;
  queue: QueuedAgentMessage[];
}

/**
 * Owns every Agent Chat composer draft, keyed by logical chat input id, outside
 * React so plugin code can write to a draft (e.g. attach a note) whether or not
 * the Agent Chat view is mounted. Liveness belongs to the session manager: the
 * store only drops drafts and writes for chat inputs the manager reports dead.
 */
export class AgentInputDraftStore {
  private readonly drafts = new Map<string, AgentInputDraft>();
  private readonly listeners = new Set<() => void>();

  /**
   * @param app - Source of the active note, which a fixed attachment supersedes.
   * @param isLive - Whether the session manager still owns a chat input.
   */
  constructor(
    private readonly app: App,
    private readonly isLive: (chatInputId: string) => boolean
  ) {}

  get(chatInputId: string): AgentInputDraft | undefined {
    return this.drafts.get(chatInputId);
  }

  /**
   * Replace one chat input's draft, seeding it from the user's settings on first write.
   * @param chatInputId - Logical composer whose draft changes.
   * @param updater - Derives the next draft; returning the same object is a no-op.
   */
  update(chatInputId: string, updater: (draft: AgentInputDraft) => AgentInputDraft): void {
    // A turn can resolve after its session was closed/replaced; don't let
    // that late update resurrect a pruned draft.
    if (!this.isLive(chatInputId)) return;
    const current = this.drafts.get(chatInputId) ?? createDraft();
    const next = updater(current);
    if (next === current) return;
    this.drafts.set(chatInputId, next);
    this.emit();
  }

  /**
   * Attach a note to a composer as fixed context, once.
   * @param chatInputId - Logical composer that receives the note.
   * @param note - Note to send with that composer's next message.
   */
  addContextNote(chatInputId: string, note: TFile): void {
    const activePath = this.app.workspace.getActiveFile()?.path;
    this.update(chatInputId, (draft) => {
      const hasNote = draft.contextNotes.some((existing) => existing.path === note.path);
      // The active note already has a dynamic badge. Keep only the fixed
      // attachment so it stays with this draft when the editor changes notes.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/579
      const includeActiveNote = draft.includeActiveNote && note.path !== activePath;
      if (hasNote && includeActiveNote === draft.includeActiveNote) return draft;
      return {
        ...draft,
        contextNotes: hasNote ? draft.contextNotes : [...draft.contextNotes, note],
        includeActiveNote,
      };
    });
  }

  /** Drop drafts whose chat input the session manager no longer owns. */
  prune(): void {
    for (const chatInputId of this.drafts.keys()) {
      if (!this.isLive(chatInputId)) this.drafts.delete(chatInputId);
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const createDraft = (): AgentInputDraft => ({
  input: "",
  images: [],
  contextNotes: [],
  includeActiveNote: getSettings().autoAddActiveContentToContext === true,
  includeActiveWebTab: false,
  loading: false,
  queue: [],
});
