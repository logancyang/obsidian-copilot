import type { BackendId, PromptContent } from "@/agentMode/session/types";
import type { MessageContext } from "@/types/message";
import { TFile } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Snapshotted at enqueue time so context (active note, selections) doesn't
// drift between when the user queues the message and when it actually flushes.
export interface QueuedAgentMessage {
  id: string;
  text: string;
  rawInput: string;
  context?: MessageContext;
  /** Image blocks for the backend prompt. */
  promptContent?: PromptContent[];
  /**
   * Resolved answerer selection (the deduped `@`-mentioned installed agents).
   * Present only when the turn fans out; absent for the single-agent path (no
   * qualifying mentions, or only the main agent `@`-ed). Snapshotted at enqueue
   * time alongside the rest.
   */
  mentionedAgents?: ReadonlyArray<BackendId>;
}

/**
 * Per-session compose state. Replaces the old `key={internalId}` remount of
 * the chat surface: instead of throwing away and rebuilding input state on
 * every tab switch, each session keeps its own draft so unsent text,
 * attachments, and queued follow-ups survive switching away and back.
 *
 * `loading` (turn in flight) and `queue` live here too — without the remount
 * to reset them per session, a single shared flag would bleed a backgrounded
 * session's running state onto whichever session is foregrounded.
 * `selectedTextContexts` is deliberately NOT here: it's a global ephemeral
 * atom, snapshotted into the queued item at send time.
 */
export interface AgentInputDraft {
  input: string;
  images: File[];
  contextNotes: TFile[];
  includeActiveNote: boolean;
  includeActiveWebTab: boolean;
  loading: boolean;
  queue: QueuedAgentMessage[];
}

interface UseAgentInputDraftsArgs {
  activeSessionId: string;
  /** Internal ids of all live sessions; drafts for ids not here are pruned. */
  liveSessionIds: readonly string[];
  /** Seed for a fresh draft's include-active-note toggle (the user setting). */
  defaultIncludeActiveNote: boolean;
}

export interface AgentInputDraftControls extends AgentInputDraft {
  setInput: (input: string) => void;
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  setSelectedImages: React.Dispatch<React.SetStateAction<File[]>>;
  addImages: (files: File[]) => void;
  setIncludeActiveNote: (include: boolean) => void;
  setIncludeActiveWebTab: (include: boolean) => void;
  setLoading: (loading: boolean) => void;
  setQueue: React.Dispatch<React.SetStateAction<QueuedAgentMessage[]>>;
  /**
   * Carry a compose draft from a replaced session onto its replacement, so text
   * typed during an in-place session swap (e.g. the empty-landing context
   * refresh) survives the old session's pruning. No-op when the source draft is
   * empty or the target already holds user input. See {@link migrateDraft}.
   */
  migrateDraft: (fromSessionId: string, toSessionId: string) => void;
  /** Clear the compose fields after a send; leaves loading/queue untouched. */
  resetCompose: () => void;
}

// Frozen empties so a missing-session read returns referentially stable
// arrays (no fresh `[]` that would defeat memo/identity checks downstream).
const EMPTY_IMAGES = Object.freeze([]) as unknown as File[];
const EMPTY_CONTEXT_NOTES = Object.freeze([]) as unknown as TFile[];
const EMPTY_QUEUE = Object.freeze([]) as unknown as QueuedAgentMessage[];

const createDraft = (includeActiveNote: boolean): AgentInputDraft => ({
  input: "",
  images: [],
  contextNotes: [],
  includeActiveNote,
  includeActiveWebTab: false,
  loading: false,
  queue: [],
});

const applyArrayState = <T>(value: React.SetStateAction<T[]>, previous: T[]): T[] =>
  typeof value === "function" ? value(previous) : value;

/**
 * Whether a draft carries anything worth preserving across a session swap —
 * any composed text/attachments/queue, or a toggle the user moved off its seed.
 * An untouched draft migrates to nothing, so the swap stays a clean reset.
 */
const hasDraftPayload = (draft: AgentInputDraft, defaultIncludeActiveNote: boolean): boolean =>
  draft.input.length > 0 ||
  draft.images.length > 0 ||
  draft.contextNotes.length > 0 ||
  draft.queue.length > 0 ||
  draft.includeActiveNote !== defaultIncludeActiveNote ||
  draft.includeActiveWebTab;

