import type { ChangeDesc } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { WorkspaceLeaf } from "obsidian";
import { SelectionHighlight } from "./selectionHighlight";
import { logError } from "@/logger";

export type ReplaceInvalidReason =
  | "no_range"
  | "range_out_of_bounds"
  | "content_changed"
  | "file_changed"
  | "editor_changed"
  | "leaf_changed"
  | "target_unavailable";

export interface ReplaceStatus {
  ok: boolean;
  reason: ReplaceInvalidReason | null;
  range: { from: number; to: number } | null;
  message?: string;
}

export interface ReplaceGuard {
  getRange(): { from: number; to: number } | null;

  validate(): ReplaceStatus;

  onDocChanged?(changes: ChangeDesc): void;

  replace(replacement: string): ReplaceStatus;
}

export function getErrorMessage(reason: ReplaceInvalidReason | null): string {
  switch (reason) {
    case "no_range":
      return "No selection range available.";
    case "range_out_of_bounds":
      return "Selection range is out of bounds.";
    case "content_changed":
      return "Selection content has changed. Please reselect and try again.";
    case "file_changed":
      return "File has changed. Please reselect in the original file.";
    case "editor_changed":
      return "Editor has changed. Please reselect and try again.";
    case "leaf_changed":
      return "Editor pane has changed. Please reselect and try again.";
    case "target_unavailable":
      return "Editor is no longer available.";
    default:
      return "Cannot replace. Please reselect and try again.";
  }
}

function dispatchReplace(
  editorView: EditorView,
  range: { from: number; to: number },
  replacement: string
): void {
  const insertText = editorView.state.toText(replacement);

  editorView.dispatch({
    changes: {
      from: range.from,
      to: range.to,
      insert: insertText,
    },
    selection: {
      anchor: range.from,
      head: range.from + insertText.length,
    },
  });
  editorView.focus();
}

export interface MapPosReplaceGuardParams {
  editorView: EditorView;
  leafSnapshot: WorkspaceLeaf;
  filePathSnapshot: string | null;
  selectedTextSnapshot: string;
  initialRange: { from: number; to: number };
  getLeafState: () => {
    leaf: WorkspaceLeaf | null;
    editorView: EditorView | null;
    filePath: string | null;
  };
}

