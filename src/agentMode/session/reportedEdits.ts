export interface ReportedEdit {
  oldText: string | null;
  newText: string;
}

// Strict on purpose: a failed or rejected call reports edits that never landed, and
// undoing them anyway would invent history the vault never had.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/347
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
