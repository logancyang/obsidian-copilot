// src/editor/replaceGuard.ts

import type { ChangeDesc } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { WorkspaceLeaf } from "obsidian";
import { SelectionHighlight } from "./selectionHighlight";
import { logError } from "@/logger";

/**
 * Replace 校验失败原因
 */
export type ReplaceInvalidReason =
  | "no_range" // 没有有效范围
  | "range_out_of_bounds" // 范围超出文档边界
  | "content_changed" // 选区内容已变化
  | "file_changed" // 文件已切换
  | "editor_changed" // EditorView 已变化
  | "leaf_changed" // Leaf 已变化
  | "target_unavailable"; // 目标不可用

/**
 * Replace 校验状态 / 执行结果（统一结构）
 */
export interface ReplaceStatus {
  ok: boolean;
  reason: ReplaceInvalidReason | null;
  range: { from: number; to: number } | null;
  /** 用户提示消息 */
  message?: string;
}

/**
 * ReplaceGuard 接口
 * 统一 "捕获 → 映射 → 校验 → 替换" 流程
 * 允许不同的映射策略
 */
export interface ReplaceGuard {
  /** 获取当前映射后的范围 */
  getRange(): { from: number; to: number } | null;

  /** 校验 Replace 是否可执行 */
  validate(): ReplaceStatus;

  /**
   * 文档变化时更新映射 (可选)
   * - MapPos 策略: 需要实现
   * - SelectionHighlight 策略: 不需要实现
   */
  onDocChanged?(changes: ChangeDesc): void;

  /** 执行替换 (内部会先校验) */
  replace(replacement: string): ReplaceStatus;
}

/**
 * 获取用户友好的错误消息
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
  /** 打开时的 leaf 引用 */
  leafSnapshot: WorkspaceLeaf;
  /** 打开时的文件路径 */
  filePathSnapshot: string | null;
  /** 打开时的选中文本 (从 doc.sliceString 获取) */
  selectedTextSnapshot: string;
  /** 打开时的选区范围 */
  initialRange: { from: number; to: number };
  /**
   * 获取当前 leaf 的状态
   * 必须轻量，因为 Quick Ask 高频校验
   */
  getLeafState: () => {
    leaf: WorkspaceLeaf | null;
    editorView: EditorView | null;
    filePath: string | null;
  };
}

/**
 * Quick Ask 使用的 MapPos 策略
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

  // 内部维护的映射范围
  let range = { ...initialRange };

  // validate 缓存：仅在 docChanged 或 leafState 变化时重新计算
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

    // 1. 检查 leaf 是否还是同一个
    if (!state.leaf || state.leaf !== leafSnapshot) {
      lastValidationResult = invalid("leaf_changed", null);
      return lastValidationResult;
    }

    // 2. 检查 EditorView 是否还是同一个
    if (!state.editorView || state.editorView !== editorView) {
      lastValidationResult = invalid("editor_changed", null);
      return lastValidationResult;
    }

    // 3. 检查文件路径是否一致
    if (state.filePath !== filePathSnapshot) {
      lastValidationResult = invalid("file_changed", null);
      return lastValidationResult;
    }

    // 4. 检查 EditorView 是否可用
    if (!editorView.dom.isConnected) {
      lastValidationResult = invalid("target_unavailable", null);
      return lastValidationResult;
    }

    const doc = editorView.state.doc;

    // 5. 检查范围边界
    if (range.from < 0 || range.to > doc.length || range.from >= range.to) {
      lastValidationResult = invalid("range_out_of_bounds", null);
      return lastValidationResult;
    }

    // 6. 检查内容是否一致
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
  /** 打开时的文件路径 */
  filePathSnapshot: string | null;
  /** 打开时的选中文本 (从 doc.sliceString 获取) */
  selectedTextSnapshot: string;
  /**
   * 获取当前 active view 上下文
   */
  getCurrentContext: () => {
    editorView: EditorView | null;
    filePath: string | null;
  };
}

/**
 * Modal 使用的 SelectionHighlight 策略
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

    // 1. 检查是否有 active EditorView
    if (!context.editorView) {
      return invalid("target_unavailable", null);
    }

    // 2. 检查 EditorView 实例是否一致
    if (context.editorView !== editorView) {
      return invalid("editor_changed", null);
    }

    // 3. 检查文件路径是否一致
    if (context.filePath !== filePathSnapshot) {
      return invalid("file_changed", null);
    }

    // 4. 获取映射后的范围
    const range = getRange();
    if (!range) {
      return invalid("no_range", null);
    }

    const doc = editorView.state.doc;

    // 5. 检查范围边界
    if (range.from < 0 || range.to > doc.length || range.from >= range.to) {
      return invalid("range_out_of_bounds", null);
    }

    // 6. 检查内容是否一致
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

  // SelectionHighlight 自己 mapPos，不需要 onDocChanged
  return { getRange, validate, replace };
}
