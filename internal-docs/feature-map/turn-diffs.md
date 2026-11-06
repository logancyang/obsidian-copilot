# Turn diffs

The file changes an agent made in each turn, and Revoke.

## Sub-features

- diff-summary: a turn that changed files lists each file with lines added and removed, and `new` or `deleted`; more than one file shows `Files changed (N)` with the totals.
- diff-open: choose a file to open its diff in a tab, showing the note with removed text struck through and added text highlighted.
- diff-step: `Previous change` / `Next change` move between changes and show `N of M`, wrapping at the ends; the marks beside the diff show where each change is.
- diff-revoke: `Revoke` on one change undoes just that change in the note.
- diff-revoke-all: `Revoke all` puts the note back as it was before the turn.
- diff-revoke-blocked: Revoke is blocked when that text changed after the turn ("This text changed in the note after the turn."); Revoke all is blocked when anything in the note changed ("This note changed after the turn.").
- diff-open-note: `Open note` opens the changed note itself.
- diff-selection: text selected in a diff is added to the [chat input](chat-input.md) as a `Selection` badge.

## How to get to it

- The list of changed files at the end of a turn in the [agent's reply](agent-replies.md); choose a file to open its diff.
- In an open diff, the `Go to next change in file diff` and `Go to previous change in file diff` commands step between changes.

## Driving it

- Summary: ask the agent to change two words in a note and create a new note. The reply ends with `Files changed (2)` and the totals, the new note marked `new`, and each file's added and removed lines.
- Open: choose the edited note. A tab named after the file opens with the note, the old words struck through and the new ones highlighted, and `1 of 2` in the header.
- Step: choose `Next change`. The header shows `2 of 2`; choose it again and it shows `1 of 2`.
- Revoke: choose `Revoke` on the first change. The note has the old word again, and the diff shows that change as unchanged and `1 of 1`.
- Blocked: edit the remaining changed text in the note. `Revoke` on that change and `Revoke all` stop working and show "This text changed in the note after the turn." and "This note changed after the turn." Undo the edit; both work again.
- Revoke all: choose `Revoke all`. The note is back as it was before the turn and the diff shows `+0 −0`.
- Open note: choose `Open note`. The note itself shows.
- Selection: select a line in the diff. A `Selection` badge with that text shows in the chat input.

## Gotchas

- Revoke changes only the note and the open diff tab. The list in the reply keeps the turn's original counts, and reopening a file from it shows the turn's changes again, with Revoke blocked because the note no longer matches.
- Diffs last only while Copilot keeps running. Restarting Obsidian or reloading Copilot closes open diff tabs, and a reopened chat no longer lists changed files for its earlier turns.
