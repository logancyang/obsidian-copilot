# Chat tabs

The tabs across the top of Agent Chat, one per open chat. A tab stays open, and its chat's agent keeps running, until the user closes it.

## Sub-features

- tab-new: `New chat` (**+**) opens a new chat in a new tab; every other tab stays open.
- tab-switch: click a tab to show its chat; the chat left behind stays open with its agent running.
- tab-attention: a dot marks a tab whose chat finished while the user was elsewhere.
- tab-close: close a tab with its `Close chat` (X), a middle click, or right-click → Close. The agent keeps running if the user sent a message or left unsent text in the chat; otherwise it stops. The chat stays in history either way.
- tab-rename: right-click → Rename.
- tab-overflow: tabs that do not fit move into a `Show N more chats` menu.
- tab-project: each project has its own tabs; leaving the project brings the other tabs back with their chats still open.

## How to get to it (user POV)

Open Agent Chat from the ribbon icon or the `Open Copilot Agent Chat window` command. The tabs run across the top. They are hidden while the [Copilot Navigator](copilot-navigator.md) is open.

## Driving it

- New tab: open a chat from Recent chats on the [start screen](agent-home.md), then choose `New chat` (**+**). Two tabs show: the past chat and an empty new chat. The past chat's row in Recent chats still offers `Close chat`.
- Switch: choose the past chat's tab. Its conversation shows and both tabs remain.
- Attention: send a message, switch tabs before the reply finishes, and wait. The first tab shows a dot until you switch back.
- Close untouched: close the past chat's tab without sending anything. The tab goes away; its row in Recent chats stays but no longer offers `Close chat`.
- Close worked-in: send a message in a tab, wait for the reply, close the tab. Its row still offers `Close chat`, and opening it brings back the same conversation.
- Rename: right-click a tab, choose Rename, type a name, press Enter. The tab shows the new name.
- Overflow: with three or more tabs, narrow the pane. `Show N more chats` lists the tabs that no longer fit.
- Project: enter a [project](projects.md) from the Projects shelf on the [start screen](agent-home.md). Only its tabs show. Leave the project; the other tabs return.

## Gotchas

- The start screen's Recent chats / Relevant Notes / Projects shelf also uses tabs. Look only within the tab strip.
- A tab's `Close chat` appears only on hover. A chat row's `Close chat` is a different control ([chat-rows](chat-rows.md)).
- `New chat` in the [chat controls](chat-controls.md) replaces the current tab's chat instead of adding a tab. The replaced chat follows the tab-close rule.
- A past chat reopened from history counts as untouched until the user sends a message.
- Opening the [Copilot Navigator](copilot-navigator.md), or closing Agent Chat, stops the agent of every untouched chat in a background tab, so those tabs are gone when the tabs show again.
- Every running agent costs memory, a few hundred MB each for Claude. Tabs do not come back after Obsidian restarts.
