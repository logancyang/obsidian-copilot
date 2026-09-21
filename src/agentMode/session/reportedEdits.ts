/**
 * One text substitution an edit tool reported making to a file. Every backend
 * describes its edits this way at some point in the turn — as a whole-file
 * before/after pair, as one hunk with its context, or as the unique string the
 * tool searched for and the string it wrote in its place.
 */
export interface ReportedEdit {
  /** Text that was replaced; null when the tool reported writing a new file. */
  oldText: string | null;
  /** Text written in its place. */
  newText: string;
}

/**
 * Recover a file as it stood before the turn's first reported edit by undoing
 * each reported edit against the file's end state, newest first.
 *
 * This is the only way back for agents that write a file before they announce
 * the tool call, which leaves a snapshot read describing the finished file
 * rather than the original. Undoing is deliberately strict: an edit whose new
 * text is absent from the file, or present more than once, is not undone at
 * all, so a tool call that failed or was rejected cannot invent a history the
 * vault never had.
 *
 * @param edits - The turn's reported edits to one file, in the order the tool calls made them.
 * @param after - The file's content when the turn ended, or null when it no longer exists.
 * @returns The recovered content (null when the edits describe a creation), or null when the edits do not apply.
 */
export function revertReportedEdits(
  edits: readonly ReportedEdit[],
  after: string | null
): { text: string | null } | null {
  let text = after;
  for (let i = edits.length - 1; i >= 0; i--) {
    const { oldText, newText } = edits[i];
    if (text === null) return null;
    if (text === newText) {
      text = oldText;
      continue;
    }
    if (oldText === null) return null;
    const at = text.indexOf(newText);
    if (at === -1 || text.indexOf(newText, at + 1) !== -1) return null;
    text = text.slice(0, at) + oldText + text.slice(at + newText.length);
  }
  return { text };
}
