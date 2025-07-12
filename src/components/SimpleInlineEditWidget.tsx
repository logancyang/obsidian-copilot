import { EditorView, WidgetType, Decoration, DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";

// State effect to add/remove inline edit widget
export const addSimpleInlineEditWidget = StateEffect.define<{
  pos: number;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}>();
export const removeSimpleInlineEditWidget = StateEffect.define<void>();

// Simple widget class that renders a basic HTML form
class SimpleInlineEditWidget extends WidgetType {
  constructor(
    private onSubmit: (prompt: string) => void,
    private onCancel: () => void
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    console.log("SimpleInlineEditWidget.toDOM() called");

    const container = document.createElement("div");
    container.className = "cm-simple-inline-edit-widget";
    container.style.cssText = `
      display: block;
      margin: 8px 0;
      padding: 12px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 6px;
      background: var(--background-primary);
      width: 100%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;

    // Create the form elements
    const textarea = document.createElement("textarea");
    textarea.placeholder = "Enter your prompt...";
    textarea.style.cssText = `
      width: 100%;
      min-height: 60px;
      padding: 8px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      background: var(--background-primary);
      color: var(--text-normal);
      font-family: var(--font-interface);
      font-size: 14px;
      resize: vertical;
      outline: none;
      margin-bottom: 8px;
    `;

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      align-items: center;
    `;

    const submitButton = document.createElement("button");
    submitButton.textContent = "Submit";
    submitButton.style.cssText = `
      padding: 6px 12px;
      background: var(--interactive-accent);
      color: var(--text-on-accent);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;

    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.style.cssText = `
      padding: 6px 12px;
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;

    // Add event listeners
    const handleSubmit = () => {
      const prompt = textarea.value.trim();
      if (prompt) {
        this.onSubmit(prompt);
      }
    };

    const handleCancel = () => {
      this.onCancel();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
      // Stop propagation to prevent CodeMirror from handling these events
      e.stopPropagation();
    };

    const handleClick = (e: MouseEvent) => {
      // Stop propagation to prevent CodeMirror from handling clicks
      e.stopPropagation();
      textarea.focus();
    };

    const handleTextareaFocus = (e: FocusEvent) => {
      // Stop propagation to prevent CodeMirror from handling focus events
      e.stopPropagation();
    };

    const handleInput = (e: Event) => {
      // Stop propagation to prevent CodeMirror from handling input
      e.stopPropagation();
    };

    // Attach events
    submitButton.addEventListener("click", handleSubmit);
    cancelButton.addEventListener("click", handleCancel);
    textarea.addEventListener("keydown", handleKeyDown);
    textarea.addEventListener("click", handleClick);
    textarea.addEventListener("focus", handleTextareaFocus);
    textarea.addEventListener("input", handleInput);
    container.addEventListener("click", handleClick);

    // Assemble the widget
    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(submitButton);
    container.appendChild(textarea);
    container.appendChild(buttonContainer);

    // Auto-focus the textarea
    setTimeout(() => {
      textarea.focus();
    }, 10);

    console.log("Created simple widget container:", container);
    return container;
  }

  eq(other: SimpleInlineEditWidget): boolean {
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

// State field to manage simple inline edit widgets
export const simpleInlineEditWidgetField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, tr) {
    // Map existing decorations through document changes
    decorations = decorations.map(tr.changes);

    // Apply effects
    for (const effect of tr.effects) {
      if (effect.is(addSimpleInlineEditWidget)) {
        console.log("Processing addSimpleInlineEditWidget effect:", effect.value);
        const { pos, onSubmit, onCancel } = effect.value;
        const widget = new SimpleInlineEditWidget(onSubmit, onCancel);
        const decoration = Decoration.widget({
          widget,
          side: 1,
          block: true,
        });

        console.log("Created simple decoration:", decoration, "at position:", pos);

        const builder = new RangeSetBuilder<Decoration>();
        builder.add(pos, pos, decoration);
        decorations = builder.finish();

        console.log("New simple decorations:", decorations);
      } else if (effect.is(removeSimpleInlineEditWidget)) {
        console.log("Processing removeSimpleInlineEditWidget effect");
        // Remove all decorations
        decorations = Decoration.none;
      }
    }

    return decorations;
  },

  provide: (f) => EditorView.decorations.from(f),
});

// Helper function to add simple inline edit widget at current cursor position
export function showSimpleInlineEditWidget(
  view: EditorView,
  onSubmit: (prompt: string) => void,
  onCancel: () => void
) {
  const pos = view.state.selection.main.head;

  console.log("showSimpleInlineEditWidget called with pos:", pos, "view:", view);

  view.dispatch({
    effects: addSimpleInlineEditWidget.of({ pos, onSubmit, onCancel }),
  });

  console.log("Dispatched addSimpleInlineEditWidget effect");
}

// Helper function to remove simple inline edit widget
export function hideSimpleInlineEditWidget(view: EditorView) {
  view.dispatch({
    effects: removeSimpleInlineEditWidget.of(),
  });
}
