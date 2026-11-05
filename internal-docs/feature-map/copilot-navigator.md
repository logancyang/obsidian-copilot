# Copilot Navigator

A sidebar listing chats and projects. While it is open, the chat tabs are hidden.

## Sub-features

- nav-toggle: open and close the Navigator; the chat tabs hide while it is open and return when it closes.
- nav-search: `Search chats` filters the list.
- nav-sections: chats grouped under Pinned, Projects, and Recents.
- nav-new-chat: `New chat` at the top starts a chat outside any project.
- nav-project-folders: a project folder expands to its chats without entering the project; `New chat in <project>` starts a chat there.
- nav-new-project: `New project` creates a project and opens it.
- nav-reorder: drag pinned chats and projects to reorder them.
- nav-archived: `Sidebar options` → View archived lists archived chats and projects to open or unarchive.
- nav-upgrade: without Navigator access, opening it shows an upgrade prompt instead.

Each chat in the list is a [chat row](chat-rows.md).

## How to get to it (user POV)

Run the `Open Copilot Navigator` command, or choose `Open Copilot Navigator` at the left of the chat tabs. Needs a license with Navigator access.

## Driving it with the Obsidian CLI

- Open: run `Open Copilot Navigator`. The sidebar shows Pinned and Recents, and the chat tabs hide.
- Search: type part of a chat title into `Search chats`. Only matching chats remain.
- Folder: choose a project folder. Its chats show, and Agent Chat still shows the same chat.
- New chat in a project: hover a folder and choose `New chat in <project>`. Agent Chat shows a new chat inside that project.
- Archived: choose `Sidebar options` → View archived. Archived chats are listed; Unarchive returns one to Recents.
- Close: close the Navigator. The chat tabs return.
- What switching chats from the Navigator does to their agents is driven in [multi-surface-journeys](multi-surface-journeys.md).

## Gotchas

- The upgrade prompt has no close button; press Escape.
- In the test vault, settings open in a popout window. Turn that off before entering a license.
- Reordering is drag only. If the driver cannot drag, mark it manual instead of claiming coverage.
