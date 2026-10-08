import type {
  AgentInputDraft,
  AgentInputDraftStore,
  QueuedAgentMessage,
} from "@/agentMode/session/AgentInputDraftStore";
import { TFile } from "obsidian";
import React, { useCallback, useMemo, useSyncExternalStore } from "react";

interface UseAgentInputDraftsArgs {
  store: AgentInputDraftStore;
  chatInputId: string;
}

export interface AgentInputDraftControls extends AgentInputDraft {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
  addImages: (files: File[]) => void;
  setIncludeActiveNote: (include: boolean) => void;
  setIncludeActiveWebTab: (include: boolean) => void;
  setLoading: (loading: boolean) => void;
  setQueue: React.Dispatch<React.SetStateAction<QueuedAgentMessage[]>>;
  resetCompose: () => void;
}

const EMPTY_IMAGES = Object.freeze([]) as unknown as File[];
const EMPTY_CONTEXT_NOTES = Object.freeze([]) as unknown as TFile[];
const EMPTY_QUEUE = Object.freeze([]) as unknown as QueuedAgentMessage[];

const applyState = <T>(value: React.SetStateAction<T>, previous: T): T =>
  typeof value === "function" ? (value as (previous: T) => T)(previous) : value;

export function useAgentInputDrafts({
  store,
  chatInputId,
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

  const resetCompose = useCallback(
    () =>
      updateActive((draft) => ({
        ...draft,
        input: "",
        images: [],
        contextNotes: [],
        includeActiveNote: false,
      })),
    [updateActive]
  );

  const fields = useMemo<AgentInputDraft>(
    () =>
      active ?? {
        input: "",
        images: EMPTY_IMAGES,
        contextNotes: EMPTY_CONTEXT_NOTES,
        includeActiveNote: true,
        includeActiveWebTab: true,
        loading: false,
        queue: EMPTY_QUEUE,
      },
    [active]
  );

  return useMemo(
    () => ({
      ...fields,
      setInput,
      setContextNotes,
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
