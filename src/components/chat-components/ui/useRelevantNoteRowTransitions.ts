import type { RelevantNoteEntry } from "@/search/findRelevantNotes";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How long a row that left the results stays mounted so it can fade out. */
export const ROW_EXIT_MS = 200;

/** How long a row takes to slide to its new rank. */
export const ROW_MOVE_MS = 280;

const ROW_MOVE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** A sub-pixel drift is layout noise, not a rank change worth animating. */
const MOVE_THRESHOLD_PX = 0.5;

const EMPTY_ROWS: readonly RelevantNoteRow[] = Object.freeze([]);

export interface RelevantNoteRow {
  note: RelevantNoteEntry;
  /** True while the note is still mounted only to play its removal. */
  exiting: boolean;
  /** True while the note should play its arrival. */
  entering: boolean;
}

interface TransitionState {
  sourceKey: string | undefined;
  notes: readonly RelevantNoteEntry[];
  rows: readonly RelevantNoteRow[];
}

/** Render a list outright, with no row held back and no arrival to play. */
function replaceRows(notes: readonly RelevantNoteEntry[]): readonly RelevantNoteRow[] {
  return notes.map((note) => ({ note, exiting: false, entering: false }));
}

/**
 * Splice rows that just left the results back into their previous slot so the
 * removal can be seen, and keep rows already on their way out until their timer
 * drops them.
 */
function mergeRows(
  previousRows: readonly RelevantNoteRow[],
  notes: readonly RelevantNoteEntry[]
): readonly RelevantNoteRow[] {
  const previousByPath = new Map(previousRows.map((row) => [row.note.note.path, row]));
  const nextPaths = new Set(notes.map((note) => note.note.path));
  const rows: RelevantNoteRow[] = notes.map((note) => ({
    note,
    exiting: false,
    // A row already on screen must keep whatever it was mounted with: turning
    // its arrival on now would replay the animation on a row that never left.
    entering: previousByPath.get(note.note.path)?.entering ?? true,
  }));

  previousRows.forEach((previousRow, previousIndex) => {
    if (nextPaths.has(previousRow.note.note.path)) return;
    rows.splice(Math.min(previousIndex, rows.length), 0, {
      note: previousRow.note,
      exiting: true,
      entering: previousRow.entering,
    });
  });

  return rows;
}

/**
 * Keep the rendered rows in step with a result list that re-ranks itself while
 * the user writes.
 *
 * A live re-rank replaces the whole list at once, which reads as a flicker
 * unless the rows that moved, arrived, and left are each shown doing so. This
 * hook holds departing rows mounted long enough to fade and slides surviving
 * rows from their previous position to their new one. Results the reader has
 * not seen yet, such as the list for a note they just opened, appear at once.
 * With motion off it just mirrors the results, so nothing lingers and nothing
 * moves.
 *
 * @param notes - Relevant notes in the order they should render.
 * @param sourceKey - Identity of the note the results describe, or undefined
 *   when no note is open.
 * @param animated - False when the reader has asked for reduced motion.
 * @returns The rows to render and the ref callback each row must register with.
 */
export function useRelevantNoteRowTransitions(
  notes: readonly RelevantNoteEntry[],
  sourceKey: string | undefined,
  animated: boolean
): {
  rows: readonly RelevantNoteRow[];
  registerRow: (path: string) => (node: HTMLElement | null) => void;
} {
  const [state, setState] = useState<TransitionState>(() => ({
    sourceKey,
    notes,
    rows: replaceRows(notes),
  }));

  // Deriving during render keeps surviving rows mounted across a re-rank. An
  // effect would unmount a departing row before it could be held back, and
  // re-mounting it would replay its entry animation instead of its removal.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
  if (state.notes !== notes || state.sourceKey !== sourceKey) {
    // Only a ranking that shifts under a list the reader is already looking at
    // is worth animating. Opening another note replaces every row at once, and
    // a list filling from empty is the pane loading rather than re-ranking; in
    // both the motion would read as noise over content the reader has not seen.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
    const reranking = animated && state.sourceKey === sourceKey && state.rows.length > 0;
    setState({
      sourceKey,
      notes,
      rows: reranking ? mergeRows(state.rows, notes) : replaceRows(notes),
    });
  }

  const hasExitingRows = state.rows.some((row) => row.exiting);
  useEffect(() => {
    if (!hasExitingRows) return;
    const timer = window.setTimeout(() => {
      setState((current) => ({
        ...current,
        rows: current.rows.filter((row) => !row.exiting),
      }));
    }, ROW_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [hasExitingRows, state.rows]);

  const nodesByPath = useRef(new Map<string, HTMLElement>());
  const offsetsByPath = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const nodes = nodesByPath.current;
    const offsets = offsetsByPath.current;

    for (const [path, node] of nodes) {
      // offsetTop is measured against the pane rather than the viewport, so
      // scrolling the pane between renders cannot be mistaken for a rank change.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
      const offset = node.offsetTop;
      const previousOffset = offsets.get(path);
      offsets.set(path, offset);
      if (!animated || previousOffset === undefined) continue;
      const delta = previousOffset - offset;
      if (Math.abs(delta) < MOVE_THRESHOLD_PX) continue;
      node.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }], {
        duration: ROW_MOVE_MS,
        easing: ROW_MOVE_EASING,
      });
    }

    for (const path of [...offsets.keys()]) {
      if (!nodes.has(path)) offsets.delete(path);
    }
  }, [state.rows, animated]);

  const registerRow = useCallback(
    (path: string) => (node: HTMLElement | null) => {
      if (node) {
        nodesByPath.current.set(path, node);
      } else {
        nodesByPath.current.delete(path);
      }
    },
    []
  );

  return { rows: state.rows.length > 0 ? state.rows : EMPTY_ROWS, registerRow };
}
