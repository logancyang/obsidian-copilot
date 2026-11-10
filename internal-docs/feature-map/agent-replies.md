# Agent replies

How a reply appears in a conversation: streaming text, reasoning, tool and activity cards, subagents, and tasks.

## Sub-features

- reply-stream: the reply's text appears as the agent writes it.
- reply-tables: streamed Markdown tables keep their headers and body columns aligned; wide tables scroll horizontally inside the reply.
- reply-duration: `Agent is working` with a timer while the turn runs, then `Worked for <time>`.
- reply-reasoning: `Reasoning...` while the agent thinks, then `Thought for <time>`; expand it to read the reasoning.
- reply-activity: the agent's tool calls collapse into a one-line summary, such as `Ran 2 commands, read 1 file`; expand it to see each step.
- reply-image-reads: images returned by tools appear as small thumbnails beside their individual tool calls; collapsing a multi-tool activity group hides the images.
- reply-plan: the agent's `Plan` checklist, with each step's progress.
- reply-connector-tools: a tool call to a connected service is named `<service> · <tool>`, such as `Notion · Search`, with every agent; OpenCode calls retain `Execute` and list each distinct connector tool reported in execution metadata. Before that metadata arrives, they show `Execute`.
- reply-subagents: a subagent's card shows its type and task, such as `general-purpose · Count lines in notes.md`, with a spinner while it runs and a check when it is done. With Claude, open it to see its prompt, its steps, and its result, then `Back to chat`; with other agents it expands in place, with its `Prompt`.
- reply-tasks: a background command shows as a card with a spinner, then a check; open it to see the command and its output, then `Back to chat`.
- reply-task-follow-up: when a background task or subagent finishes, the agent replies again on its own.
- reply-multi-agent: a message that mentions other agents shows `Agent answers` from each, then a summary.
- reply-compaction: `Compacting conversation…`, then `Context compacted` with the token count before and after; when the context fills up, `Context is full, compacting…`, then `Context compacted automatically`.
- reply-files-changed: a turn that edited notes ends with its [turn diffs](turn-diffs.md).
- reply-actions: `Copy` and `Insert / Replace at cursor` under a finished reply.

## How to get to it

Send a message from the [chat input](chat-input.md). The reply shows below the message in Agent Chat. Running background tasks are also listed under `N tasks running` in the [chat controls](chat-controls.md).

## Driving it

- Stream and duration: send a short question. `Agent is working` shows with a timer, the reply's text appears, then `Worked for <time>`.
- Tables: ask for a Markdown table with short headers and long cell values. During streaming and after completion, headers align with their columns. In a narrow pane, a wide table scrolls horizontally without widening the reply.
- Reasoning: ask a question the agent thinks about. `Reasoning...` shows, then `Thought for <time>`; expand it to read the reasoning.
- Activity: ask the agent to run two shell commands. A summary such as `Ran 2 commands` shows; expand it to list each command.
- Image reads: ask the agent to read two images. The collapsed activity summary shows no images or preview labels. Expand the summary: each thumbnail appears with the tool that read it. Collapse it again: the thumbnails disappear.
- Plan: ask an agent with a plan tool to plan two steps and follow them. A `Plan` checklist shows each step's progress.
- Connector tool: with Notion connected, ask the agent to search Notion. The step reads `Notion · Search`, not the tool's internal name.
- OpenCode connector batch: ask OpenCode to search a connected service and create a page in one call. The finished step keeps `Execute` and names both tools reported by OpenCode. Before execution metadata arrives, the step shows `Execute`. Repeated calls to one tool list its name once.
- Subagent: ask Claude to start a subagent that reads a note. A card such as `general-purpose · Get first sentence of <note>` shows a spinner, then a check. Open it: the subagent's prompt, its steps, and its answer show. `Back to chat` returns to the conversation.
- Background task: ask Claude to run `ping -c 15 127.0.0.1` as a background command. Its card shows a spinner and the chat controls show `1 task running`. Open it: `Background command`, the command, and its output show.
- Follow-up: wait for the subagent or background command to finish. The agent posts a new reply about the result without a new message.
- Multi-agent: with multi-agent access, mention another agent with `@` → Agents and send. `Agent answers` lists each agent's answer, then a summary.
- Compaction: send `/compact`. `Compacting conversation…` shows, then `Context compacted · 41k → 12k tokens` (the numbers vary).
- Files changed: ask the agent to edit a note. The reply ends with the changed file and its added and removed lines.
- Copy: choose `Copy` under a finished reply. The reply's text is on the clipboard.
- Insert: place the cursor in a note and choose `Insert / Replace at cursor` under a finished reply. The reply's text is inserted at the cursor.

## Gotchas

- A finished background task or subagent starts a new agent reply on its own, so a chat can be running with no message from the user.
