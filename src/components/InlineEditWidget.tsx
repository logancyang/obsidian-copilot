import { EditorView, WidgetType, Decoration, DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { InlineEditPrompt } from "./InlineEditPrompt";

// State effect to add/remove inline edit widget
export const addInlineEditWidget = StateEffect.define<{
  pos: number;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}>();
export const removeInlineEditWidget = StateEffect.define<void>();

// Widget class that renders the inline edit prompt
class InlineEditWidget extends WidgetType {
  private root: Root | null = null;

  constructor(
    private onSubmit: (prompt: string) => void,
    private onCancel: () => void
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    console.log("InlineEditWidget.toDOM() called");

    const container = document.createElement("div");
    container.className = "cm-inline-edit-widget";
    container.style.cssText = `
      display: block;
      margin: 8px 0;
      padding: 0;
      border: none;
      background: transparent;
      width: 100%;
    `;

    // Create React root and render the prompt immediately
    this.root = createRoot(container);
    this.root.render(
      <InlineEditPrompt
        onSubmit={this.handleSubmit}
        onCancel={this.handleCancel}
        placeholder="Enter your prompt..."
      />
    );

    console.log("Created widget container:", container);
    return container;
  }

  private handleSubmit = (prompt: string) => {
    this.onSubmit(prompt);
    this.destroy();
  };

  private handleCancel = () => {
    this.onCancel();
    this.destroy();
  };

  destroy() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  eq(other: InlineEditWidget): boolean {
    return false; // Always recreate for simplicity
  }

  get estimatedHeight() {
    return 100; // Estimated height of the widget
  }

  ignoreEvent(event: Event): boolean {
    // Allow interaction with the widget content
    return false;
  }
}

// State field to manage inline edit widgets
export const inlineEditWidgetField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, tr) {
    // Map existing decorations through document changes
    decorations = decorations.map(tr.changes);

    // Apply effects
    for (const effect of tr.effects) {
      if (effect.is(addInlineEditWidget)) {
        console.log("Processing addInlineEditWidget effect:", effect.value);
        const { pos, onSubmit, onCancel } = effect.value;
        const widget = new InlineEditWidget(onSubmit, onCancel);
        const decoration = Decoration.widget({
          widget,
          side: 1,
          block: true,
        });

        console.log("Created decoration:", decoration, "at position:", pos);

        const builder = new RangeSetBuilder<Decoration>();
        builder.add(pos, pos, decoration);
        decorations = builder.finish();

        console.log("New decorations:", decorations);
      } else if (effect.is(removeInlineEditWidget)) {
        console.log("Processing removeInlineEditWidget effect");
        // Remove all decorations
        decorations = Decoration.none;
      }
    }

    return decorations;
  },

  provide: (f) => EditorView.decorations.from(f),
});

// Helper function to add inline edit widget at current cursor position
export function showInlineEditWidget(
  view: EditorView,
  onSubmit: (prompt: string) => void,
  onCancel: () => void
) {
  const pos = view.state.selection.main.head;

  console.log("showInlineEditWidget called with pos:", pos, "view:", view);

  view.dispatch({
    effects: addInlineEditWidget.of({ pos, onSubmit, onCancel }),
  });

  console.log("Dispatched addInlineEditWidget effect");
}

// Helper function to remove inline edit widget
export function hideInlineEditWidget(view: EditorView) {
  view.dispatch({
    effects: removeInlineEditWidget.of(),
  });
}
