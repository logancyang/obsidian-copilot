# Queued messages

Messages the user sends while the agent is still working, listed above the [chat input](chat-input.md) until the agent reads them or finishes.

## Sub-features

- queue-next-step: with Claude, a message sent mid-reply lists under `The agent reads these at its next step`.
- queue-held: with other agents, and for `/compact` or messages that mention another agent, it lists under `Sends when the agent finishes`.
- queue-send-now: `Send now` stops the agent's current reply and has it read the waiting messages right away.
- queue-withdraw: `Withdraw queued message` takes back a message before the agent reads it.
- queue-remove: `Remove queued message` deletes a held message.
- queue-combine: held messages go out together as one message when the agent finishes.

Only the sub-features are mapped so far, and they may not cover everything this feature does. To map the rest, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).
