# Chat rows

One chat in a list: the Navigator, Recent chats on the start screen, or the chat history list.

## Sub-features

- row-open: click a row to show its chat in Agent Chat.
- row-status: the row shows `Running` (a green dot), a spinner while responding, `Waiting for permission`, or `Unread result`.
- row-agent: in the Navigator, the row starts with the logo of the agent that runs the chat.
- row-attention: in the Navigator, a chat with an unread result shows a bell in the accent color in place of the green `Running` dot. It and a chat waiting for permission show a bold title; other chats are dimmed except the current one.
- row-pin: `Pin chat` / `Unpin chat`.
- row-rename: `More actions` → Rename.
- row-close: `Shut down` stops the chat's agent and keeps the chat. It is offered only while the agent is running.
- row-archive: `Archive chat` hides the chat from the list; it stays under View archived.
- row-delete: `More actions` → Delete chat.
- row-note: `Open chat note`, `Copy chat link`, and bookmarking, for chats saved as notes.

## How to get to it

- Recent chats on the [start screen](agent-home.md).
- `Chat history` in the [chat controls](chat-controls.md).
- The [Copilot Navigator](copilot-navigator.md).

## Driving it

- Open: choose a row in Recent chats. Its conversation shows in Agent Chat.
- Pin: hover the row and choose `Pin chat`. The chat moves under Pinned and offers `Unpin chat`.
- Rename: choose `More actions` → Rename, type a name, confirm. The row shows the new name.
- Close: on a row offering `Shut down`, choose it. The button goes away, the chat's tab closes, and the row stays.
- Agent: open the Navigator with chats from two agents. Each row starts with its own agent's logo.
- Attention: let a chat finish while another chat is open. In the Navigator, its title turns bold and a bell replaces its green dot; opening the chat clears both.
- Archive: choose `Archive chat`. The row leaves the list and shows under View archived.
- Repeat open and close from the Navigator and from `Chat history`, which list the same chats.

## Gotchas

- A row's `Shut down` also closes the chat's [tab](chat-tabs.md), if it has one.
