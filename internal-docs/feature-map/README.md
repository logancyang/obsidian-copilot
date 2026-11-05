# Feature map

What Copilot does for its users, described the way a product manager would: one file per feature a user can see in the app. It tells an agent which feature a change or bug report touches, what that feature promises the user, and where changes tend to go wrong.

Entries describe behavior only. No file paths, function names, selectors, or other implementation detail: the code changes, and this map should not need to change with it. Update an entry only when what the user can do or see changes.

## Who uses it

- **Obsidian desktop users** chatting with a coding agent (Claude, Codex, or OpenCode) about their vault.
- **Developers and agents** verifying a change in a real vault.

## Shared preconditions

The working tree's build is deployed into your own scratch vault and Agent Chat is open, per [`TESTING_GUIDE.md`](../TESTING_GUIDE.md), "End-to-end testing".

## Coverage rule

Before shipping a change, find every feature whose behavior the change can affect, directly or through shared state, and drive each flow in its `Driving it` section. Unit tests are necessary, not sufficient.

## Each file

- **Sub-features:** what the user can do or will see there, as product rules.
- **How to get to it:** the user's path in the app.
- **Driving it:** user steps and the outcome that proves the feature works.
- **Gotchas:** traps for anyone changing or verifying the feature.

## Features

| File                                           | Feature           | What the user sees                                   |
| ---------------------------------------------- | ----------------- | ---------------------------------------------------- |
| [`chat-tabs.md`](chat-tabs.md)                 | Chat tabs         | Tabs across the top of Agent Chat, one per open chat |
| [`copilot-navigator.md`](copilot-navigator.md) | Copilot Navigator | A sidebar listing chats and projects                 |

## Unmapped

- **Message box** (drafts, attached notes, images, send, stop, queue).
- **Agent activity in a chat** (tool cards, plans, file changes, Revoke).
- **Projects** (create, enter, project context); only their effect on tabs is mapped.
- **Chat history** (Recent chats, the history list); only opening a chat and Close chat are mapped, under Chat tabs.
- **Agent settings** (setup, sign-in, model, mode).
