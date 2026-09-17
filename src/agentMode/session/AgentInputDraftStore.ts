import type { BackendId, PromptContent } from "@/agentMode/session/types";
import { getSettings } from "@/settings/model";
import type { MessageContext } from "@/types/message";
import type { App, TFile } from "obsidian";

export interface QueuedAgentMessage {
  id: string;
  text: string;
  rawInput: string;
  context?: MessageContext;
  queueReason?: "context" | "busy";
  promptContent?: PromptContent[];
  mentionedAgents?: ReadonlyArray<string>;
}

export interface AgentInputDraft {
  input: string;
  images: File[];
  contextNotes: TFile[];
  includeActiveNote: boolean;
  includeActiveWebTab: boolean;
  loading: boolean;
  queue: QueuedAgentMessage[];
}

export class AgentInputDraftStore {
  private readonly drafts = new Map<string, AgentInputDraft>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly app: App,
    private readonly isLive: (chatInputId: string) => boolean
  ) {}

  get(chatInputId: string): AgentInputDraft | undefined {
    return this.drafts.get(chatInputId);
  }

  update(chatInputId: string, updater: (draft: AgentInputDraft) => AgentInputDraft): void {
    if (!this.isLive(chatInputId)) return;
    const current = this.drafts.get(chatInputId) ?? createDraft();
    const next = updater(current);
    if (next === current) return;
    this.drafts.set(chatInputId, next);
    this.emit();
  }

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
