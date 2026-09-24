import type {
  AgentInputDraft,
  AgentInputDraftStore,
  QueuedAgentMessage,
} from "@/agentMode/session/AgentInputDraftStore";
import { TFile } from "obsidian";
import React, { useCallback, useMemo, useSyncExternalStore } from "react";

interface UseAgentInputDraftsArgs {
  /** Manager-owned drafts for every live chat input. */
  store: AgentInputDraftStore;
  /** Chat input whose draft the returned controls read and write. */
  chatInputId: string;
  /** Include-active-note toggle shown before the input's first edit (the user setting). */
  defaultIncludeActiveNote: boolean;
}

export interface AgentInputDraftControls extends AgentInputDraft {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  /** Attach a note as fixed context once; see {@link AgentInputDraftStore.addContextNote}. */
  addContextNote: (note: TFile) => void;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
  addImages: (files: File[]) => void;
  setIncludeActiveNote: (include: boolean) => void;
  setIncludeActiveWebTab: (include: boolean) => void;
  setLoading: (loading: boolean) => void;
  setQueue: React.Dispatch<React.SetStateAction<QueuedAgentMessage[]>>;
  /** Clear the compose fields after a send; leaves loading/queue untouched. */
  resetCompose: () => void;
}

// Frozen empties so a not-yet-edited draft reads as referentially stable
// arrays (no fresh `[]` that would defeat memo/identity checks downstream).
const EMPTY_IMAGES = Object.freeze([]) as unknown as File[];
const EMPTY_CONTEXT_NOTES = Object.freeze([]) as unknown as TFile[];
const EMPTY_QUEUE = Object.freeze([]) as unknown as QueuedAgentMessage[];

const applyState = <T>(value: React.SetStateAction<T>, previous: T): T =>
  typeof value === "function" ? (value as (previous: T) => T)(previous) : value;

/**
 * Bind the composer to one chat input's draft in the manager-owned store, so
 * switching tabs swaps drafts instead of remounting and discarding input.
 */
export function useAgentInputDrafts({
  store,
  chatInputId,
  defaultIncludeActiveNote,
}: UseAgentInputDraftsArgs): AgentInputDraftControls {
  const active = useSyncExternalStore(store.subscribe, () => store.get(chatInputId));

  const updateActive = useCallback(
    (updater: (draft: AgentInputDraft) => AgentInputDraft) => store.update(chatInputId, updater),
    [store, chatInputId]
  );

  const setInput = useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => updateActive((draft) => ({ ...draft, input: applyState(value, draft.input) })),
    [updateActive]
  );

  const setContextNotes = useCallback<React.Dispatch<React.SetStateAction<TFile[]>>>(
    (value) =>
      updateActive((draft) => ({
        ...draft,
        contextNotes: applyState(value, draft.contextNotes),
      })),
    [updateActive]
  );

  const addContextNote = useCallback(
    (note: TFile) => store.addContextNote(chatInputId, note),
    [store, chatInputId]
  );

  const setSelectedImages = useCallback<React.Dispatch<React.SetStateAction<File[]>>>(
    (value) => updateActive((draft) => ({ ...draft, images: applyState(value, draft.images) })),
    [updateActive]
  );

  const addImages = useCallback(
    (files: File[]) => updateActive((draft) => ({ ...draft, images: [...draft.images, ...files] })),
    [updateActive]
  );

  const setIncludeActiveNote = useCallback(
    (includeActiveNote: boolean) => updateActive((draft) => ({ ...draft, includeActiveNote })),
    [updateActive]
  );

  const setIncludeActiveWebTab = useCallback(
    (includeActiveWebTab: boolean) => updateActive((draft) => ({ ...draft, includeActiveWebTab })),
    [updateActive]
  );

  const setLoading = useCallback(
    (loading: boolean) => updateActive((draft) => ({ ...draft, loading })),
    [updateActive]
  );

  const setQueue = useCallback<React.Dispatch<React.SetStateAction<QueuedAgentMessage[]>>>(
    (value) => updateActive((draft) => ({ ...draft, queue: applyState(value, draft.queue) })),
    [updateActive]
  );

  // DESIGN NOTE: resetCompose hard-clears includeActiveNote to false after a
  // send, so within one session the active note auto-attaches only to the
  // FIRST message. Two scenarios, only one of which matches the legacy
  // AgentChat:
  //   1. Consecutive sends in the same session — IDENTICAL to legacy. The old
  //      AgentChat also did setIncludeActiveNote(false) after send and never
  //      re-seeded it within a mount, so its 2nd+ messages also dropped the
  //      auto-add. No change.
  //   2. Switching back to an already-used session — DELIBERATELY DIFFERENT.
  //      The old surface remounted on every tab switch (`key={internalId}`),
  //      so re-entering a session re-ran useState and re-seeded the toggle to
  //      the setting (#2525) — a side effect of the remount, not an intended
  //      feature. PR1 dropped the remount; re-entering a session now restores
  //      that session's saved draft (toggle already false from its last send).
  //      This is the point of per-chat-input drafts: a chat reads back exactly
  //      as you left it, not silently re-toggled. A genuinely fresh session
  //      still seeds from the setting (see the store's createDraft and the
  //      missing-draft fallback below), so "new chat" honors the setting.
  // If a future review flags "auto-add only works on the first message" or
  // "re-entering a session doesn't re-enable auto-add", point them at this note.
  const resetCompose = useCallback(
    () =>
      updateActive((draft) => ({
        ...draft,
        input: "",
        images: [],
        contextNotes: [],
        includeActiveNote: false,
        includeActiveWebTab: false,
      })),
    [updateActive]
  );

  const fields = useMemo<AgentInputDraft>(
    () =>
      active ?? {
        input: "",
        images: EMPTY_IMAGES,
        contextNotes: EMPTY_CONTEXT_NOTES,
        includeActiveNote: defaultIncludeActiveNote,
        includeActiveWebTab: false,
        loading: false,
        queue: EMPTY_QUEUE,
      },
    [active, defaultIncludeActiveNote]
  );

  // Referentially stable controls object: `fields` is memoized above and every
  // setter is a useCallback, so this only changes when the active draft does —
  // NOT on the shell's per-token re-renders. AgentHome owns this hook and passes
  // the object down to the memoized AgentChatInput; an unstable identity here
  // would defeat that memo and re-render the composer on every streamed token.
  return useMemo(
    () => ({
      ...fields,
      setInput,
      setContextNotes,
      addContextNote,
      setSelectedImages,
      addImages,
      setIncludeActiveNote,
      setIncludeActiveWebTab,
      setLoading,
      setQueue,
      resetCompose,
    }),
    [
      fields,
      setInput,
      setContextNotes,
      addContextNote,
      setSelectedImages,
      addImages,
      setIncludeActiveNote,
      setIncludeActiveWebTab,
      setLoading,
      setQueue,
      resetCompose,
    ]
  );
}
