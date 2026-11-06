# Relevant Notes

Notes related to the current note or chat, found by Miyo, in the start screen's shelf or in a standalone pane.

## Sub-features

- rn-source: `Relevant to` names what the list is about: the open note, `Agent chat context` once the user works in Agent Chat, or `—` when neither applies.
- rn-list: related notes ranked by similarity, each with its folder, a percentage and bar, and `Outgoing link` or `Backlink` marks.
- rn-preview: hovering a note shows a preview of it with its `Similarity`, `Add to chat`, and `Open note`.
- rn-add-to-chat: `Add to chat` attaches the note to the [chat input](chat-input.md).
- rn-open: `Open note` or the note's title opens it in a new tab.
- rn-live: the `Live` switch ("Re-rank these notes while you write") re-ranks the notes as the source changes.
- rn-pane: `Open in separate pane` in the [start screen](agent-home.md)'s shelf, or the `Open Relevant Notes` command, opens the standalone pane.
- rn-miyo: with Miyo off, the list offers `Add semantic matches with Miyo`, `Download Miyo`, and `Set up in Copilot`; other Miyo states, such as `Miyo is not connected`, explain why there are no matches.

## How to get to it (user POV)

- The `Relevant Notes` tab in the shelf on the [start screen](agent-home.md).
- The `Open Relevant Notes` command, or `Open in separate pane` under the shelf's list.

## Driving it

- Source: open a note beside Agent Chat and choose `Relevant Notes`. `Relevant to` names the note. Click into the chat input: it reads `Agent chat context`. Open another note: it names that note.
- List: with a note open, the list shows related notes with percentages, highest first. Add a link from the open note to a listed note: that row shows the `Outgoing link` mark.
- Preview: hover a listed note. A preview shows its text, `Similarity` with a percentage, `Add to chat`, and `Open note`.
- Add to chat: hover a row and choose `Add to chat`. The note shows as a chip in the chat input.
- Open: hover a row and choose `Open note`. The note opens in a new tab.
- Live: with `Live` on, edit the open note. The percentages and order update without reopening the note.
- Pane: choose `Open in separate pane`. The Copilot Relevant Notes pane opens, and the shelf drops its `Relevant Notes` tab. Close the pane: the tab returns. The `Open Relevant Notes` command opens the same pane.
- Without Miyo: turn Miyo off in Copilot settings. The list shows `Add semantic matches with Miyo` with `Download Miyo` and `Set up in Copilot`.
- Miyo not reachable: with Miyo on but not running, or the vault not registered in it, the list shows `Miyo is not connected` with `Open Miyo settings`.

## Gotchas

- Every row comes from Miyo. Without it there is no list at all, not a link-based fallback.
- The source follows where the user last worked: clicking into Agent Chat switches it to `Agent chat context`, and activating a note switches it back. Clicks inside Relevant Notes keep the current source.
