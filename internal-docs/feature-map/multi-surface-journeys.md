# Multi-surface journeys

Journeys that span several features. Each surface's controls are in its own file; read those first.

## Chat lifetime across tabs and the Navigator

A tab is an open chat: its agent keeps running until the user closes the tab. The Navigator has no tabs: moving to another chat stops the agent of the chat left behind, unless the user worked in it. A chat's agent is running when its [row](chat-rows.md) offers `Close chat` or shows `Session open`.

- Tabs keep chats: with the Navigator closed, open a past chat from Recent chats, then choose `New chat` (**+**). Both tabs stay, and the past chat's row still offers `Close chat`.
- Close an untouched tab: close the past chat's tab without sending anything. Its row stays but no longer offers `Close chat`.
- Close a worked-in tab: send a message, wait for the reply, close the tab. Its row still offers `Close chat`, and opening it brings back the same conversation.
- Navigator browsing stops agents: in the Navigator, open chat A without sending, then chat B. A no longer shows `Session open`.
- Navigator keeps worked-in chats: send a message in A, then open B. A still shows `Session open`.
- Tabs come back: close the Navigator. One tab shows for every chat whose agent is running.

Gotchas:

- Unsent text left in a chat counts as working in it.
- A past chat reopened from history counts as untouched until the user sends a message.
- While the Navigator is open, `New chat` and `Chat history` above the message box follow tab rules, so the chat left behind keeps its agent. A new Navigator action that switches chats must stop it, or agents pile up.
- Every running agent costs memory, a few hundred MB each for Claude.

## Chats inside projects

- Enter a project from the Projects shelf. Only that project's tabs show. Leave the project; the other tabs return with their chats still open.