export function createMapPosReplaceGuard(params: MapPosReplaceGuardParams): ReplaceGuard {
  const {
    editorView,
    leafSnapshot,
    filePathSnapshot,
    selectedTextSnapshot,
    initialRange,
    getLeafState,
  } = params;

  let range = { ...initialRange };

  type LeafStateSnapshot = ReturnType<MapPosReplaceGuardParams["getLeafState"]>;
  let isValidationDirty = true;
  let lastLeafStateSnapshot: LeafStateSnapshot | null = null;
  let lastValidationResult: ReplaceStatus | null = null;

  const onDocChanged = (changes: ChangeDesc): void => {
    const mappedFrom = changes.mapPos(range.from, 1);
    const mappedTo = changes.mapPos(range.to, -1);
    range = {
      from: Math.min(mappedFrom, mappedTo),
      to: Math.max(mappedFrom, mappedTo),
    };
    isValidationDirty = true;
  };

  const getRange = (): { from: number; to: number } | null => {
    return { ...range };
  };

  const validate = (): ReplaceStatus => {
    const state = getLeafState();

    const leafStateChanged =
      !lastLeafStateSnapshot ||
      state.leaf !== lastLeafStateSnapshot.leaf ||
      state.editorView !== lastLeafStateSnapshot.editorView ||
      state.filePath !== lastLeafStateSnapshot.filePath ||
      !editorView.dom.isConnected;

    if (!isValidationDirty && !leafStateChanged && lastValidationResult) {
      return lastValidationResult;
    }

    isValidationDirty = false;
    lastLeafStateSnapshot = state;

    const invalid = (
      reason: ReplaceInvalidReason,
      nextRange: { from: number; to: number } | null
    ): ReplaceStatus => ({
      ok: false,
      reason,
      range: nextRange,
      message: getErrorMessage(reason),
    });

    if (!state.leaf || state.leaf !== leafSnapshot) {
      lastValidationResult = invalid("leaf_changed", null);
      return lastValidationResult;
    }

    if (!state.editorView || state.editorView !== editorView) {
      lastValidationResult = invalid("editor_changed", null);
      return lastValidationResult;
    }

    if (state.filePath !== filePathSnapshot) {
      lastValidationResult = invalid("file_changed", null);
      return lastValidationResult;
    }

    if (!editorView.dom.isConnected) {
      lastValidationResult = invalid("target_unavailable", null);
      return lastValidationResult;
    }

    const doc = editorView.state.doc;

    if (range.from < 0 || range.to > doc.length || range.from >= range.to) {
      lastValidationResult = invalid("range_out_of_bounds", null);
      return lastValidationResult;
    }

    const currentText = doc.sliceString(range.from, range.to);
    if (currentText !== selectedTextSnapshot) {
      lastValidationResult = invalid("content_changed", { ...range });
      return lastValidationResult;
    }

    lastValidationResult = { ok: true, reason: null, range: { ...range } };
    return lastValidationResult;
  };

  const replace = (replacement: string): ReplaceStatus => {
    const status = validate();
    if (!status.ok || !status.range) {
      return status;
    }

    try {
      dispatchReplace(editorView, status.range, replacement);
      return { ok: true, reason: null, range: status.range };
    } catch (error) {
      logError("MapPosReplaceGuard replace failed:", error);
      return {
        ok: false,
        reason: "target_unavailable",
        range: null,
        message: getErrorMessage("target_unavailable"),
      };
    }
  };

  return { getRange, validate, onDocChanged, replace };
}

export interface HighlightReplaceGuardParams {
  editorView: EditorView;
  filePathSnapshot: string | null;
  selectedTextSnapshot: string;
  getCurrentContext: () => {
    editorView: EditorView | null;
    filePath: string | null;
  };
}

export function createHighlightReplaceGuard(params: HighlightReplaceGuardParams): ReplaceGuard {
  const { editorView, filePathSnapshot, selectedTextSnapshot, getCurrentContext } = params;

  const getRange = (): { from: number; to: number } | null => {
    const range = SelectionHighlight.getRange(editorView);
    return range ? { from: range.from, to: range.to } : null;
  };

  const validate = (): ReplaceStatus => {
    const context = getCurrentContext();

    const invalid = (
      reason: ReplaceInvalidReason,
      nextRange: { from: number; to: number } | null
    ): ReplaceStatus => ({
      ok: false,
      reason,
      range: nextRange,
      message: getErrorMessage(reason),
    });

    if (!context.editorView) {
      return invalid("target_unavailable", null);
    }

    if (context.editorView !== editorView) {
      return invalid("editor_changed", null);
    }

    if (context.filePath !== filePathSnapshot) {
      return invalid("file_changed", null);
    }

    const range = getRange();
    if (!range) {
      return invalid("no_range", null);
    }

    const doc = editorView.state.doc;

    if (range.from < 0 || range.to > doc.length || range.from >= range.to) {
      return invalid("range_out_of_bounds", null);
    }

    const currentText = doc.sliceString(range.from, range.to);
    if (currentText !== selectedTextSnapshot) {
      return invalid("content_changed", range);
    }

    return { ok: true, reason: null, range };
  };

  const replace = (replacement: string): ReplaceStatus => {
    const status = validate();
    if (!status.ok || !status.range) {
      return status;
    }

    try {
      dispatchReplace(editorView, status.range, replacement);
      return { ok: true, reason: null, range: status.range };
    } catch (error) {
      logError("HighlightReplaceGuard replace failed:", error);
      return {
        ok: false,
        reason: "target_unavailable",
        range: null,
        message: getErrorMessage("target_unavailable"),
      };
    }
  };

  return { getRange, validate, replace };
}