export function useAgentInputDrafts({
  activeSessionId,
  liveSessionIds,
  defaultIncludeActiveNote,
}: UseAgentInputDraftsArgs): AgentInputDraftControls {
  const [drafts, setDrafts] = useState<Record<string, AgentInputDraft>>({});

  // Stable key so the prune effect only fires when the set of live sessions
  // actually changes, not on every parent re-render (the array prop is a
  // fresh reference each render).
  const liveKey = liveSessionIds.join("\0");
  const liveSetRef = useRef<Set<string>>(new Set(liveSessionIds));

  useEffect(() => {
    const live = new Set(liveSessionIds);
    liveSetRef.current = live;
    setDrafts((prev) => {
      let changed = false;
      const next: Record<string, AgentInputDraft> = {};
      for (const [sessionId, draft] of Object.entries(prev)) {
        if (live.has(sessionId)) next[sessionId] = draft;
        else changed = true;
      }
      return changed ? next : prev;
    });
    // liveSessionIds is re-derived each render; gate on its stable join key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  const updateDraft = useCallback(
    (sessionId: string, updater: (draft: AgentInputDraft) => AgentInputDraft) => {
      setDrafts((prev) => {
        // A turn can resolve after its session was closed/replaced; don't let
        // that late update resurrect a pruned draft.
        if (!liveSetRef.current.has(sessionId)) return prev;
        const current = prev[sessionId] ?? createDraft(defaultIncludeActiveNote);
        const next = updater(current);
        if (next === current) return prev;
        return { ...prev, [sessionId]: next };
      });
    },
    [defaultIncludeActiveNote]
  );

  const updateActive = useCallback(
    (updater: (draft: AgentInputDraft) => AgentInputDraft) => updateDraft(activeSessionId, updater),
    [activeSessionId, updateDraft]
  );

  const setInput = useCallback(
    (input: string) => updateActive((draft) => ({ ...draft, input })),
    [updateActive]
  );

  const setContextNotes = useCallback<React.Dispatch<React.SetStateAction<TFile[]>>>(
    (value) =>
      updateActive((draft) => ({
        ...draft,
        contextNotes: applyArrayState(value, draft.contextNotes),
      })),
    [updateActive]
  );

  const setSelectedImages = useCallback<React.Dispatch<React.SetStateAction<File[]>>>(
    (value) =>
      updateActive((draft) => ({ ...draft, images: applyArrayState(value, draft.images) })),
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
    (value) => updateActive((draft) => ({ ...draft, queue: applyArrayState(value, draft.queue) })),
    [updateActive]
  );

  // Move a draft onto a replacement session id during an in-place swap. Writes
  // `setDrafts` DIRECTLY (not via `updateDraft`) on purpose: the new id isn't in
  // `liveSetRef` yet — React hasn't observed the manager's new session list when
  // the swap resolves — so `updateDraft`'s live-guard would drop the write. The
  // caller runs this synchronously the moment `replaceSessionInPlace` resolves,
  // while the old session's `closeSession` is still suspended at `await cancel()`
  // (it deletes the session only afterwards), so the source draft is still
  // present here and the prune effect only fires later. `loading` resets — the
  // replacement starts its own turn.
  const migrateDraft = useCallback(
    (fromSessionId: string, toSessionId: string) => {
      if (fromSessionId === toSessionId) return;
      setDrafts((prev) => {
        const source = prev[fromSessionId];
        if (!source || !hasDraftPayload(source, defaultIncludeActiveNote)) return prev;
        // Never clobber input the user already started on the replacement.
        const target = prev[toSessionId];
        if (target && hasDraftPayload(target, defaultIncludeActiveNote)) return prev;
        const next = { ...prev };
        delete next[fromSessionId];
        next[toSessionId] = {
          ...source,
          images: [...source.images],
          contextNotes: [...source.contextNotes],
          queue: [...source.queue],
          loading: false,
        };
        return next;
      });
    },
    [defaultIncludeActiveNote]
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
  //      This is the point of per-session drafts: a session reads back exactly
  //      as you left it, not silently re-toggled. A genuinely fresh session
  //      still seeds from defaultIncludeActiveNote (see createDraft and the
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

  const active = drafts[activeSessionId];
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
      setSelectedImages,
      addImages,
      setIncludeActiveNote,
      setIncludeActiveWebTab,
      setLoading,
      setQueue,
      migrateDraft,
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
      migrateDraft,
      resetCompose,
    ]
  );
}
