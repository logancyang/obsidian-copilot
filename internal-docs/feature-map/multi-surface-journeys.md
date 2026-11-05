# Multi-surface journeys

Bugs where features each did what their own files say, and still failed together. Every journey cites the issue that found it. Each feature's controls and rules are in its own file; read those first.

## Browsed chats stay listed

From [#814](https://github.com/Brevilabs/obsidian-copilot-private/issues/814): stopping the agent of a chat the user only looked at removed that chat from the Navigator and Recent chats.

- In the [Copilot Navigator](copilot-navigator.md), open a past chat without sending anything, then open another. The first loses `Session open`.
- The first chat is still listed in the Navigator and in Recent chats on the [start screen](agent-home.md). Opening it shows its messages.

Touches: [Copilot Navigator](copilot-navigator.md), [chat rows](chat-rows.md), [agent home](agent-home.md).

## Pinning a chat while it replies

From [#700](https://github.com/Brevilabs/obsidian-copilot-private/issues/700): pinning or unpinning a running chat saved in a hidden folder could write an older transcript back into its chat note, dropping the newest messages.

- In settings, set `Copilot folder location` to a hidden folder, such as `.copilot`.
- Send a message that gets a long reply. While it replies, pin the chat from its [row](chat-rows.md), then unpin it.
- After the reply finishes, choose `Open chat note`. The note holds the full reply, and the row shows the chat unpinned.

Touches: [chat rows](chat-rows.md), [agent replies](agent-replies.md).

## Relevant Notes while its own pane is hidden

From [#468](https://github.com/Brevilabs/obsidian-copilot-private/issues/468), a user report: the start screen dropped its Relevant Notes tab whenever a standalone Relevant Notes pane existed, even hidden behind another tab.

- Open the standalone Relevant Notes pane, then show another tab in that sidebar. The [start screen](agent-home.md)'s shelf shows Relevant Notes.
- Bring the standalone pane to the front. The shelf hides its Relevant Notes tab, and shows it again once the pane is hidden.

Touches: [Relevant Notes](relevant-notes.md), [agent home](agent-home.md).
