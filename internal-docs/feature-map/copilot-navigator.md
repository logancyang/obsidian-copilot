# Copilot Navigator

The Copilot Navigator lets a user browse chats and projects from a sidebar. It has no tabs: moving to another chat stops the agent of the chat left behind, unless the user worked in it.

## Sub-features

- `nav-list` lists chats and projects; a project folder expands to show its chats without entering the project.
- `nav-status` shows each chat's state: green dot (agent running), spinner (responding), waiting for permission, bold title (unread result).
- `nav-open-chat` shows a chat in Agent Chat and stops the chat left behind if the user only looked at it.
- `nav-new-chat` starts a new chat, globally or inside a project, under the same rule.
- `nav-new-project` creates a project and opens it, under the same rule.
- `nav-archived` opens an archived chat or project from `View archived`, under the same rule.
- `nav-row-menu` offers `Close chat`, rename, pin, archive, and delete on each chat.
- `nav-hides-tabs` hides the chat tabs while the Navigator is open and restores them when it closes.
- `nav-upgrade` shows an upgrade prompt instead of the Navigator without Navigator access.

## How to get to it (user POV)

- Run the `Open Copilot Navigator` command.
- Choose `Open Copilot Navigator` at the left of the chat tabs.

## Driving it with the Obsidian CLI

Preconditions:

- Baseline state per the [README](./README.md).
- A license with Navigator access is entered in the scratch vault.

- **Open the Navigator.** Run `Open Copilot Navigator`. The sidebar lists chats and projects, and the chat tabs hide.
- **Browse without working.** Choose chat A, then chat B. A has no green dot; B shows in Agent Chat.
- **Worked-in chat stays.** Choose A, send a message, wait for the reply, then choose B. A keeps its green dot.
- **New chat.** Choose `New chat`. B loses its green dot; A keeps it.
- **Tabs return.** Close the Navigator. The chat tabs return, one per chat with a green dot.
- **Proof.** Screenshot the Navigator after each step, with the green dots visible.

## Gotchas

- Agent Chat's own `New chat` and Recent chats follow tab rules, so while the Navigator is open they do not stop the chat left behind. Any new way to switch chats from the Navigator must stop it, or agents pile up behind green dots.
- The upgrade prompt has no close button; press Escape.
- In the test vault, settings open in a popout window. Turn that off before entering a license.
