# Turn diffs

The file changes an agent made in each turn, and Revoke.

## Sub-features

- diff-summary: a turn that changed files lists each file with lines added and removed, and `new` or `deleted`; more than one file shows `Files changed (N)`.
- diff-open: choose a file to open its diff in a tab, showing the note with the turn's changes marked.
- diff-step: `Previous change` / `Next change` and the marks beside the diff move between changes.
- diff-revoke: `Revoke` on one change undoes just that change in the note.
- diff-revoke-all: `Revoke all` undoes every change the turn made to the note.
- diff-revoke-blocked: Revoke is blocked when the text or note changed after the turn ("This text changed in the note after the turn.").
- diff-open-note: `Open note` opens the changed note itself.
- diff-selection: text selected in a diff is added to the [chat input](chat-input.md) as a selection.

Only the sub-features are mapped so far, and they may not cover everything this feature does. To map the rest, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).
