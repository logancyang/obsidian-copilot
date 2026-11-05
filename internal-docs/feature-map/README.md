# Feature map

What Copilot does for its users, described the way a product manager would: one file per task a user comes to do. It tells an agent which feature a change or bug report touches, what that feature promises the user, and where changes tend to go wrong.

Entries describe behavior only. No file paths, function names, selectors, or other implementation detail: the code changes, and this map should not need to change with it. Update an entry only when what the user can do or see changes.

## Who uses it

- **Obsidian desktop users** chatting with a coding agent (Claude, Codex, or OpenCode) about their vault.
- **Developers and agents** verifying a change in a real vault.

## Shared preconditions

The working tree's build is deployed into your own scratch vault and Agent Chat is open, per [`TESTING_GUIDE.md`](../TESTING_GUIDE.md), "End-to-end testing".

## Coverage rule

Before shipping a change, find every feature whose behavior the change can affect, directly or through shared state, and drive each flow in its `Driving it` section. Unit tests are necessary, not sufficient.

## Each file

- **Sub-features:** what the user can do or will see within the task, as product rules.
- **How to get to it:** the user's path in the app.
- **Driving it:** user steps and the outcome that proves the feature works.
- **Gotchas:** traps for anyone changing or verifying the feature.

## Features

| File                                   | User task                     | Aliases                                       |
| -------------------------------------- | ----------------------------- | --------------------------------------------- |
| [`several-chats.md`](several-chats.md) | Work on several chats at once | chat tabs, multiple chats                     |
| [`past-chats.md`](past-chats.md)       | Go back to a past chat        | chat history, Recent chats, Copilot Navigator |

## Unmapped

- **Write and send a message** (drafts, attached notes and context, images, stop, queue).
- **Follow what the agent did** (tool activity, plans, file changes and undoing them).
- **Work inside a project** (project context, project files); only its effect on open chats is mapped.
- **Set up an agent** (install, sign in, models, modes): settings territory.
