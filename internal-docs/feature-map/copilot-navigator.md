# Copilot Navigator

Aliases: Navigator.

A sidebar listing chats and projects. Unlike tabs, it has no "open" state: moving to another chat stops the one left behind, unless the user worked in it.

## Sub-features

- Chats and projects in one list. A project folder expands to show its chats without entering the project.
- Each chat row shows its state: green dot (still open), spinner (running), waiting for permission, bold title (unread result).
- Clicking a chat shows it in Agent Chat. A chat left behind that the user only looked at stops; one the user sent a message in stays open.
- **New chat**, **New chat in a project**, **New project**, and opening from **View archived** follow the same rule.
- Each row's menu: Close chat, rename, pin, archive, delete.
- The chat tabs hide while the Navigator is open and return when it closes.
- Without Navigator access, opening it shows an upgrade prompt instead.

## How to get to it

The **Open Copilot Navigator** command, or the panel button at the left of the [chat tabs](chat-tabs.md). Needs a license with Navigator access.

## Driving it

Setup per [README](README.md), plus a license with Navigator access.

1. Open chat A from the Navigator without sending anything, then open chat B. A loses its green dot.
2. Send a message in A, then open B. A keeps its green dot.
3. Close the Navigator. The tabs return, showing every chat still open.

## Gotchas

- Agent Chat's own New chat and Recent chats follow tab rules, so while the Navigator is open they do not stop the chat left behind. Any new way to switch chats from the Navigator must stop it, or agents pile up behind green dots.
- The upgrade prompt has no close button; press Escape.
