# Permission requests

`Permission required` cards at the bottom of the conversation, where the agent waits for the user to allow or deny a tool call.

## Sub-features

- card-permission: `Permission required` says who wants to run what ("The agent wants to run …", or a subagent by name), with its `Type`, the change or `Show details`, and the agent's choices, such as `Allow once`, `Allow always`, and `Deny once`. An "always" choice explains on hover what it covers.
- card-connector-tool: a connected service's write tool is named like its [reply](agent-replies.md) step: "The agent wants to run <service> · <tool>.", while OpenCode shows `Execute` until it reports execution metadata.
- card-connector-batch: an OpenCode approval shows `Execute` and exposes its code in details; the completed reply step lists the connector tools OpenCode reports.
- card-task-approval: a background task waiting on a permission shows `Needs approval`; inside the task, "The chat is waiting for your answer." with `Open chat`.

## How to get to it

- Choose `Safe` in `Mode` in the [chat input](chat-input.md), then ask the agent to create or edit a note.
- Task approval: in `Safe` mode, ask the agent to run a background subagent that edits a note. Open the task from its card in the conversation or from `N tasks running` in the [chat controls](chat-controls.md).

## Driving it

- Allow: in `Safe` mode, ask Claude to create a note with the Write tool. `Permission required` shows "The agent wants to run Write <path>.", `Type: edit`, and `Show details`, which opens to the file and its content. Choose `Allow once`. The card goes away, the trail reads `Edited <note>`, and the note exists.
- Scope: hover `Allow always`. A tooltip says what it covers, such as "Covers all file edits until this chat ends. Start a new chat to undo."
- Allow always: on a Claude Write card that covers all file edits, choose `Allow always`. `Mode` shows `Auto`, and later edits run without a card until you choose `Safe`.
- Deny: ask for another note and choose `Deny once`. The trail reads `Didn't edit <note>` and the agent says the write was declined.
- Connector tool: in `Safe` mode, with a service connected, ask the agent to create something in it. `Permission required` reads "The agent wants to run <service> · <tool>."; OpenCode shows `Execute`, and `Show details` shows the code it proposes to run.
- Connector batch: in `Safe` mode, ask OpenCode to run a connector's read and write tools in one block. The approval shows `Execute`. Allow it and check that the finished step keeps `Execute` and lists both tools reported by OpenCode.
- Task approval: in `Safe` mode, ask Claude to launch a background subagent that creates a note. `Permission required` names the subagent: `general-purpose "<task>" wants to run Write <path>`. `1 task running` lists the task as `Needs approval`. Open the task: "The chat is waiting for your answer." shows with `Open chat`, which returns to the conversation and its card.

## Gotchas

- With Claude and OpenCode, a connector tool the service marks read-only runs without a card even in `Safe` mode; its [tools page](connector-tools-page.md) lists it under `Read only`.
- Permission requests and [questions](agent-questions.md) from a background subagent show only in the main conversation, never in the task's own view.
