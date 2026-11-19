# Agent mentions

Asking another custom agent from a chat with `@`: that agent works in the background, and the chat's own agent brings its reply back.

## Sub-features

- mention-ask: in an agent's chat or a Copilot chat, a message that `@`-mentions a custom agent by name, such as `@Maya what do you think of this plan?`, hands that agent the request.
- mention-one-line: the chat's agent answers in one line, such as "Maya's reading it. I'll bring back what she says.", and its turn ends. The chat input is free while the other agent works.
- mention-keep-chatting: messages sent while the other agent works get their own answers.
- mention-relay: when the other agent is done, a new turn at the end of the chat passes its reply on, keeping its position as strong as it was, then adding the chat agent's own view.
- mention-reply-row: the turn starts with `<name>'s reply` and the other agent's own words set off by a bar, then a Files changed card for the files it changed; each row opens its diff.
- mention-continue: mentioning the same agent again in the same chat continues its conversation, so it remembers the earlier exchange. Mentioning it while it still works gets a reply that it is still working.
- mention-denied: in a mode that asks before changes, the mentioned agent can't change files; the chat's agent says what it couldn't do.
- mention-cant-remember: asked through a mention to remember something, the mentioned agent saves nothing; the chat's agent says it can't save rules from a chat it was asked into, and to tell it in its own chat.
- mention-no-self: an agent never asks itself; its own name is plain text in its chat.

## How to get to it

- Type `@` and an agent's name with the request in the chat input of an agent's chat or a Copilot chat, then send.

## Driving it

All of these need a license that includes custom agents and at least two agents in the vault, one of them Maya.

- Ask: in a chat with another agent, send `@Maya what do you think of this plan? Six features in 90 seconds.` The agent answers in one line and its turn ends; Send is available again.
- Keep chatting: while Maya works, send an unrelated question. It gets its own answer.
- Relay: when Maya is done, a new turn at the end of the chat shows `Maya's reply` with her words, then the chat's agent brings back her view. If she disagrees with the plan, the reply says so plainly.
- Files changed: in `Auto` mode, send `@Maya add one line to <note>`. The relayed turn shows Files changed with that note; its row opens the diff.
- Continue: after the relay, send `@Maya and the intro?`. Her answer builds on the first exchange.
- From a Copilot chat: in a chat with no agent, send `@Maya is this too long?`. The same one line, then the relay.
- Denied: in `Default` mode, send `@Maya add one line to <note>`. The note does not change, and the relay says Maya couldn't edit it.
- Can't remember: send `@Maya from now on, flag video length first.` The relay says Maya can't save rules from a chat she was asked into; her `MEMORY.md` does not change.
- Itself: in Maya's own chat, send `@Maya hello`. Maya answers directly.

## Gotchas

- Without a license that includes custom agents, `@<name>` is plain text for the chat's own agent.
- A mentioned agent never saves rules to its memory and never changes its instruction, whatever the mode. Rules for it belong in its own chat.
- The mentioned agent works in a chat no list shows: not in the [chat tabs](chat-tabs.md), Recent chats or the [Copilot Navigator](copilot-navigator.md).
- A chat can mention agents only if it was opened while custom agents were available: a chat keeps the tools it started with.
- Closing Obsidian, shutting the chat down, or losing the license stops the mentioned agent; its reply never comes back.
- A settings change that restarts the chat's agent also stops the mentioned agent, and its reply never comes back.
- Stopping the chat's own reply doesn't drop a mentioned agent's reply that is waiting; it comes back after the stop. Stopping the turn that passes the reply on ends it there.
- On Codex models, a Copilot chat with no agent usually answers an `@`-mention itself: Codex finds the tool only through its own tool search, and only an agent's chat names the tool in its prompt.
- The chat's note keeps each mention's agent and how it ended, so it survives a restart. An agent that was still working when Obsidian closed is saved as not finished, and mentioning it again after a restart starts a new conversation with it.
- The mentioned agent works in the chat's project folder, in the chat's mode, on its own model.
