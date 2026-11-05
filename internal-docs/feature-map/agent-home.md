# Agent home

The start screen of a new chat in Agent Chat: a greeting, the [chat input](chat-input.md) for the first message, and the Recent chats / Relevant Notes / Projects shelf.

## Sub-features

- home-greeting: a greeting such as "What can I help with?" above the chat input; inside a project it reads `Chat in <project>`.
- home-first-message: sending the first message turns the start screen into the conversation.
- home-shelf: the shelf's `Recent chats`, `Relevant Notes`, and `Projects` tabs; the last tab chosen stays selected.
- home-recent-chats: `Recent chats` lists past chats as [chat rows](chat-rows.md), filtered by `Search chats...`.
- home-relevant-notes: the `Relevant Notes` tab shows [Relevant Notes](relevant-notes.md); it is hidden while the Relevant Notes pane is open.
- home-projects: the `Projects` tab lists [projects](projects.md) with `New project` and `Search projects...`.
- home-project-start: inside a project, the shelf shows the project's `Recent chats` and its `Context`.
- home-navigator: while the [Copilot Navigator](copilot-navigator.md) is open, the shelf keeps only Relevant Notes.
- home-release-update: when a newer Copilot is out, a `Copilot <version> update available` card opens its release notes; `Dismiss release update` hides it.

Only the sub-features are mapped so far, and they may not cover everything this feature does. To map the rest, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).
