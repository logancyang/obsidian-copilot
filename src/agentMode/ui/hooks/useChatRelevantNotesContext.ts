import {
  parseFanoutComposite,
  renderFanoutComposite,
} from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useSelectedTextContexts, type ProjectConfig } from "@/aiParams";
import { useActiveFile } from "@/hooks/useActiveFile";
import { getMiyoFilePath, getMiyoFolderName } from "@/miyo/miyoUtils";
import {
  getChatRelevantNotesStore,
  type ChatRelevantNotesContext,
} from "@/search/chatRelevantNotesContext";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { App, TFile } from "obsidian";
import { useEffect, useMemo, useRef } from "react";

/** Publish composition snapshots to the vault's last-focused source.
 * @param app - Vault owner.
 * @param root - Chat surface in its current window.
 * @param id - Logical input identity, isolated across session/project switches.
 * @param draft - Current composition and its attachment setters.
 * @param messages - Visible message store, including in-flight response state.
 * @param project - Current project's explicit source configuration.
 */
export function useChatRelevantNotesContext(
  app: App,
  root: HTMLElement | null,
  id: string,
  draft: AgentInputDraftControls,
  messages: AgentChatMessage[],
  project: ProjectConfig | undefined
): void {
  const store = getChatRelevantNotesStore(app);
  const activeFile = useActiveFile();
  const [selections] = useSelectedTextContexts();
  const projectFiles = useMemo(() => {
    const { inclusions, exclusions } = getMatchingPatterns({
      ...project?.contextSource,
      isProject: true,
    });
    return inclusions
      ? app.vault
          .getFiles()
          .filter((file) => shouldIndexFile(app, file, inclusions, exclusions, true))
      : [];
  }, [app, project?.contextSource]);
  const completed = useRef<{ id: string; messages: AgentChatMessage[] }>({ id, messages });
  // A streaming turn is one retrieval update, when it settles; never send token deltas.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  if (completed.current.id !== id || !draft.loading) completed.current = { id, messages };
  const history = draft.loading
    ? messages.flatMap((message) => {
        if (message.sender === "user") return [message];
        const settled = completed.current.messages.find((previous) => previous.id === message.id);
        return settled ? [settled] : [];
      })
    : messages;
  const contexts = history.flatMap((message) => (message.context ? [message.context] : []));
  const files = [
    ...projectFiles,
    ...contexts.flatMap((context) => context.notes),
    ...draft.contextNotes,
    ...(draft.includeActiveNote && activeFile ? [activeFile] : []),
  ];
  const snapshot = {
    folder_name: getMiyoFolderName(app),
    messages: history
      .filter(
        (message) =>
          message.isVisible &&
          !message.isErrorMessage &&
          (message.sender === "user" || message.sender === "AI")
      )
      .map((message) => ({
        role: message.sender === "user" ? ("user" as const) : ("assistant" as const),
        content:
          (message.fanout ?? parseFanoutComposite(message.message))
            ? renderFanoutComposite(
                (message.fanout ?? parseFanoutComposite(message.message))!,
                (id) => id
              )
            : message.parts
              ? message.parts
                  .filter((part) => part.kind === "text")
                  .map((part) => part.text)
                  .join("\n")
              : message.message,
      }))
      .filter((message) => message.content.trim()),
    draft: draft.input,
    excerpts: [...contexts.flatMap((context) => context.selectedTextContexts ?? []), ...selections]
      .map((selection) => selection.content)
      .filter((text) => text.trim()),
    file_paths: [...new Set(files.map((file) => getMiyoFilePath(app, file.path)))],
    limit: 20,
  };
  const skippedAttachments =
    draft.images.length +
    contexts.reduce(
      (count, context) => count + context.urls.length + (context.webTabs?.length ?? 0),
      0
    ) +
    (draft.includeActiveWebTab ? 1 : 0);
  const key = JSON.stringify([id, snapshot, skippedAttachments]);
  const current = useMemo<ChatRelevantNotesContext>(
    () => ({
      id,
      request: snapshot,
      skippedAttachments,
      addFile: (path) => {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile)
          draft.setContextNotes((notes) =>
            notes.some((note) => note.path === path) ? notes : [...notes, file]
          );
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serialized context defines retrieval identity
    [key, app, draft.setContextNotes]
  );
  const currentRef = useRef(current);
  currentRef.current = current;
  const previousId = useRef(id);
  useEffect(() => {
    const ownedPrevious = store.getSnapshot()?.id === previousId.current;
    previousId.current = id;
    if (
      ownedPrevious ||
      (root?.doc.hasFocus() &&
        root.contains(root.doc.activeElement) &&
        !root.doc.activeElement?.closest("[data-relevant-notes]"))
    )
      store.select(current);
    else store.update(current);
  }, [store, current, root, id]);
  useEffect(() => {
    if (!root) return;
    const focus = (event: Event) => {
      // Shelf controls are inside AgentHome but must preserve the previous source.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
      if ((event.target as Element | null)?.closest?.("[data-relevant-notes]")) return;
      store.select(currentRef.current);
    };
    root.addEventListener("focusin", focus);
    root.addEventListener("pointerdown", focus);
    return () => {
      root.removeEventListener("focusin", focus);
      root.removeEventListener("pointerdown", focus);
    };
  }, [root, store]);
  useEffect(() => () => store.clear(currentRef.current.id), [store]);
}
