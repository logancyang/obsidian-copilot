# Agent mentions

Asking another custom agent from a chat with `@`: that agent works in the background, and the chat's own agent brings its reply back.

## Sub-features

- mention-ask: in an agent's chat or a Copilot chat, a message that `@`-mentions a custom agent by name, such as `@Maya what do you think of this plan?`, hands that agent the request.
- mention-one-line: the chat's agent answers in one line, such as "Maya's reading it. I'll bring back what she says.", and its turn ends. The chat input is free while the other agent works.
- mention-keep-chatting: messages sent while the other agent works get their own answers.
- mention-relay: when the other agent is done, a new turn at the end of the chat passes its reply on, keeping its position as strong as it was, then adding the chat agent's own view.
- mention-cant-remember: asked through a mention to remember something, the mentioned agent saves nothing; the chat's agent says it can't save rules from a chat it was asked into, and to tell it in its own chat.
- mention-no-self: an agent never asks itself; its own name is plain text in its chat.

## How to get to it

- Type `@` and an agent's name with the request in the chat input of an agent's chat or a Copilot chat, then send.

## Driving it

All of these need a license that includes custom agents and at least two agents in the vault, one of them Maya.

- Ask: in a chat with another agent, send `@Maya what do you think of this plan? Six features in 90 seconds.` The agent answers in one line and its turn ends; Send is available again.
- Keep chatting: while Maya works, send an unrelated question. It gets its own answer.
- Relay: when Maya is done, a new turn at the end of the chat brings back her view. If she disagrees with the plan, the reply says so plainly.
- From a Copilot chat: in a chat with no agent, send `@Maya is this too long?`. The same one line, then the relay.
- Can't remember: send `@Maya from now on, flag video length first.` The relay says Maya can't save rules from a chat she was asked into; her `MEMORY.md` does not change.
- Itself: in Maya's own chat, send `@Maya hello`. Maya answers directly.

## Gotchas

- Without a license that includes custom agents, `@<name>` is plain text for the chat's own agent.
- A mentioned agent never saves rules to its memory and never changes its instruction, whatever the mode. Rules for it belong in its own chat.
- The mentioned agent works in a chat no list shows: not in the [chat tabs](chat-tabs.md), Recent chats or the [Copilot Navigator](copilot-navigator.md).
- A chat can mention agents only if it was opened while custom agents were available: a chat keeps the tools it started with.
- Closing Obsidian stops the mentioned agent; its reply never comes back.
- The mentioned agent works in the chat's project folder, in the chat's mode, on its own model.
