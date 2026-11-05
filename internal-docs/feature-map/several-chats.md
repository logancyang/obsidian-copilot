# Work on several chats at once

Aliases: chat tabs, multiple chats.

A user keeps several agent chats going side by side and moves between them without losing any.

## Sub-features

- Start a new chat without losing the current one.
- A chat the user opened stays open until the user closes it. Moving to another chat never closes one.
- A chat working in the background marks itself when it finishes.
- Closing a chat the user sent a message in keeps its agent working in the background.
- Closing a chat the user only looked at stops its agent. The chat itself is kept and can be reopened.
- Starting fresh from inside a conversation replaces that chat instead of adding one.
- Each project has its own set of open chats.

## How to get to it

Open Agent Chat. Open chats appear as tabs at the top; **+** starts a new one.

## Driving it

Setup per [README](README.md).

1. Open a past chat from Recent chats, then click **+**. Both chats are open.
2. Close the past chat without sending anything. It leaves the tabs, its agent stops, and it is still in Recent chats.
3. Send a message in a chat, then close it. Its agent keeps running, and reopening it from history returns the same live chat.

## Gotchas

- "Sent a message" counts only since Obsidian started. A past chat reopened from history counts as only looked at.
- There are two ways to start a new chat (**+**, and the new-chat button inside a conversation) and two ways to close one (closing the tab, and Close chat in history). Each pair does different things; check which one a report means.
- Every open chat keeps an agent running, at a few hundred MB each for Claude.
- Open chats do not come back after Obsidian or the plugin restarts; past chats are reached through history.
