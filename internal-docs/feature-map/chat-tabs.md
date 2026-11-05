# Chat tabs

Chat tabs let a user keep several chats open in Agent Chat and move between them. A tab stays open until the user closes it. Closing a tab the user worked in keeps its agent running; closing one the user only looked at stops it.

## Sub-features

- `tab-new` opens a new chat in a new tab and leaves every other tab open.
- `tab-open-past` opens a past chat in a new tab, or in the current tab when that tab is an empty new chat.
- `tab-switch` shows another tab's chat without closing the one left.
- `tab-attention` marks a tab whose chat finished while the user was elsewhere.
- `tab-close` closes a tab. The agent keeps running if the user sent a message or left unsent text; otherwise it stops. The chat stays in history.
- `tab-rename` renames a tab's chat.
- `tab-overflow` moves tabs that do not fit into a `Show N more chats` menu.
- `tab-project` gives each project its own tabs; leaving the project brings the other tabs back.

## How to get to it (user POV)

- Open Agent Chat from the ribbon icon or the `Open Copilot Agent Chat window` command. Tabs run across the top.
- Choose `New chat` (**+**) at the end of the tabs.
- Choose a chat in Recent chats, or in the history list from the history button above the message box.
- Close a tab with its `Close chat` (X), a middle click, or right-click → Close.

## Driving it with the Obsidian CLI

Preconditions:

- Baseline state per the [README](./README.md).
- The Copilot Navigator is closed; tabs are hidden while it is open.

- **Open a past chat.** Choose a chat in Recent chats. One tab shows its conversation.
- **New tab beside it.** Choose `New chat` (**+**). Two tabs: the past chat and an empty new chat.
- **Switch back.** Choose the past chat's tab. Its conversation shows and both tabs remain.
- **Close an untouched tab.** Close the past chat's tab without sending anything. The tab is gone. Its Recent chats row is still there and no longer offers `Close chat`.
- **Close a worked-in tab.** Send a message in a tab, wait for the reply, and close the tab. Its Recent chats row still offers `Close chat`. Choosing the row brings back the same conversation.
- **Proof.** Screenshot the tabs after each step, with Recent chats visible for the two close steps.

## Gotchas

- `New chat` inside a conversation (above the message box) replaces that tab's chat instead of adding a tab. Check which one a report means.
- `Close chat` in a Recent chats or history row stops the agent and removes the tab, even for a chat the user worked in. The tab's own `Close chat` does not.
- A past chat reopened from history counts as untouched until the user sends a message.
- A narrow pane shows one tab and an overflow menu, which hides the two-tab result. Collapse the side panels first.
- The tab's `Close chat` appears only on hover.
- Every open tab keeps an agent running, a few hundred MB each for Claude. Tabs do not come back after Obsidian restarts.
