/**
 * Type definitions for Quick Ask feature.
 */

import type { EditorView } from "@codemirror/view";
import type { Editor } from "obsidian";
import type CopilotPlugin from "@/main";
import type { ReplaceGuard } from "@/editor/replaceGuard";
import type { ResizeDirection } from "@/hooks/use-resizable";

/**
 * Quick Ask mode types.
 * - ask: Multi-turn conversation mode (Phase 1)
 * - edit: Generate edits with preview (Future)
 * - edit-direct: Direct apply edits (Future)
 */
export type QuickAskMode = "ask" | "edit" | "edit-direct";

/**
 * A single message in the Quick Ask conversation.
 */
export interface QuickAskMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/**
 * Props for the QuickAskPanel component.
 */
export interface QuickAskPanelProps {
  plugin: CopilotPlugin;
  editor: Editor;
  view: EditorView;
  /** Selected text captured when panel opened (content snapshot) */
  selectedText: string;
  /** ReplaceGuard for safe Replace operations */
  replaceGuard: ReplaceGuard;
  /** Callback to close the panel */
  onClose: () => void;
  /** Callback when panel is dragged */
  onDragOffset?: (offset: { x: number; y: number }) => void;
  /** Callback when resize starts - Overlay handles the actual resize logic */
  onResizeStart?: (direction: ResizeDirection, start: { x: number; y: number }) => void;
  /** Whether Overlay has set a custom height (user has resized) */
  hasCustomHeight?: boolean;
}

/**
 * Payload for the Quick Ask widget StateEffect.
 */
export interface QuickAskWidgetPayload {
  pos: number;
  /** Optional fallback anchor position (typically selection anchor) */
  fallbackPos?: number | null;
  options: {
    plugin: CopilotPlugin;
    editor: Editor;
    view: EditorView;
    selectedText: string;
    selectionFrom: number;
    selectionTo: number;
    replaceGuard: ReplaceGuard;
    onClose: () => void;
  };
}

/**
 * Mode configuration for Quick Ask.
 */
export interface QuickAskModeConfig {
  id: QuickAskMode;
  label: string;
  icon: string;
  description: string;
  requiresSelection: boolean;
  /** System prompt for this mode */
  systemPrompt?: string;
  /** Whether this mode is implemented */
  implemented: boolean;
}
