import { App, Editor, MarkdownView } from "obsidian";
import { showSimpleInlineEditWidget, hideSimpleInlineEditWidget } from "./SimpleInlineEditWidget";

export interface InlineEditManagerOptions {
  onSubmit: (prompt: string, selectedText: string, editor: Editor) => void;
  onCancel?: () => void;
}

export class InlineEditManager {
  private editor: Editor;
  private selectedText: string;
  private options: InlineEditManagerOptions;
  private app: App;
  private isActive: boolean = false;

  constructor(editor: Editor, options: InlineEditManagerOptions, app: App) {
    this.editor = editor;
    this.selectedText = editor.getSelection();
    this.options = options;
    this.app = app;

    // Debug: log selection info
    const fromCursor = editor.getCursor("from");
    const toCursor = editor.getCursor("to");
    console.log("InlineEditManager initialized:", {
      selectedText: this.selectedText,
      fromLine: fromCursor.line,
      toLine: toCursor.line,
      hasSelection: this.selectedText.length > 0,
    });
  }

  show() {
    if (this.isActive) {
      this.hide();
    }

    console.log("InlineEditManager.show() called");

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      console.warn("No active markdown view found");
      return;
    }

    console.log("Active view found:", activeView);

    // Get the CodeMirror EditorView from the active view
    const editorView = (activeView.editor as any).cm;
    if (!editorView) {
      console.warn("No CodeMirror editor view found", activeView.editor);
      return;
    }

    console.log("CodeMirror editor view found:", editorView);

    this.isActive = true;

    // Show the inline widget at the current cursor position
    console.log("Calling showSimpleInlineEditWidget");
    showSimpleInlineEditWidget(editorView, this.handleSubmit, this.handleCancel);
  }

  hide() {
    if (!this.isActive) return;

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;

    const editorView = (activeView.editor as any).cm;
    if (!editorView) return;

    hideSimpleInlineEditWidget(editorView);
    this.isActive = false;
  }

  private handleSubmit = (prompt: string) => {
    this.options.onSubmit(prompt, this.selectedText, this.editor);
    this.hide();
  };

  private handleCancel = () => {
    this.options.onCancel?.();
    this.hide();
  };
}
