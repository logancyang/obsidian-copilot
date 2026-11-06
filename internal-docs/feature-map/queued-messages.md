# Queued messages

Messages the user sends while the agent is still working, listed above the [chat input](chat-input.md) until the agent reads them or finishes.

## Sub-features

- queue-next-step: with Claude, a message sent mid-reply lists under `The agent reads these at its next step`.
- queue-held: with other agents, for `/compact`, for messages that mention another agent, and for any message sent while the agent is starting, it lists under `Sends when the agent finishes`.
- queue-send-now: `Send now` stops the agent's current reply and has it read the waiting messages right away.
- queue-withdraw: `Withdraw queued message` takes back a message before the agent reads it and puts it back in the chat input.
- queue-remove: `Remove queued message` deletes a held message.
- queue-combine: held messages go out together as one message when the agent finishes; `/compact` always goes alone.
- queue-stop: stopping the reply puts held messages back in the chat input instead of sending them.

## How to get to it (user POV)

Send a message from the [chat input](chat-input.md) while the agent is working (`Stop generating` shows). The queue appears just above the chat input.

## Driving it

- Next step: with Claude, send a task that keeps the agent busy, such as a long shell command, then send "Also say hi." It lists under `The agent reads these at its next step`.
- Withdraw: choose `Withdraw queued message` on it. The row goes away and "Also say hi." is back in the chat input.
- Send now: send it again, then choose `Send now`. The agent's current step stops, the message shows in the conversation, and the agent answers it.
- Held: with Claude busy, send `/compact`. It lists under `Sends when the agent finishes`.
- Remove: choose `Remove queued message` on it. The row goes away and the chat input stays empty.
- Held sends after: send `/compact` again and wait. When the reply finishes, `Compacting conversation…` shows, then `Context compacted`.
- Combine: with Codex busy, send "Say apple." and then "Say banana." Both list under `Sends when the agent finishes`. When the reply finishes, they show as one message and get one reply.
- Stop: with `/compact` held, choose `Stop generating`. The reply stops, the queue empties, and `/compact` is back in the chat input.

## Gotchas

- Stopping the reply, with `Stop generating` or Escape, never sends held messages; they return to the chat input.
