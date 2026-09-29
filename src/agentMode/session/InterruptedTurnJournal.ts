import { logWarn } from "@/logger";
import type { BackendId, PromptContent } from "@/agentMode/session/types";
import type { MessageContext } from "@/types/message";
import { TFile, type App } from "obsidian";

// A turn's prompt has to survive the process that was running it, and its chat id only exists on
// this device, so the journal lives in vault-scoped local storage rather than synced settings.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/607
export const INTERRUPTED_TURN_JOURNAL_STORAGE_KEY = "copilot:agent-turn-journal:v1";

export interface RecordedPrompt {
  text: string;
  context?: MessageContext;
  promptContent?: PromptContent[];
  mentionedAgents?: ReadonlyArray<BackendId>;
}

export interface TurnJournalSink {
  record(chatKey: string, prompt: RecordedPrompt): void;
  clear(chatKey: string): void;
}

type StoredContext = Omit<MessageContext, "notes"> & { notes: string[] };

interface StoredPrompt {
  text: string;
  context?: StoredContext;
  promptContent?: PromptContent[];
  mentionedAgents?: BackendId[];
}

type StoredJournal = Record<string, StoredPrompt>;

function toStoredPrompt(prompt: RecordedPrompt, includeImages: boolean): StoredPrompt {
  return {
    text: prompt.text,
    context: prompt.context
      ? { ...prompt.context, notes: prompt.context.notes.map((note) => note.path) }
      : undefined,
    promptContent: includeImages
      ? prompt.promptContent
      : prompt.promptContent?.filter((block) => block.type !== "image"),
    mentionedAgents: prompt.mentionedAgents ? [...prompt.mentionedAgents] : undefined,
  };
}

function isStoredPrompt(value: unknown): value is StoredPrompt {
  if (typeof value !== "object" || value === null) return false;
  const stored = value as Record<string, unknown>;
  return typeof stored.text === "string";
}

/**
 * Holds the prompt of every in-flight agent turn in local storage so a chat cut off by a restart
 * can offer to continue it. It only stores and returns prompts; deciding when a chat counts as
 * interrupted belongs to the session manager that reads it when the chat is reopened.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/607
 */
export class InterruptedTurnJournal implements TurnJournalSink {
  private sealed = false;

  constructor(private readonly app: Pick<App, "loadLocalStorage" | "saveLocalStorage" | "vault">) {}

  record(chatKey: string, prompt: RecordedPrompt): void {
    if (this.sealed) return;
    const journal = this.readAll();
    journal[chatKey] = toStoredPrompt(prompt, true);
    if (this.writeAll(journal)) return;
    // Images can push a prompt past the browser storage quota. Keeping the text and context
    // still lets Retry re-send the request. https://github.com/Brevilabs/obsidian-copilot-private/issues/607
    journal[chatKey] = toStoredPrompt(prompt, false);
    this.writeAll(journal);
  }

  clear(chatKey: string): void {
    if (this.sealed) return;
    const journal = this.readAll();
    if (!(chatKey in journal)) return;
    delete journal[chatKey];
    this.writeAll(journal);
  }

  read(chatKey: string): RecordedPrompt | null {
    const stored = this.readAll()[chatKey];
    if (!stored) return null;
    const notes = (stored.context?.notes ?? [])
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile);
    return {
      text: stored.text,
      context: stored.context ? { ...stored.context, notes } : undefined,
      promptContent: stored.promptContent,
      mentionedAgents: stored.mentionedAgents,
    };
  }

  // Shutdown cancels running turns; those cancellations are not the turn ending on its own, so
  // they must not erase the record of what was in flight.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/607
  seal(): void {
    this.sealed = true;
  }

  private readAll(): StoredJournal {
    let raw: unknown;
    try {
      raw = this.app.loadLocalStorage(INTERRUPTED_TURN_JOURNAL_STORAGE_KEY);
    } catch (e) {
      logWarn("[AgentMode] could not read the interrupted-turn journal", e);
      return {};
    }
    if (typeof raw !== "string") return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => isStoredPrompt(value))
      );
    } catch {
      return {};
    }
  }

  private writeAll(journal: StoredJournal): boolean {
    try {
      this.app.saveLocalStorage(
        INTERRUPTED_TURN_JOURNAL_STORAGE_KEY,
        Object.keys(journal).length === 0 ? null : JSON.stringify(journal)
      );
      return true;
    } catch (e) {
      logWarn("[AgentMode] could not write the interrupted-turn journal", e);
      return false;
    }
  }
}
