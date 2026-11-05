# Multi-surface journeys

Behavior no single surface owns: the outcome depends on what happens on several surfaces at once or in sequence. Each surface's controls and rules are in its own file; read those first.

## Two chats replying at once

Chats running at the same time must not affect each other.

- Send a long request in chat A. While A replies, open chat B from the [chat tabs](chat-tabs.md) and send a request there.
- Both replies finish. Each conversation holds only its own messages, and A's tab shows the finished dot.
- Switch back to A. Its full reply is there, and B's reply is not.

Touches: chat tabs, `chat-input`, `agent-replies`.

## Permission request from a chat in the background

A chat that needs the user's permission must reach them wherever they are.

- In chat A, ask for something that needs permission, such as editing a note, and switch to chat B before the request appears.
- Open the [Copilot Navigator](copilot-navigator.md). A's [row](chat-rows.md) shows `Waiting for permission`.
- Open A. The permission card is waiting. Allow it, and A carries on to the end of its reply.

Touches: chat tabs, Copilot Navigator, chat rows, `agent-prompts`.
