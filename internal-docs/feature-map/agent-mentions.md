# Agent mentions

Asking another custom agent from a chat with `@`: that agent works in the background, and the chat's own agent brings its reply back.

## Sub-features

- mention-ask: in an agent's chat or a Copilot chat, a message that `@`-mentions a custom agent by name, such as `@Maya what do you think of this plan?`, hands that agent the request.
- mention-one-line: the chat's agent answers in one line, such as "Maya's reading it. I'll bring back what she says.", and its turn ends. The chat input is free while the other agent works.
- mention-status: under the message that asked, one line per mentioned agent says where it is: `Maya is working` with a clock counting up, `Maya has a question` and `Maya needs your OK` with the clock held while she waits, `Maya finished` with how long it took and `See reply ↓`, which scrolls to the relayed reply, `Maya stopped` (`Maya stopped · Maya was deleted` when the agent was deleted), or `Maya didn't finish` with the reason: `Obsidian was closed`, or `Something went wrong` with `Details` for the error. A chat opened again shows the same lines.
- mention-tool-lines: in the chat agent's reply, each thing it does with a mentioned agent is one line with that agent's face: `Asked Maya · <the message it sent>`, which opens to the full message, `Checked Maya's progress`, `Passed your answer to Maya` and `Stopped Maya`. A call that failed or named no agent the chat can ask keeps its ordinary row.
- mention-keep-chatting: messages sent while the other agent works get their own answers.
- mention-relay: when the other agent is done, a new turn at the end of the chat passes its reply on, keeping its position as strong as it was, then adding the chat agent's own view.
- mention-reply-row: the turn starts with the other agent's face and `<name>'s reply`, folded; opening it shows that agent's own words. A Files changed card for the files it changed follows, each row opening its diff, then the chat agent's own words. A relay of the agent's question folds as `<name>'s question` beside an orange bar, and a run that didn't finish folds as red `<name> didn't finish` beside a red bar, with the reason inside. The same shows in a Copilot chat.
- mention-continue: mentioning the same agent again in the same chat continues its conversation, so it remembers the earlier exchange.
- mention-redirect: a new instruction for an agent that still works, such as "Tell Maya to skip the outro.", reaches it in the same conversation. The chat's agent says it passed it on; on Codex and OpenCode models the other agent gets it after its current step.
- mention-question: when the other agent can't go on without the user, its question comes back as a turn that starts with the other agent's words, and the chat's agent asks it in its own words. The user answers in the chat input as usual; the chat's agent passes the answer on and the other agent carries on in the same conversation. Until the user answers, the other agent waits; asking about something else meanwhile gets its own answer.
- mention-progress: asking the chat's agent how the other agent is doing, such as "How's Maya doing?", gets an answer from that agent's progress so far: how long it has worked, what it has written and its latest steps, or the question it is waiting on. The other agent isn't interrupted.
- mention-permission: in a mode that asks before changes, the mentioned agent's request shows in this chat as a [permission card](permission-requests.md) with its face and name. The answer goes straight back to it; the chat's agent runs no turn for it. In `Plan` mode the mentioned agent changes nothing and says what it would have changed.
- mention-didnt-finish: when the other agent hits an error or its process ends, the chat's agent says it didn't finish, why, and how far it got. There is no Retry: telling the chat's agent to send it back, such as "Send Maya back to it.", continues the same conversation.
- mention-resume: mentioning an agent again after Obsidian restarts continues the conversation it had in that chat, so it remembers the earlier exchange.
- mention-stop: telling the chat's agent to stop the other agent, such as "Tell Maya to stop.", stops it at once. Its changes stay, and the chat's agent says how far it got, with a Files changed card for what it changed. Mentioning it again continues the same conversation.
- mention-delete-while-working: deleting an agent from its profile while it works for another chat stops it. The delete dialog says so in an orange line, such as "Maya is working in Coco's chat. Deleting stops it."; the chat's agent then says how far it got.
- mention-cant-remember: asked through a mention to remember something, the mentioned agent saves nothing; the chat's agent says it can't save rules from a chat it was asked into, and to tell it in its own chat.
- mention-no-self: an agent never asks itself; its own name is plain text in its chat.

## How to get to it

- Type `@` and an agent's name with the request in the chat input of an agent's chat or a Copilot chat, then send.

## Driving it

All of these need a license that includes custom agents and at least two agents in the vault, one of them Maya.

