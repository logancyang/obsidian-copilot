# Chat rows

One chat in a list: the Navigator, Recent chats on the start screen, or the chat history list.

## Sub-features

- row-open: click a row to show its chat in Agent Chat.
- row-status: the row shows `Session open` (agent running), a spinner while responding, `Waiting for permission`, or `Unread result`.
- row-pin: `Pin chat` / `Unpin chat`.
- row-rename: `More actions` → Rename.
- row-close: `Close chat` stops the chat's agent and keeps the chat. It is offered only while the agent is running.
- row-archive: `Archive chat` hides the chat from the list; it stays under View archived.
- row-delete: `More actions` → Delete chat.
- row-note: `Open chat note`, `Copy chat link`, and bookmarking, for chats saved as notes.

## How to get to it (user POV)

- Recent chats on the [start screen](agent-home.md).
- `Chat history` in the [chat controls](chat-controls.md).
- The [Copilot Navigator](copilot-navigator.md).

## Driving it

- Open: choose a row in Recent chats. Its conversation shows in Agent Chat.
- Pin: hover the row and choose `Pin chat`. The chat moves under Pinned and offers `Unpin chat`.
- Rename: choose `More actions` → Rename, type a name, confirm. The row shows the new name.
- Close: on a row offering `Close chat`, choose it. The button goes away, the chat's tab closes, and the row stays.
- Archive: choose `Archive chat`. The row leaves the list and shows under View archived.
- Repeat open and close from the Navigator and from `Chat history`, which list the same chats.

## Gotchas

- Row actions appear only on hover or keyboard focus.
- Two controls are named `Close chat`: a row's stops the agent, a tab's closes the tab. Look only within the row.
- Archive and delete change the test vault's chats. Restore the chats the baseline needs afterwards.
