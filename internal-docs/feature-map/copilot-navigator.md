# Copilot Navigator

A sidebar listing chats and projects. It has no tabs: moving to another chat stops the agent of the chat left behind, unless the user worked in it.

## Sub-features

- nav-toggle: open and close the Navigator; the chat tabs hide while it is open and return when it closes, one per chat whose agent is running.
- nav-search: `Search chats` filters the list.
- nav-sections: chats grouped under Pinned, Projects, and Recents.
- nav-open-chat: click a chat to show it in Agent Chat. The chat left behind stops its agent unless the user sent a message or left unsent text in it.
- nav-new-chat: `New chat` at the top starts a chat outside any project, under the same rule.
- nav-project-folders: a project folder expands to its chats without entering the project; `New chat in <project>` starts a chat there, under the same rule.
- nav-new-project: `New project` creates a project and opens it, under the same rule.
- nav-reorder: drag pinned chats and projects to reorder them.
- nav-archived: `Sidebar options` → View archived lists archived chats and projects to open or unarchive, under the same rule.
- nav-upgrade: without Navigator access, opening it shows an upgrade prompt instead.

Each chat in the list is a [chat row](chat-rows.md).

## How to get to it (user POV)

Run the `Open Copilot Navigator` command, or choose `Open Copilot Navigator` at the left of the chat tabs. Needs a license with Navigator access.

## Driving it

- Open: run `Open Copilot Navigator`. The sidebar shows Pinned and Recents, and the chat tabs hide.
- Browse: open chat A without sending anything, then chat B. A no longer shows `Session open`.
- Worked-in: open A, send a message, wait for the reply, then open B. A still shows `Session open`.
- Search: type part of a chat title into `Search chats`. Only matching chats remain.
- Folder: choose a project folder. Its chats show, and Agent Chat still shows the same chat.
- New chat in a project: hover a folder and choose `New chat in <project>`. Agent Chat shows a new chat inside that project.
- Archived: choose `Sidebar options` → View archived. Archived chats are listed; Unarchive returns one to Recents.
- Close: close the Navigator. The chat tabs return, one per chat still showing `Session open`.

## Gotchas

- While the Navigator is open, `New chat` and `Chat history` above the chat input follow tab rules, so the chat left behind keeps its agent. Any new Navigator action that switches chats must stop it, or agents pile up.
- The upgrade prompt has no close button; press Escape.
- In the test vault, settings open in a popout window. Turn that off before entering a license.
- Reordering is drag only. If the driver cannot drag, mark it manual instead of claiming coverage.
