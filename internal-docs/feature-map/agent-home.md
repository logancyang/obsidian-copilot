# Agent home

The start screen of a new chat in Agent Chat: a greeting, the [chat input](chat-input.md) for the first message, and the Recent chats / Relevant Notes / Projects shelf.

## Sub-features

- home-greeting: a greeting such as "What can I help with?" above the chat input, picked again for each new chat; inside a project it reads `Chat in <project>`.
- home-first-message: sending the first message turns the start screen into the conversation, with the [chat controls](chat-controls.md) above the chat input.
- home-shelf: the shelf's `Recent chats`, `Relevant Notes`, and `Projects` tabs, with the project count on `Projects`; the last tab chosen stays selected for every new chat.
- home-recent-chats: `Recent chats` lists past chats as [chat rows](chat-rows.md), pinned chats first, filtered by `Search chats...`.
- home-archived: `View archived` under Recent chats lists archived chats and projects, each with `Unarchive`.
- home-relevant-notes: the `Relevant Notes` tab shows [Relevant Notes](relevant-notes.md); it is hidden while the Relevant Notes pane is open.
- home-projects: the `Projects` tab lists [projects](projects.md) with `New project` and `Search projects...`.
- home-project-start: inside a project, the shelf shows the project's `Recent chats` and its `Context`; a project with no chats shows its Context alone under the chat input.
- home-release-update: when a newer Copilot is out, a `Copilot <version> is ready` card offers `See what’s new` for the release notes, and `Dismiss release update`.

## How to get to it

- Open Agent Chat from the ribbon icon or the `Open Copilot Agent Chat window` command. A chat with no messages shows the start screen.
- `New chat` (**+**) in the [chat tabs](chat-tabs.md), or `New chat` in the [chat controls](chat-controls.md).
- Enter a project from the `Projects` tab to get that project's start screen.

## Driving it

- Greeting: open a new chat. A greeting shows above the chat input; the next new chat may show a different one.
- First message: send a message from the start screen. The greeting and shelf give way to the conversation, with `New chat`, `Chat history`, and `More actions` above the chat input.
- Shelf tab: choose `Projects`, close Agent Chat, and open it again. The shelf opens on `Projects`.
- Search: in `Recent chats`, type part of a chat title into `Search chats...`. Only matching chats remain; clearing the box brings the rest back.
- Archived: choose `View archived`. A list of archived chats and projects opens; `Unarchive` on a project returns it to `Projects` and raises the count.
- Relevant Notes: with a note open beside Agent Chat, choose `Relevant Notes`. `Relevant to` names the note and related notes are listed.
- Projects: choose `Projects`. `New project`, `Search projects...`, and the projects show; the count on the tab matches the list.
- Project start: enter a project that has chats. The greeting reads `Chat in <project>`, and the shelf has `Recent chats`, listing only that project's chats, and `Context`. Enter a project with no chats: the Context drop area shows under the chat input and there is no shelf.
- Release update: on a build older than the latest release, open a new chat. The `Copilot <version> is ready` card shows at the bottom; `See what’s new` opens the release notes, and `Dismiss release update` hides the card for that version.

## Gotchas

- Opening a project's chat from Recent chats or another list outside the project enters that project.
- The release update card shows only on the start screen outside a project.
- The shelf is the same whether or not the [Copilot Navigator](copilot-navigator.md) is open, so `Recent chats` and `Projects` repeat what the Navigator lists.
