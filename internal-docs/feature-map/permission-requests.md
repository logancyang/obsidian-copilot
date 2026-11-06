# Permission requests

`Permission required` cards at the bottom of the conversation, where the agent waits for the user to allow or deny a tool call.

## Sub-features

- card-permission: `Permission required` says who wants to run what ("The agent wants to run …", or a subagent by name), with its `Type`, the change or `Show details`, and the agent's choices, such as `Allow once`, `Allow always`, and `Deny once`. An "always" choice explains on hover what it covers.
- card-task-approval: a background task waiting on a permission shows `Needs approval`; inside the task, "The chat is waiting for your answer." with `Open chat`.

## How to get to it

- Choose `Safe` in `Mode` in the [chat input](chat-input.md), then ask the agent to create or edit a note.
- Task approval: in `Safe` mode, ask the agent to run a background subagent that edits a note. Open the task from its card in the conversation or from `N tasks running` in the [chat controls](chat-controls.md).

## Driving it

- Allow: in `Safe` mode, ask Claude to create a note with the Write tool. `Permission required` shows "The agent wants to run Write <path>.", `Type: edit`, and `Show details`, which opens to the file and its content. Choose `Allow once`. The card goes away, the trail reads `Edited <note>`, and the note exists.
- Scope: hover `Allow always`. A tooltip says what it covers, such as "Covers all file edits until this chat ends. Start a new chat to undo."
- Deny: ask for another note and choose `Deny once`. The trail reads `Didn't edit <note>` and the agent says the write was declined.
- Task approval: in `Safe` mode, ask Claude to launch a background subagent that creates a note. `Permission required` names the subagent: `general-purpose "<task>" wants to run Write <path>`. `1 task running` lists the task as `Needs approval`. Open the task: "The chat is waiting for your answer." shows with `Open chat`, which returns to the conversation and its card.

## Gotchas

- Permission requests and [questions](agent-questions.md) from a background subagent show only in the main conversation, never in the task's own view.
