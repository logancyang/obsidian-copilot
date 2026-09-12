import { useActiveWebTabState } from "@/components/chat-components/hooks/useActiveWebTabState";
import { logError } from "@/logger";
import type { WorkspaceLeaf } from "obsidian";
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
import { App, MarkdownView, TFile } from "obsidian";
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
  const { activeWebTabForMentions } = useActiveWebTabState();
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
  // The unfinished assistant tail belongs to the running turn. Derive that
  // boundary on mount and session changes instead of retaining partial text.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  const tail = messages[messages.length - 1];
  const streamingId =
    draft.loading && tail?.sender === "AI" && !tail.turnStopReason ? tail.id : undefined;
  const history = messages.filter((message) => message.id !== streamingId);
  // Queue entries remain visible after the composer resets and before dispatch.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  const queued = draft.queue;
  const contexts = [...history, ...queued].flatMap((message) =>
    message.context ? [message.context] : []
  );
  const files = [
    ...projectFiles,
    ...contexts.flatMap((context) => context.notes),
    ...draft.contextNotes,
    ...(draft.includeActiveNote && activeFile ? [activeFile] : []),
  ];
  const snapshot = {
    folder_name: getMiyoFolderName(app),
    messages: [
      ...history
        .filter(
          (message) =>
            message.isVisible &&
            !message.isErrorMessage &&
            (message.sender === "user" || message.sender === "AI")
        )
        .map((message) => ({
          role: message.sender === "user" ? ("user" as const) : ("assistant" as const),
          content: message.parts
            ? message.parts
                .filter((part) => part.kind === "text")
                .map((part) => part.text)
                .join("\n")
            : message.message,
        }))
        .filter((message) => message.content.trim()),
      ...queued
        .filter((message) => message.rawInput.trim())
        .map((message) => ({ role: "user" as const, content: message.rawInput })),
    ],
    draft: draft.input,
    excerpts: [...contexts.flatMap((context) => context.selectedTextContexts ?? []), ...selections]
      .map((selection) => selection.content)
      .filter((text) => text.trim()),
    file_paths: [...new Set(files.map((file) => getMiyoFilePath(app, file.path)))],
    limit: 20,
  };
  // Sent images remain unsupported after the composer resets into chat history.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  const skippedAttachments =
    draft.images.length +
    history.reduce(
      (count, message) =>
        count +
        (message.content?.filter(
          (part) =>
            typeof part === "object" && part !== null && "type" in part && part.type === "image_url"
        ).length ?? 0),
      0
    ) +
    queued.reduce(
      (count, message) =>
        count + (message.promptContent?.filter((part) => part.type === "image").length ?? 0),
      0
    ) +
    contexts.reduce(
      (count, context) => count + context.urls.length + (context.webTabs?.length ?? 0),
      0
    ) +
    (draft.includeActiveWebTab ? 1 : 0);
  // Keep only available display identities: sent/queued image names are not retained.
  // Their existing count remains, so the pane can honestly identify unnamed omissions.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/420
  const skippedSources = [
    ...draft.images.map((file) => ({
      label: file.name,
      reason: "Image attachments are not included in relevance requests",
    })),
    ...contexts.flatMap((context) =>
      context.urls.map((url) => ({
        label: url,
        reason: "Web URLs are not included in relevance requests",
      }))
    ),
    ...[
      ...contexts.flatMap((context) => context.webTabs ?? []),
      ...(draft.includeActiveWebTab && activeWebTabForMentions ? [activeWebTabForMentions] : []),
    ].map((tab) => ({
      label: tab.title ? `${tab.title} — ${tab.url}` : tab.url,
      reason: "Web tabs are not included in relevance requests",
    })),
  ];
  // Equal retrieval content must keep its identity across streaming renders.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  const key = JSON.stringify({
    id,
    request: snapshot,
    skippedAttachments,
    ...(skippedSources.length ? { skippedSources } : {}),
  });
  const { setContextNotes } = draft;
  const current = useMemo<ChatRelevantNotesContext>(
    () => ({
      ...(JSON.parse(key) as Omit<ChatRelevantNotesContext, "addFile" | "reviewContext">),
      reviewContext: root
        ? () => {
            // Reveal the owning leaf before focus: the separate pane may live in another window.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/420
            let owner: WorkspaceLeaf | undefined;
            app.workspace.iterateAllLeaves((leaf) => {
              if (leaf.view.containerEl.contains(root)) owner = leaf;
            });
            if (!owner) return;
            void Promise.resolve(app.workspace.revealLeaf(owner))
              .then(() => {
                const composer = root.querySelector<HTMLElement>("[data-chat-context-controls]");
                root.ownerDocument.defaultView?.focus();
                composer?.focus();
                composer?.scrollIntoView({ block: "nearest" });
              })
              .catch((error) => logError("Failed to reveal chat context.", error));
          }
        : undefined,
      addFile: (path) => {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile)
          setContextNotes((notes) =>
            notes.some((note) => note.path === path) ? notes : [...notes, file]
          );
      },
    }),
    [key, app, setContextNotes, root]
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
        !root.doc.activeElement?.closest(
          '[data-relevant-notes], [data-section-id="relevant-notes"]'
        ))
    )
      store.select(current);
    else store.update(current);
  }, [store, current, root, id]);
  useEffect(() => {
    // The source owner stays mounted while both recommendation hosts are closed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
    const ref = app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView) store.select(null);
    });
    return () => app.workspace.offref(ref);
  }, [app, store]);
  useEffect(() => {
    if (!root) return;
    const focus = (event: Event) => {
      // Shelf controls are inside AgentHome but must preserve the previous source.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
      if (
        (event.target as Element | null)?.closest?.(
          '[data-relevant-notes], [data-section-id="relevant-notes"]'
        )
      )
        return;
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
