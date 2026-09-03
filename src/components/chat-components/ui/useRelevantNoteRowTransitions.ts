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
}

interface TransitionState {
  notes: readonly RelevantNoteEntry[];
  rows: readonly RelevantNoteRow[];
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
  const nextPaths = new Set(notes.map((note) => note.note.path));
  const rows: RelevantNoteRow[] = notes.map((note) => ({ note, exiting: false }));

  previousRows.forEach((previousRow, previousIndex) => {
    if (nextPaths.has(previousRow.note.note.path)) return;
    rows.splice(Math.min(previousIndex, rows.length), 0, {
      note: previousRow.note,
      exiting: true,
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
 * rows from their previous position to their new one. With motion off it just
 * mirrors the results, so nothing lingers and nothing moves.
 *
 * @param notes - Relevant notes in the order they should render.
 * @param animated - False when the reader has asked for reduced motion.
 * @returns The rows to render and the ref callback each row must register with.
 */
export function useRelevantNoteRowTransitions(
  notes: readonly RelevantNoteEntry[],
  animated: boolean
): {
  rows: readonly RelevantNoteRow[];
  registerRow: (path: string) => (node: HTMLElement | null) => void;
} {
  const [state, setState] = useState<TransitionState>(() => ({
    notes,
    rows: notes.map((note) => ({ note, exiting: false })),
  }));

  // Deriving during render keeps surviving rows mounted across a re-rank. An
  // effect would unmount a departing row before it could be held back, and
  // re-mounting it would replay its entry animation instead of its removal.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
  if (state.notes !== notes) {
    setState({
      notes,
      rows: animated
        ? mergeRows(state.rows, notes)
        : notes.map((note) => ({ note, exiting: false })),
    });
  }

  const hasExitingRows = state.rows.some((row) => row.exiting);
  useEffect(() => {
    if (!hasExitingRows) return;
    const timer = window.setTimeout(() => {
      setState((current) => ({
        notes: current.notes,
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
