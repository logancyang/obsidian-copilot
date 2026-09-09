import { getChatRelevantNotesStore } from "@/search/chatRelevantNotesContext";
import { findChatRelevantNotes } from "@/search/findChatRelevantNotes";
import type { RelevantNotesResult } from "@/search/findRelevantNotes";
import { App, MarkdownView } from "obsidian";
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
 * @param mock - Explicit fixture mode for local UI verification.
 */
export function useChatRelevantNotes(
  app: App,
  enabled: boolean,
  connectionKey: string,
  mock: boolean
) {
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
  const [settled, setSettled] = useState<{ id: string; result: RelevantNotesResult } | null>(null);
  const [revision, setRevision] = useState(0);
  const previous = useRef<{ id: string; draft: string | undefined } | null>(null);
  useEffect(() => {
    const ref = app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView) store.select(null);
    });
    return () => app.workspace.offref(ref);
  }, [app, store]);
  useEffect(() => {
    if (!context) {
      previous.current = null;
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
        void findChatRelevantNotes(app, context, mock).then((result) => {
          if (!cancelled) setSettled({ id: context.id, result });
        });
      },
      draftChanged || (!settled && context.request.draft?.trim()) ? 500 : 0
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [app, context, connectionKey, mock, revision]); // eslint-disable-line react-hooks/exhaustive-deps -- settled rows must not retrigger retrieval
  return {
    context,
    result: settled && settled.id === context?.id ? settled.result : LOADING,
    refresh: () => setRevision((value) => value + 1),
  };
}
