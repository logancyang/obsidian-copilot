import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Releases the note editor's wrapped-line caret preference when focus leaves it. */
export const releaseCursorAssociation = EditorView.domEventHandlers({
  blur(_event, view) {
    const selection = view.state.selection;
    const cursor = selection.main;
    // CodeMirror's deferred wrap correction can move the browser selection back
    // into a blurred note. Release its wrap-side preference without moving the caret.
    // https://github.com/logancyang/obsidian-copilot/issues/3328
    if (cursor.empty && cursor.assoc !== 0) {
      view.dispatch({
        selection: selection.replaceRange(
          EditorSelection.cursor(cursor.head, 0, cursor.bidiLevel ?? undefined, cursor.goalColumn)
        ),
      });
    }
  },
});
