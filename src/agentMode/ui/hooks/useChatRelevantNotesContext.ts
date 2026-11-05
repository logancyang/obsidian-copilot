import type { AgentChatMessage } from "@/agentMode/session/types";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { type ProjectConfig } from "@/aiParams";
import { useSelectedTextContexts } from "@/selection/selectionStore";
import { useActiveWebTabState } from "@/components/chat-components/hooks/useActiveWebTabState";
import { useActiveFile } from "@/hooks/useActiveFile";
import { RELATED_CONTEXT_MAX_FILE_PATHS } from "@/miyo/MiyoClient";
import { getMiyoFilePath, getMiyoFolderName } from "@/miyo/miyoUtils";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { getCachedProjectRecordById } from "@/projects/state";
import {
  getChatRelevantNotesStore,
  type ChatRelevantNotesContext,
} from "@/search/chatRelevantNotesContext";
import { getMatchingPatterns, isInternalExcludedFile, shouldIndexFile } from "@/search/searchUtils";
import { App, MarkdownView, type TFile } from "obsidian";
import { useEffect, useMemo, useRef } from "react";

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
  const selections = useSelectedTextContexts();
  // New chats include the web tab by default, which is not an attachment until a page is open.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/667
  const { activeWebTabForMentions } = useActiveWebTabState();
  const projectId = project?.id;
  const contextSource = project?.contextSource;
  const projectFiles = useMemo(() => {
    const { inclusions, exclusions } = getMatchingPatterns({ ...contextSource, isProject: true });
    const record = projectId ? getCachedProjectRecordById(projectId) : undefined;
    const folder =
      record && `${getProjectAnchorFromConfigPath(record.filePath).projectFolderPath}/`;
    // The project folder lives under the Copilot folder, which linked-item patterns never match.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/845
    const candidates = app.vault
      .getFiles()
      .filter(
        (file) =>
          (folder && file.path.startsWith(folder) && !isInternalExcludedFile(file)) ||
          (inclusions && shouldIndexFile(app, file, inclusions, exclusions, true))
      );
    const linkedNotes = { notePatterns: inclusions?.notePatterns };
    const linked = new Set(
      candidates.filter((file) => shouldIndexFile(app, file, linkedNotes, exclusions, true))
    );
    const newestFirst = (a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime;
    // Miyo skips project-folder files while Copilot's registration excludes its folder, so they
    // rank by recency after linked notes and cannot push linked notes past the path cap.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/845
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/847
    return [...linked, ...candidates.filter((file) => !linked.has(file)).sort(newestFirst)];
  }, [app, projectId, contextSource]);
  // The unfinished assistant tail belongs to the running turn. Derive that
  // boundary on mount and session changes instead of retaining partial text.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  const tail = messages[messages.length - 1];
  const streamingId =
    draft.loading && tail?.sender === "AI" && !tail.turnStopReason ? tail.id : undefined;
  const history = messages.filter((message) => message.id !== streamingId);
  const queued = draft.queue;
  const contexts = [...history, ...queued].flatMap((message) =>
    message.context ? [message.context] : []
  );
  const files = [
    ...contexts.flatMap((context) => context.notes),
    ...draft.contextNotes,
    ...(draft.includeActiveNote && activeFile ? [activeFile] : []),
    ...projectFiles,
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
    // Miyo rejects the whole request past its path limit, so the chat's own and linked notes
    // take the first slots and the oldest project files are dropped.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/845
    file_paths: [...new Set(files.map((file) => getMiyoFilePath(app, file.path)))].slice(
      0,
      RELATED_CONTEXT_MAX_FILE_PATHS
    ),
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
    (draft.includeActiveWebTab && activeWebTabForMentions ? 1 : 0);
  // Equal retrieval content must keep its identity across streaming renders.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/383
  const key = JSON.stringify({ id, request: snapshot, skippedAttachments });
  const current = useMemo(() => JSON.parse(key) as ChatRelevantNotesContext, [key]);
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
