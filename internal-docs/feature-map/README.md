# Copilot verification map

What Copilot does for its users, one file per user-facing feature. Read this index before driving the app, then use the matching feature file as the recipe. Before shipping a change, drive every feature whose behavior the change can affect, directly or through shared state. Unit tests are necessary, not sufficient.

## Baseline preconditions

- This working tree's build is deployed into your own scratch vault, per [`TESTING_GUIDE.md`](../TESTING_GUIDE.md), "End-to-end testing". Never drive a vault you did not create for this run.
- Agent Chat is open with a ready agent, and Recent chats lists at least two past chats.
- The Agent Chat pane is wide enough to show several tabs.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise.
- Drive through the Obsidian CLI. Find controls by their accessible name (`New chat`, `Close chat`), never by layout or position.
- "Sent a message" means a message sent since Obsidian started.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- A chat's agent is still running when its Recent chats row offers `Close chat`, or its Navigator row shows a green dot. Use that as proof, not the tab alone.
- Record the sub-feature ID and the entry point used with every screenshot.
- Report an unreachable path with what you tried and the missing precondition. Do not report it as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing what the user sees. Then four H2 sections, in order:

1. `Sub-features`: a short ID and one line per behavior. Each could become a feature file of its own.
2. `How to get to it (user POV)`: every user entry point.
3. `Driving it with the Obsidian CLI`: `Preconditions:`, then labeled bullets pairing each user action with its observable result.
4. `Gotchas`: traps that can waste or invalidate a run.

Keep implementation out of the map: no file paths, function names, or CSS selectors. Name only user paths, accessible names, required state, and observable proof. Update an entry only when what the user can do or see changes.

## Features

- [Chat tabs](./chat-tabs.md) covers opening, switching, and closing chats from the tabs in Agent Chat, and what happens to each chat's agent.
- [Copilot Navigator](./copilot-navigator.md) covers browsing chats and projects from the sidebar without leaving agents running.

## Unmapped

- **Message box**: drafts, attached notes, images, send, stop, queue.
- **Agent activity**: tool cards, plans, file changes, Revoke.
- **Projects**: create, enter, project context. Only their effect on tabs is mapped.
- **Chat history**: Recent chats and the history list. Only opening a chat and `Close chat` are mapped, under Chat tabs.
- **Agent settings**: setup, sign-in, model, mode.
