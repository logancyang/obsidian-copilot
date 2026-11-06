# Decision cards

Cards in the conversation that wait on the user: permission requests, questions, plan proposals, and status and error cards.

## Sub-features

- card-permission: `Permission required` says who wants to run what ("The agent wants to run …", or a subagent by name), with its `Type`, the change or `Show details`, and the agent's choices, such as `Allow once`, `Allow always`, and `Deny once`. An "always" choice explains on hover what it covers.
- card-question: `Question from agent` offers answers to pick, or `Other` to type one, then `Submit` (`Next` when it asks several questions) or `Cancel`.
- card-plan: in Plan mode, a card titled with the plan's name and marked `Pending` offers `Open`, `Reject`, `Approve`, or feedback with `Send`; the [chat input](chat-input.md) is dimmed until the user decides.
- card-plan-preview: `Open` shows the whole plan in a `Plan proposal` tab, marked `Read-only`, with `Reject` and `Approve`.
- card-task-approval: a background task waiting on a permission shows `Needs approval`; inside the task, "The chat is waiting for your answer." with `Open chat`.
- card-agent-status: when the chat's agent cannot run, a card offers `Install <agent>`, `Update`, `Configure <agent>`, or `Sign in` ([agent setup](agent-setup.md)).
- card-settings-changed: `<agent> settings changed` with `Reload`.
- card-error: `<agent> ran into a problem` with the error and `Retry`.
- card-feedback: after a failed reply, or when the agent suggests it, `Report this to the Copilot team?` shows a draft title and what the user said, and offers `Review & report`, `Dismiss`, or `Don't offer again`; once sent it reads `Report sent to the Copilot team` with the report ID.

## How to get to it (user POV)

The cards show at the bottom of the conversation in Agent Chat when the agent needs the user:

- Permission: choose `Safe` in `Mode` in the [chat input](chat-input.md), then ask the agent to create or edit a note.
- Question: ask the agent to ask you something with choices.
- Plan: choose `Plan` in `Mode`, then ask for a plan.
- Task approval: in `Safe` mode, ask the agent to run a background subagent that edits a note. Open the task from its card in the conversation or from `N tasks running` in the [chat controls](chat-controls.md).
- Agent status and settings changed: change the agent in [agent setup](agent-setup.md) while its chat is open.
- Feedback: tell the agent something went wrong and ask it to report it to the Copilot team. `Offer feedback reports in Agent Chat` in Settings → Advanced turns these cards on or off.

## Driving it

- Permission, allow: in `Safe` mode, ask Claude to create a note with the Write tool. `Permission required` shows "The agent wants to run Write <path>.", `Type: edit`, and `Show details`, which opens to the file and its content. Choose `Allow once`. The card goes away, the trail reads `Edited <note>`, and the note exists.
- Permission, scope: hover `Allow always`. A tooltip says what it covers, such as "Covers all file edits until this chat ends. Start a new chat to undo."
- Permission, deny: ask for another note and choose `Deny once`. The trail reads `Didn't edit <note>` and the agent says the write was declined.
- Question: ask Claude to ask which color you prefer, with options Red and Blue. `Question from agent` lists Red, Blue, and `Other`; `Submit` stays disabled until you pick. Choose `Other`, type Green, choose `Submit`. The trail reads `Answered: Green` and the agent replies with Green.
- Plan: in `Plan` mode, ask for a short plan to add a heading to a note. A card titled with the plan, marked `Pending`, shows its first lines, and the chat input is dimmed.
- Plan preview: choose `Open`. A `Plan proposal` tab shows the whole plan, `Read-only`, with `Reject` and `Approve`.
- Plan feedback: type a change into "Give feedback to redirect the plan…" and choose `Send`. The trail reads `Requested plan changes: <your text>` and the same card shows the revised plan, still `Pending`.
- Plan approve: choose `Approve`. The card goes away, the trail reads `Approved plan`, and the agent starts the work.
- Plan reject: on a new plan, choose `Reject`. The card goes away, the trail reads `Rejected plan`, and the agent stops without changing anything.
- Task approval: in `Safe` mode, ask Claude to launch a background subagent that creates a note. `Permission required` names the subagent: `general-purpose "<task>" wants to run Write <path>`. `1 task running` lists the task as `Needs approval`. Open the task: "The chat is waiting for your answer." shows with `Open chat`, which returns to the conversation and its card.
- Agent status: with a chat open, sign the agent out from `Configure <agent>`. A card reads `<agent> not signed in` with `Sign in`.
- Settings changed: with a chat open on OpenCode or Codex, add a variable under that agent's `Environment variables` in Settings. A card reads `<agent> settings changed`; choose `Reload` and the card goes away.
- Error: set `Default agent` to an agent that is not set up, then choose `New chat`. A card reads `<agent> ran into a problem`, says the agent isn't set up and where to set it up, and offers `Retry`.
- Feedback: tell Claude something looked broken and ask it to report it to the Copilot team. `Report this to the Copilot team?` shows a title and "You said: …". Choose `Review & report`: [Report an issue](report-issue.md) opens with the draft under "What went wrong?" and every attachment ticked. Cancel it and choose `Dismiss`; the card goes away.

## Gotchas

- Permissions and questions from a background subagent show only in the main conversation, never in the task's own view.
- Approving a plan does not leave Plan mode. With Claude, the edits that follow still ask for permission one by one.
- `Don't offer again` turns off `Offer feedback reports in Agent Chat` for every chat.
