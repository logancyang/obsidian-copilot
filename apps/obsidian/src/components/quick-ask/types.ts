import type { EditorView } from "@codemirror/view";
import type { Component, Editor } from "obsidian";
import type { CopilotHost } from "@/host/platform/copilotHost";
import type { ReplaceGuard } from "@/editor/replaceGuard";
import type { ResizeDirection } from "@/hooks/use-resizable";

export interface QuickAskHost extends Pick<CopilotHost, "app">, Component {}

export type QuickAskMode = "ask" | "edit" | "edit-direct";

export interface QuickAskMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface QuickAskPanelProps {
  host: QuickAskHost;
  editor: Editor;
  view: EditorView;
  selectedText: string;
  replaceGuard: ReplaceGuard;
  onClose: () => void;
  onDragOffset?: (offset: { x: number; y: number }) => void;
  onResizeStart?: (
    direction: ResizeDirection,
    start: { x: number; y: number; pointerId: number }
  ) => void;
  hasCustomHeight?: boolean;
}

export interface QuickAskWidgetPayload {
  bottomAnchorPos: number;
  topAnchorPos?: number | null;
  focusAnchorPos?: number | null;
  options: {
    host: QuickAskHost;
    editor: Editor;
    view: EditorView;
    selectedText: string;
    selectionFrom: number;
    selectionTo: number;
    replaceGuard: ReplaceGuard;
    onClose: () => void;
  };
}
