# Chat tabs

The tabs across the top of Agent Chat, one per open chat. A tab stays open, and its chat's agent keeps running, until the user closes it.

## Sub-features

- tab-new: `New chat` (**+**) opens a new chat in a new tab; every other tab stays open.
- tab-switch: click a tab to show its chat; the chat left behind stays open with its agent running.
- tab-agent-face: a chat with one of the user's agents shows the agent's face in its tab and in the `Show N more chats` menu, in place of the agent logo; while the chat responds, a ring spins around the face. Copilot chats keep the logo and its spinner. Tabs stay the same width.
- tab-attention: a dot marks a tab whose chat finished while the user was elsewhere. The dot is orange while the chat, or an agent it [`@`-mentioned](agent-mentions.md), waits on the user (a question or a permission request) and green once the chat is done; the [`@`-mentioned agent's](agent-mentions.md) own work never makes the chat's tab spin, only the chat's turn that passes its question or reply on.
- tab-overflow-dot: `Show N more chats` carries a dot, orange or green like the tabs, when a chat with a dot sits in its menu.
- tab-close: close a tab with its `Close tab` (X), a middle click, or right-click → Close. The agent keeps running if the user sent a message or left unsent text in the chat; otherwise it stops. The chat stays in history either way.
- tab-rename: right-click → Rename.
- tab-overflow: tabs that do not fit move into a `Show N more chats` menu.
- tab-project: each project has its own tabs; leaving the project brings the other tabs back with their chats still open.

## How to get to it

Open Agent Chat from the ribbon icon or the `Open Copilot Agent Chat window` command. The tabs run across the top. They are hidden while the [Copilot Navigator](copilot-navigator.md) is open.

## Driving it

- New tab: open a chat from Recent chats on the [start screen](agent-home.md), then choose `New chat` (**+**). Two tabs show: the past chat and an empty new chat. The past chat's row in Recent chats still offers `Shut down`.
- Switch: choose the past chat's tab. Its conversation shows and both tabs remain.
- Agent face: start chats with two of the user's agents from the [start screen](agent-home.md) and one Copilot chat. Each agent chat's tab shows its agent's face and the Copilot tab shows the logo. Send a message in an agent chat: a ring spins around its face until the reply finishes. Open enough tabs that some move into `Show N more chats`: the menu shows the same faces.
- Attention: send a message, switch tabs before the reply finishes, and wait. The first tab shows a dot until you switch back.
- Agent dots: in an agent's chat, send `@Leo reconcile the books; before you start, ask me which month` and switch to another tab. When Leo's question comes back, the first tab shows an orange dot; answer it there, switch away again, and when Leo's reply is passed on the tab shows a green dot. While only Leo works, the first tab shows its face without a ring.
- Overflow dot: with enough tabs that the chat above sits in `Show N more chats`, the button shows the same dot until you open that chat.
- Close untouched: close the past chat's tab without sending anything. The tab goes away; its row in Recent chats stays but no longer offers `Shut down`.
- Close worked-in: send a message in a tab, wait for the reply, close the tab. Its row still offers `Shut down`, and opening it brings back the same conversation.
- Rename: right-click a tab, choose Rename, type a name, press Enter. The tab shows the new name.
- Overflow: with three or more tabs, narrow the pane. `Show N more chats` lists the tabs that no longer fit.
- Project: enter a [project](projects.md) from the Projects shelf on the [start screen](agent-home.md). Only its tabs show. Leave the project; the other tabs return.

## Gotchas

- `New chat` in the [chat controls](chat-controls.md) replaces the current tab's chat instead of adding a tab. The replaced chat follows the tab-close rule.
- A past chat reopened from history counts as untouched until the user sends a message.
- Opening the [Copilot Navigator](copilot-navigator.md), or closing Agent Chat, stops the agent of every untouched chat in a background tab, so those tabs are gone when the tabs show again.
- A tab shows its agent's face with every license, and with none; when the agent's folder is deleted, the tab shows the agent logo.
- Every running agent costs memory, a few hundred MB each for Claude. Tabs do not come back after Obsidian restarts.
