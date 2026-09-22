import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { releaseCursorAssociation } from "@/editor/releaseCursorAssociation";

describe("releaseCursorAssociation", () => {
  let view: EditorView;
  let input: HTMLInputElement;

  beforeEach(() => {
    jest.useFakeTimers();
    input = document.createElement("input");
    document.body.appendChild(input);
  });

  afterEach(() => {
    view.destroy();
    input.remove();
    jest.useRealTimers();
  });

  function mount(selection: EditorSelection) {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: "A wrapped line ends with a space before more text",
        selection,
        extensions: [
          EditorState.allowMultipleSelections.of(true),
          EditorView.lineWrapping,
          releaseCursorAssociation,
        ],
      }),
    });
    view.focus();
  }

  describe("blur()", () => {
    it("preserves a neutral cursor when focus moves to another input (https://github.com/logancyang/obsidian-copilot/issues/3328)", () => {
      mount(EditorSelection.create([EditorSelection.cursor(10)]));
      const selection = view.state.selection;

      input.focus();

      expect(document.activeElement).toBe(input);
      expect(view.state.selection).toBe(selection);
    });

    it.each([-1, 1])(
      "releases association %i on blur without moving the caret or editing text (https://github.com/logancyang/obsidian-copilot/issues/3328)",
      (assoc) => {
        mount(EditorSelection.create([EditorSelection.cursor(32, assoc, 1, 12)]));
        const doc = view.state.doc;

        input.focus();

        expect(document.activeElement).toBe(input);
        expect(view.state.doc).toBe(doc);
        expect(view.state.selection.main.head).toBe(32);
        expect(view.state.selection.main.assoc).toBe(0);
        expect(view.state.selection.main.bidiLevel).toBe(1);
        expect(view.state.selection.main.goalColumn).toBe(12);
      }
    );

    it("preserves a nonempty selection when focus leaves the note (https://github.com/logancyang/obsidian-copilot/issues/3328)", () => {
      mount(EditorSelection.create([EditorSelection.range(20, 5)]));
      const selection = view.state.selection;

      input.focus();

      expect(view.state.selection).toBe(selection);
    });

    it("preserves secondary ranges and the primary range index while releasing the primary caret (https://github.com/logancyang/obsidian-copilot/issues/3328)", () => {
      const secondary = EditorSelection.range(3, 8);
      mount(EditorSelection.create([secondary, EditorSelection.cursor(32, -1)], 1));

      input.focus();

      expect(view.state.selection.mainIndex).toBe(1);
      expect(view.state.selection.ranges[0]).toBe(secondary);
      expect(view.state.selection.main.head).toBe(32);
      expect(view.state.selection.main.assoc).toBe(0);
    });
  });
});
