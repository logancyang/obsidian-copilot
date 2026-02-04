// src/editor/replaceGuard.ts

import type { ChangeDesc } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { WorkspaceLeaf } from "obsidian";
import { SelectionHighlight } from "./selectionHighlight";
import { logError } from "@/logger";

/**
 * Replace validation failure reasons.
 */
export type ReplaceInvalidReason =
  | "no_range" // No valid range
  | "range_out_of_bounds" // Range exceeds document bounds
  | "content_changed" // Selection content has changed
  | "file_changed" // File has switched
  | "editor_changed" // EditorView has changed
  | "leaf_changed" // Leaf has changed
  | "target_unavailable"; // Target unavailable

/**
 * Replace validation status / execution result (unified structure).
 */
export interface ReplaceStatus {
  ok: boolean;
  reason: ReplaceInvalidReason | null;
  range: { from: number; to: number } | null;
  /** User-facing message */
  message?: string;
}

/**
 * ReplaceGuard interface.
 * Unifies the "capture → map → validate → replace" flow.
 * Allows different mapping strategies.
 */
export interface ReplaceGuard {
  /** Get the current mapped range */
  getRange(): { from: number; to: number } | null;

  /** Validate whether replace is executable */
  validate(): ReplaceStatus;

  /**
   * Update mapping on document changes (optional).
   * - MapPos strategy: needs implementation
   * - SelectionHighlight strategy: not needed
   */
  onDocChanged?(changes: ChangeDesc): void;

  /** Execute replacement (validates internally first) */
  replace(replacement: string): ReplaceStatus;
}

/**
 * Get user-friendly error message.
 */
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

/**
 * Dispatch a replacement into CodeMirror and focus the editor.
 *
 * This centralizes the shared "replace + select inserted content" behavior used by
 * different ReplaceGuard implementations.
 *
 * @throws If the EditorView cannot dispatch (e.g. disposed / unavailable).
 */
function dispatchReplace(
  editorView: EditorView,
  range: { from: number; to: number },
  replacement: string
): void {
  // Reason: CM6 normalizes \r\n → \n internally, so string.length would overcount.
  // Using state.toText() ensures the length matches CM6's internal representation.
  const insertText = editorView.state.toText(replacement);

  editorView.dispatch({
    changes: {
      from: range.from,
      to: range.to,
      insert: insertText,
    },
    // Select the replaced content to highlight it
    selection: {
      anchor: range.from,
      head: range.from + insertText.length,
    },
  });
  editorView.focus();
}

// ============================================================================
// MapPosReplaceGuard (Quick Ask)
// ============================================================================

export interface MapPosReplaceGuardParams {
  editorView: EditorView;
  /** Leaf reference at open time */
  leafSnapshot: WorkspaceLeaf;
  /** File path at open time */
  filePathSnapshot: string | null;
  /** Selected text at open time (from doc.sliceString) */
  selectedTextSnapshot: string;
  /** Selection range at open time */
  initialRange: { from: number; to: number };
  /**
   * Get current leaf state.
   * Must be lightweight since Quick Ask validates frequently.
   */
  getLeafState: () => {
    leaf: WorkspaceLeaf | null;
    editorView: EditorView | null;
    filePath: string | null;
  };
}

/**
 * MapPos strategy used by Quick Ask.
 */
export function createMapPosReplaceGuard(params: MapPosReplaceGuardParams): ReplaceGuard {
  const {
    editorView,
    leafSnapshot,
    filePathSnapshot,
    selectedTextSnapshot,
    initialRange,
    getLeafState,
  } = params;

  // Internally maintained mapped range
  let range = { ...initialRange };

  // Validation cache: only recompute on docChanged or leafState change
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

    // 1. Check if leaf is still the same
    if (!state.leaf || state.leaf !== leafSnapshot) {
      lastValidationResult = invalid("leaf_changed", null);
      return lastValidationResult;
    }

    // 2. Check if EditorView is still the same
    if (!state.editorView || state.editorView !== editorView) {
      lastValidationResult = invalid("editor_changed", null);
      return lastValidationResult;
    }

    // 3. Check if file path matches
    if (state.filePath !== filePathSnapshot) {
      lastValidationResult = invalid("file_changed", null);
      return lastValidationResult;
    }

    // 4. Check if EditorView is available
    if (!editorView.dom.isConnected) {
      lastValidationResult = invalid("target_unavailable", null);
      return lastValidationResult;
    }

    const doc = editorView.state.doc;

    // 5. Check range bounds
    if (range.from < 0 || range.to > doc.length || range.from >= range.to) {
      lastValidationResult = invalid("range_out_of_bounds", null);
      return lastValidationResult;
    }

    // 6. Check if content matches
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

// ============================================================================
// HighlightReplaceGuard (Modal)
// ============================================================================

export interface HighlightReplaceGuardParams {
  editorView: EditorView;
  /** File path at open time */
  filePathSnapshot: string | null;
  /** Selected text at open time (from doc.sliceString) */
  selectedTextSnapshot: string;
  /**
   * Get current active view context.
   */
  getCurrentContext: () => {
    editorView: EditorView | null;
    filePath: string | null;
  };
}

/**
 * SelectionHighlight strategy used by Modal.
 */
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

    // 1. Check if there is an active EditorView
    if (!context.editorView) {
      return invalid("target_unavailable", null);
    }

    // 2. Check if EditorView instance matches
    if (context.editorView !== editorView) {
      return invalid("editor_changed", null);
    }

    // 3. Check if file path matches
    if (context.filePath !== filePathSnapshot) {
      return invalid("file_changed", null);
    }

    // 4. Get the mapped range
    const range = getRange();
    if (!range) {
      return invalid("no_range", null);
    }

    const doc = editorView.state.doc;

    // 5. Check range bounds
    if (range.from < 0 || range.to > doc.length || range.from >= range.to) {
      return invalid("range_out_of_bounds", null);
    }

    // 6. Check if content matches
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

  // SelectionHighlight handles mapPos internally, no need for onDocChanged
  return { getRange, validate, replace };
}
