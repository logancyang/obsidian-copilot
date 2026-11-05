# Chat tabs

The tabs across the top of Agent Chat, one per open chat. A tab stays open until the user closes it.

## Sub-features

- tab-new: `New chat` (**+**) opens a new chat in a new tab; every other tab stays open.
- tab-switch: click a tab to show its chat; the chat left behind stays open.
- tab-attention: a dot marks a tab whose chat finished while the user was elsewhere.
- tab-close: close a tab with its `Close chat` (X), a middle click, or right-click → Close.
- tab-rename: right-click → Rename.
- tab-overflow: tabs that do not fit move into a `Show N more chats` menu.
- tab-project: each project has its own tabs.

## How to get to it (user POV)

Open Agent Chat from the ribbon icon or the `Open Copilot Agent Chat window` command. The tabs run across the top. They are hidden while the [Copilot Navigator](copilot-navigator.md) is open.

## Driving it

- New tab: open a chat from Recent chats, then choose `New chat` (**+**). Two tabs show: the past chat and an empty new chat.
- Switch: choose the past chat's tab. Its conversation shows and both tabs remain.
- Attention: send a message, switch tabs before the reply finishes, and wait. The first tab shows a dot until you switch back.
- Close: hover a tab and choose its `Close chat`. The tab goes away and its neighbor shows.
- Rename: right-click a tab, choose Rename, type a name, press Enter. The tab shows the new name.
- Overflow: with three or more tabs, narrow the pane. `Show N more chats` lists the tabs that no longer fit.
- What closing a tab does to its agent is driven in [multi-surface-journeys](multi-surface-journeys.md).

## Gotchas

- The start screen's Recent chats / Relevant Notes / Projects shelf also uses tabs. Look only within the tab strip.
- A tab's `Close chat` appears only on hover. A chat row's `Close chat` is a different control ([chat-rows](chat-rows.md)).
- `New chat` above the chat input replaces the current tab's chat instead of adding a tab.
- Tabs do not come back after Obsidian restarts.
