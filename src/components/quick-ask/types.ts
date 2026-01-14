/**
 * Type definitions for Quick Ask feature.
 */

import type { EditorView } from "@codemirror/view";
import type { Editor } from "obsidian";
import type CopilotPlugin from "@/main";

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
  /** Initial selection start position (updated via mapPos on doc changes) */
  selectionFrom: number;
  /** Initial selection end position (updated via mapPos on doc changes) */
  selectionTo: number;
  /** Callback to close the panel */
  onClose: () => void;
  /** Callback when panel is dragged */
  onDragOffset?: (offset: { x: number; y: number }) => void;
  /** Callback when panel is resized */
  onResize?: (size: { width: number; height: number }) => void;
}

/**
 * Payload for the Quick Ask widget StateEffect.
 */
export interface QuickAskWidgetPayload {
  pos: number;
  options: {
    plugin: CopilotPlugin;
    editor: Editor;
    view: EditorView;
    selectedText: string;
    selectionFrom: number;
    selectionTo: number;
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
}
