import { getChatRelevantNotesStore } from "@/search/chatRelevantNotesContext";
import { findChatRelevantNotes } from "@/search/findChatRelevantNotes";
import type { RelevantNotesResult } from "@/search/findRelevantNotes";
import { App } from "obsidian";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const LOADING = Object.freeze({
  notes: Object.freeze([]),
  status: "loading" as const,
  details: undefined,
});
/** Follow the last focused chat, debouncing only draft edits.
 * @param app - Vault and workspace source.
 * @param enabled - Whether Live is enabled.
 * @param connectionKey - Endpoint/credential identity invalidating outstanding work.
 */
export function useChatRelevantNotes(app: App, enabled: boolean, connectionKey: string) {
  const store = getChatRelevantNotesStore(app);
  const selected = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const request = selected?.request;
  const hasContext =
    request &&
    (request.draft?.trim() ||
      request.messages?.length ||
      request.excerpts?.length ||
      request.file_paths?.length ||
      selected.skippedAttachments);
  const context = enabled && hasContext ? selected : null;
  const [settled, setSettled] = useState<{
    id: string;
    connectionKey: string;
    result: RelevantNotesResult;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  // Completion controls the initial debounce without making results a search trigger.
  const hasSettled = useRef(false);
  const previous = useRef<{ id: string; draft: string | undefined } | null>(null);
  useEffect(() => {
    if (!context) {
      previous.current = null;
      hasSettled.current = false;
      setSettled(null);
      return;
    }
    let cancelled = false;
    const draftChanged =
      previous.current?.id === context.id && previous.current.draft !== context.request.draft;
    previous.current = { id: context.id, draft: context.request.draft };
    // Keep rows while refreshing one chat, but never carry another session's rows across.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
    const timer = window.setTimeout(
      () => {
        void findChatRelevantNotes(app, context).then((result) => {
          if (!cancelled) {
            hasSettled.current = true;
            setSettled({ id: context.id, connectionKey, result });
          }
        });
      },
      draftChanged || (!hasSettled.current && context.request.draft?.trim()) ? 500 : 0
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [app, context, connectionKey, revision]);
  // Results from an old server or credential scope must disappear immediately.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  const result =
    settled && settled.id === context?.id && settled.connectionKey === connectionKey
      ? settled.result
      : LOADING;
  // Unsupported chat retrieval must leave the existing editor-note flow usable.
  // Empty context and real retrieval failures still belong to the selected chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  return {
    context: result.status === "unsupported-service" ? null : context,
    result,
    refresh: () => setRevision((value) => value + 1),
  };
}
