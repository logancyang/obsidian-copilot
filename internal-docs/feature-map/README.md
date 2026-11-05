# Feature map

Translates how people describe a change ("+ replaced my chat", "the green dot stays on") into the feature behind it, where it lives, and how to prove it in a real vault. Entries hold what the code cannot tell you: the rules a change must keep, how features affect each other, and pitfalls. Keep them short.

## Who uses it

- **Obsidian desktop users** chatting with a coding agent (Claude, Codex, or OpenCode) about their vault.
- **Developers and agents** verifying a change through the Obsidian CLI.

## Shared preconditions

- The working tree's build is deployed into your own scratch vault and the Agent Chat view is open ([`TESTING_GUIDE.md`](../TESTING_GUIDE.md), "End-to-end testing").
- The agent has finished starting (`getActiveSession().getStatus()` is `idle`) and the chat leaf is wide enough to show several tabs.

## Coverage rule

A change's coverage set is every feature file whose `Where it lives` paths the diff touches, plus every feature that shares the state it changes (for example `AgentSessionManager`). Drive each flow in those files' `Driving it`. Unit tests are necessary, not sufficient.

## Features

| File                                           | User task                                           | Aliases                     |
| ---------------------------------------------- | --------------------------------------------------- | --------------------------- |
| [`chat-tabs.md`](chat-tabs.md)                 | Keep several agent chats open and move between them | tab strip, session tabs     |
| [`copilot-navigator.md`](copilot-navigator.md) | Browse chats and projects from a sidebar            | Navigator, sessions sidebar |

## Unmapped

- **Composer** (drafts, context chips, attachments, send, stop, queue): not mapped yet.
- **Agent trail** (tool cards, reasoning, plans, diffs, Revoke): not mapped yet.
- **Projects** (create, enter, project context): only their effect on tabs is mapped.
- **Chat history management** (pin, archive, delete, rename, chat notes): only opening and Close chat are mapped, because they decide tab and session lifetime.
- **Backend setup and model, effort, and mode pickers**: settings territory, not mapped.
