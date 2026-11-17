# Plan proposals

Plan cards in the conversation in Plan mode, where the agent waits for the user to approve, reject, or redirect its plan.

## Sub-features

- card-plan: a card titled with the plan's name and marked `Pending` offers `Open`, `Reject`, `Approve`, or feedback with `Send`; the [chat input](chat-input.md) is dimmed until the user decides.
- card-plan-preview: `Open` shows the whole plan in a `Plan proposal` tab, marked `Read-only`, with `Reject` and `Approve`.

## How to get to it

Choose `Plan` in `Mode` in the [chat input](chat-input.md), then ask for a plan.

## Driving it

- Plan: in `Plan` mode, ask for a short plan to add a heading to a note. A card titled with the plan, marked `Pending`, shows its first lines, and the chat input is dimmed.
- Preview: choose `Open`. A `Plan proposal` tab shows the whole plan, `Read-only`, with `Reject` and `Approve`.
- Feedback: type a change into "Give feedback to redirect the plan…" and choose `Send`. The trail reads `Requested plan changes: <your text>` and the same card shows the revised plan, still `Pending`.
- Approve: choose `Approve`. The card goes away, the trail reads `Approved plan`, and the agent starts the work. With Claude, `Mode` returns to the mode the chat's last message outside `Plan` was sent in, such as `Safe`, and the work runs in that mode.
- Reject: on a new plan, choose `Reject`. The card goes away, the trail reads `Rejected plan`, and the agent stops without changing anything.

## Gotchas

- With Claude, approving a plan in a chat that started in `Plan` switches `Mode` to `Auto`, so the edits that follow do not ask for [permission](permission-requests.md).
