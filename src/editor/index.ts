/**
 * Editor utilities - CM6 extensions and helpers.
 */

// Selection highlight
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
