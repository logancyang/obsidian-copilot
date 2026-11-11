# Chat rows

One chat in a list: the Navigator, Recent chats on the start screen, or the chat history list.

## Sub-features

- row-open: click a row to show its chat in Agent Chat.
- row-open-saved: a saved chat the agent no longer has, such as one saved on another computer, opens from its note. On the next message the agent is told the earlier messages, which tools and files each reply used, and where each earlier image is saved. The chat shows the same messages, with no tool steps. When the chat is too long to tell in full, the agent is told only the most recent messages and a notice says the oldest ones were left out.
- row-status: the row shows `Running` (a green dot), a spinner while responding, `Waiting for permission`, or `Unread result`.
- row-agent: in the Navigator, the row starts with the logo of the agent that runs the chat.
- row-attention: in the Navigator, a chat with an unread result shows a bell in the accent color in place of the green `Running` dot. It and a chat waiting for permission show a bold title; other chats are dimmed except the current one.
- row-pin: `Pin chat` / `Unpin chat`.
- row-rename: `More actions` → Rename.
- row-close: `Shut down` stops the chat's agent and keeps the chat. It is offered only while the agent is running.
- row-archive: `Archive chat` hides the chat from the list; it stays under View archived.
- row-delete: `More actions` → Delete chat.
- row-note: `Open chat note`, `Copy chat link`, and bookmarking, for chats saved as notes.
- row-multi-select: in Recent chats and the Navigator, Shift-click selects the rows between the last clicked row and this one, and Cmd-click (Ctrl-click on Windows) adds or removes one row. Right-clicking a selected row offers only `Archive N chats` and `Delete N chats`, each confirmed first.

## How to get to it

- Recent chats on the [start screen](agent-home.md).
- `Chat history` in the [chat controls](chat-controls.md).
- The [Copilot Navigator](copilot-navigator.md).

## Driving it

- Open: choose a row in Recent chats. Its conversation shows in Agent Chat.
- Open saved: ask Claude to read three notes and summarize them, then open the chat on another computer, or remove Claude's own record of it. Reopen it from Recent chats: the messages show without tool steps. Ask which notes the summary came from: Claude names all three with their paths.
- Open saved, long chat: reopen the same way a chat whose saved note runs past about 200,000 characters, and send a message. A notice says the agent wasn't told the oldest messages; the next message shows none.
- Open saved with an image: paste an image into a message and get a reply, then reopen the chat the same way. Ask what the image shows: the agent opens the saved image and describes it.
- Pin: hover the row and choose `Pin chat`. The chat moves under Pinned and offers `Unpin chat`.
- Rename: choose `More actions` → Rename, type a name, confirm. The row shows the new name.
- Close: on a row offering `Shut down`, choose it. The button goes away, the chat's tab closes, and the row stays.
- Agent: open the Navigator with chats from two agents. Each row starts with its own agent's logo.
- Attention: let a chat finish while another chat is open. In the Navigator, its title turns bold and a bell replaces its green dot; opening the chat clears both.
- Archive: choose `Archive chat`. The row leaves the list and shows under View archived.
- Multi-select: in Recent chats, Cmd-click one row and Shift-click another. Those rows and every row between them are outlined. Right-click one: the menu offers only `Archive N chats` and `Delete N chats`. Choose `Delete N chats` and confirm; the rows leave the list and one notice gives the count. Repeat in the Navigator with a range from Pinned into Recents.
- Repeat open and close from the Navigator and from `Chat history`, which list the same chats.

## Gotchas

- A row's `Shut down` also closes the chat's [tab](chat-tabs.md), if it has one.
- A Shift-click range covers only rows on screen: chats in a folded group, a collapsed project, or behind `Show more` are skipped. Changing the search text, a plain click, or Esc clears the selection. `Chat history` has no multi-select.
