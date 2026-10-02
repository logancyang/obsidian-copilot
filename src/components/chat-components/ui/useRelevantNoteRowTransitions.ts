import type { RelevantNoteEntry } from "@/search/findRelevantNotes";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const ROW_EXIT_MS = 200;

const ROW_MOVE_MS = 280;

const ROW_MOVE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

const MOVE_THRESHOLD_PX = 0.5;

const EMPTY_ROWS: readonly RelevantNoteRow[] = Object.freeze([]);

export interface RelevantNoteRow {
  note: RelevantNoteEntry;
  exiting: boolean;
  entering: boolean;
}

interface TransitionState {
  sourceKey: string | undefined;
  notes: readonly RelevantNoteEntry[];
  rows: readonly RelevantNoteRow[];
}

function replaceRows(notes: readonly RelevantNoteEntry[]): readonly RelevantNoteRow[] {
  return notes.map((note) => ({ note, exiting: false, entering: false }));
}

function mergeRows(
  previousRows: readonly RelevantNoteRow[],
  notes: readonly RelevantNoteEntry[]
): readonly RelevantNoteRow[] {
  const previousByPath = new Map(previousRows.map((row) => [row.note.note.path, row]));
  const nextPaths = new Set(notes.map((note) => note.note.path));
  const rows: RelevantNoteRow[] = notes.map((note) => ({
    note,
    exiting: false,
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

  // Derive during render: an effect would unmount a departing row before it could be held back.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/362
  if (state.notes !== notes || state.sourceKey !== sourceKey) {
    // Only a re-rank under a list the reader is already looking at animates; a new note or first fill does not.
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
      // offsetTop, unlike viewport offsets, is unaffected by scrolling the pane.
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
