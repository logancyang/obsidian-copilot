/** Teaches backends the editor's literal vault mention tokens. */
export function buildPillSyntaxDirective(): string {
  return `Editor mentions are concrete references, not template placeholders:
- [[note_title]]: resolve its path to read/edit; never infer contents from its title. Cite notes as [[title]] without backticks.
- {folder_name} (any {...} except {activeNote}): scope glob to folder_name/** or read/grep to folder_name/.
- {activeNote}: the user's active note; resolve like [[note_title]].`;
}