- Ask: in a chat with another agent, send `@Maya what do you think of this plan? Six features in 90 seconds.` The agent answers in one line and its turn ends; Send is available again.
- Status: after sending the mention, the line under the message reads `Maya is working` and its clock counts up each second. When the reply comes back it reads `Maya finished` with the time; `See reply ↓` scrolls to the reply at the end of the chat.
- Tool line: under the reply that asked, `Asked Maya · ` and the start of the message the chat's agent sent shows with Maya's face. Choose it: the full message opens below.
- Keep chatting: while Maya works, send an unrelated question. It gets its own answer.
- Relay: when Maya is done, a new turn at the end of the chat shows Maya's face and `Maya's reply`, folded, then the chat's agent brings back her view. Open the fold: her own words show. If she disagrees with the plan, the reply says so plainly.
- Files changed: in `Auto` mode, send `@Maya add one line to <note>`. The relayed turn shows Files changed with that note; its row opens the diff.
- Continue: after the relay, send `@Maya and the intro?`. Her answer builds on the first exchange.
- From a Copilot chat: in a chat with no agent, send `@Maya is this too long?`. The same one line, then the relay.
- Permission: in `Safe` mode, send `@Maya add one line to <note>`. `Permission required` shows Maya's face and "Maya wants to run …". Choose `Allow once`: the note changes, and the relayed turn shows Files changed with it. Send another and choose `Deny once`: the note stays unchanged. In `Plan` mode the note stays unchanged and no card shows.
- Redirect: while Maya works, send `Tell Maya to leave the intro alone.` The chat's agent says it passed it on, and Maya's reply follows the new instruction.
- Question: give Leo an instruction such as "Before changing any note, ask the user which month.", then send `@Leo reconcile the books`. The chat's agent asks which month. Answer `October.` The chat's agent says it passed the answer on, and Leo's reply follows it.
- Progress: while Maya works, send `How's Maya doing?`. The chat's agent says how far she got without stopping her.
- Didn't finish: while Maya works, end her agent's process. The chat's agent says she didn't finish and why. Send `Send Maya back to it.`; her reply builds on what she had done.
- Resume: after a relay, reload the plugin, open the chat from Recent chats, and send `@Maya what did you tell me before?`. She recalls the earlier exchange.
- Stop: send `@Maya check every claim in <note>, one by one`, then `Tell Maya to stop.` while she works. The chat's agent stops her, then says how far she got; the note keeps any change she made.
- Delete while working: send `@Maya …` with a long job, open Maya's profile, and choose Delete. The dialog shows `Maya is working in <agent>'s chat. Deleting stops it.` in orange. After Delete, the chat's agent says Maya was deleted and how far she got.
- Can't remember: send `@Maya from now on, flag video length first.` The relay says Maya can't save rules from a chat she was asked into; her `MEMORY.md` does not change.
- Itself: in Maya's own chat, send `@Maya hello`. Maya answers directly.

## Gotchas

- Without a license that includes custom agents, `@<name>` is plain text for the chat's own agent.
- A mentioned agent never saves rules to its memory and never changes its instruction, whatever the mode. Rules for it belong in its own chat.
- The mentioned agent works in a chat no list shows: not in the [chat tabs](chat-tabs.md), Recent chats or the [Copilot Navigator](copilot-navigator.md).
- A chat can mention agents only if it was opened while custom agents were available: a chat keeps the tools it started with.
- Closing Obsidian, shutting the chat down, or losing the license stops the mentioned agent; its reply never comes back.
- The chat's note saves a stopped mention as stopped, and one stopped by deleting the agent as stopped because it was deleted.
- A settings change that restarts the chat's agent or the mentioned agent's waits until the mentioned agent's turn ends. While the mentioned agent waits for the user's answer, the restart goes ahead and stops it.
- Stopping the chat's own reply doesn't drop a mentioned agent's reply that is waiting; it comes back after the stop. Stopping the turn that passes the reply on ends it there.
- A mentioned agent's permission card stays when the chat's own reply is stopped. Stopping or deleting that agent, closing the chat, or closing Obsidian takes the card away, and the agent's request counts as turned down.
- On Codex models, `No, and tell Codex what to do differently` ends the mentioned agent's turn without a reply; the chat's agent says the user turned the request down.
- The chat's note keeps each mention's agent and how it ended, so it survives a restart. An agent that was still working when Obsidian closed is saved as not finished. Mentioning it again continues the conversation only while its agent still keeps it; otherwise a new conversation starts.
- The mentioned agent works in the chat's project folder, in the chat's mode, on its own model.
