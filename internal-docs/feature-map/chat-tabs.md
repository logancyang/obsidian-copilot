# Chat tabs

Aliases: tab strip.

A tab is an open chat. It stays open until the user closes it, whether or not it is the one in front.

## Sub-features

- **+** opens a new chat in a new tab. Every other tab stays open.
- Clicking a tab switches to it. A dot marks a tab whose chat finished while the user was elsewhere.
- Closing a tab (its X, middle click, or right-click → Close) keeps the agent working if the user sent a message or left unsent text in it; otherwise the agent stops. Either way the chat stays in history.
- Opening a past chat from Recent chats or the history button adds a tab, or fills the current tab when that tab is an empty new chat.
- Tabs can be renamed. When the view is narrow, extra tabs move into an overflow menu.
- Each project has its own tabs; leaving the project brings the other tabs back.

## How to get to it

Open Agent Chat (ribbon icon, or the **Open Copilot Agent Chat window** command). The tabs run across the top. They are hidden while the [Copilot Navigator](copilot-navigator.md) is open.

## Driving it

Setup per [README](README.md).

1. Open a past chat from Recent chats, then click **+**. Two tabs: the past chat and the new one.
2. Close the past chat's tab without sending anything. The tab is gone and the chat is still in Recent chats.
3. Send a message in a tab, then close it. Reopening it from history brings back the same chat, still running if it was.

## Gotchas

- The **New chat** button inside a conversation replaces that tab's chat instead of adding a tab.
- **Close chat** in the history list stops the agent and removes the tab, even for a chat the user worked in. Closing the tab itself does not.
- "Sent a message" counts only since Obsidian started. A past chat reopened from history counts as untouched.
- Every open tab keeps an agent running, a few hundred MB each for Claude.
- Tabs do not come back after Obsidian or the plugin restarts.
