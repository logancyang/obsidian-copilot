/**
 * Editor utilities - CM6 extensions and helpers.
 */

// Persistent highlight factory
export { createPersistentHighlight } from "./persistentHighlight";
export type { PersistentHighlightRange, PersistentHighlightInstance } from "./persistentHighlight";

// Selection highlight (QuickAsk / CustomCommandModal)
export {
  SelectionHighlight,
  showSelectionHighlight,
  updateSelectionHighlight,
  hideSelectionHighlight,
  selectionHighlightExtension,
} from "./selectionHighlight";
export type { SelectionHighlightRange } from "./selectionHighlight";

// Quick Ask
export { QuickAskController } from "./quickAskController";
export {
  quickAskWidgetEffect,
  quickAskOverlayPlugin,
  createQuickAskExtension,
} from "./quickAskExtension";

// Chat selection highlight
export {
  ChatSelectionHighlightController,
  hideChatSelectionHighlight,
} from "./chatSelectionHighlightController";
export type { ChatSelectionHighlightControllerOptions } from "./chatSelectionHighlightController";

// Inline comments
export { createPersistentMultiHighlight } from "./persistentMultiHighlight";
export type {
  PersistentMultiHighlightInstance,
  MultiHighlightEntry,
} from "./persistentMultiHighlight";
export {
  commentHighlights,
  COMMENT_HIGHLIGHT_CLASS,
  COMMENT_HIGHLIGHT_FOCUSED_CLASS,
} from "./commentHighlights";
export { commentOverlayEffect, commentOverlayPlugin } from "./commentOverlayExtension";
export { CommentOverlayController } from "./commentOverlayController";
export {
  commentDiffPreviewsField,
  commentDiffPreviewsExtension,
  setPreviewEffect,
  clearPreviewEffect,
  onPreviewInvalidated,
} from "./commentDiffPreviewsField";
export { InlineDiffWidget } from "./inlineDiffWidget";
