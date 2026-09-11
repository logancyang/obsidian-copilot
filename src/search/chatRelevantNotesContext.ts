import type { SkippedRelevantSource } from "@/search/findRelevantNotes";
import type { RelatedContextRequest } from "@/miyo/MiyoClient";

export interface ChatRelevantNotesContext {
  id: string;
  request: RelatedContextRequest;
  skippedAttachments: number;
  skippedSources?: readonly SkippedRelevantSource[];
  reviewContext?: () => void;
  addFile: (path: string) => void;
}

/** Owns the last focused chat for one vault; it never stores context on disk. */
export class ChatRelevantNotesStore {
  private current: ChatRelevantNotesContext | null = null;
  private listeners = new Set<() => void>();
  getSnapshot = (): ChatRelevantNotesContext | null => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  select(context: ChatRelevantNotesContext | null): void {
    if (this.current === context) return;
    this.current = context;
    this.listeners.forEach((listener) => listener());
  }
  update(context: ChatRelevantNotesContext): void {
    if (this.current?.id === context.id) this.select(context);
  }
  clear(id: string): void {
    if (this.current?.id === id) this.select(null);
  }
}

const stores = new WeakMap<object, ChatRelevantNotesStore>();
/** Share source selection across both hosts and popout windows in the same vault.
 * @param app - Vault owner, used only as an identity key.
 */
export function getChatRelevantNotesStore(app: object): ChatRelevantNotesStore {
  let store = stores.get(app);
  if (!store) {
    store = new ChatRelevantNotesStore();
    stores.set(app, store);
  }
  return store;
}
