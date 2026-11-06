# Decision cards

Cards that ask the user to act: permission requests, questions, plan proposals, and status and error cards.

## Sub-features

- card-permission: `Permission required` names what the agent wants to run, shows the change or `Show details`, and offers the agent's allow and reject choices; an "always" choice explains on hover what it covers.
- card-question: `Question from agent` offers answers to pick, or `Other` to type one, then `Submit`.
- card-plan: in Plan mode, `Plan proposed` offers `Open`, `Approve`, `Reject`, or feedback with `Send`; the [chat input](chat-input.md) is dimmed until the user decides.
- card-task-approval: a task waiting on a permission shows `Needs approval`; inside the task, "The chat is waiting for your answer." with `Open chat`.
- card-agent-status: when the agent cannot start, a card offers `Install <agent>`, `Update`, `Configure <agent>`, or `Sign in` ([agent setup](agent-setup.md)).
- card-settings-changed: `<agent> settings changed` with `Reload`.
- card-error: `<agent> ran into a problem` with `Retry`.
- card-feedback: after a failed reply, or when the agent suggests it, `Report this to the Copilot team?` offers `Review & report`, `Dismiss`, or `Don't offer again`; once sent it reads `Report sent to the Copilot team`.

Only the sub-features are mapped so far, and they may not cover everything this feature does. To map the rest, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).
