# Status and error cards

Cards in the conversation that report a problem with the chat's agent or a failed reply, and offer the fix.

## Sub-features

- card-agent-status: when the chat's agent cannot run, a card offers `Install <agent>`, `Update`, `Configure <agent>`, or `Sign in` ([agent setup](agent-setup.md)).
- card-settings-changed: `<agent> settings changed` with `Reload`.
- card-error: `<agent> ran into a problem` with the error and `Retry`.
- card-connectors-attention: at the top of Agent Chat, `You have connectors that need your attention` with `Manage`, which opens the [Connectors tab](connectors-tab.md).
- card-feedback: after a failed reply, or when the agent suggests it, `Report this to the Copilot team?` shows a draft title and what the user said, and offers `Review & report`, `Dismiss`, or `Don't offer again`; once sent it reads `Report sent to the Copilot team` with the report ID.

## How to get to it

- Agent status and settings changed: change the agent in [agent setup](agent-setup.md) while its chat is open.
- Error: start a chat with an agent that is not set up.
- Connectors attention: let a connected service's login expire, or add a [custom connector](custom-connectors.md) whose key this device lacks.
- Feedback: tell the agent something went wrong and ask it to report it to the Copilot team. `Offer feedback reports in Agent Chat` in Settings → Advanced turns these cards on or off.

## Driving it

- Agent status: with a chat open, sign the agent out from `Configure <agent>`. A card reads `<agent> not signed in` with `Sign in`.
- Settings changed: with a chat open on OpenCode or Codex, add a variable under that agent's `Environment variables` in Settings. A card reads `<agent> settings changed`; choose `Reload` and the card goes away.
- Error: set `Default agent` to an agent that is not set up, then choose `New chat`. A card reads `<agent> ran into a problem`, says the agent isn't set up and where to set it up, and offers `Retry`.
- Connectors attention: with a connected service showing `Needs login` in the [Connectors tab](connectors-tab.md), open Agent Chat. `You have connectors that need your attention` shows above the conversation; `Manage` opens Settings on the Connectors tab. Reconnect the service and the banner goes away.
- Feedback: tell Claude something looked broken and ask it to report it to the Copilot team. `Report this to the Copilot team?` shows a title and "You said: …". Choose `Review & report`: [Report an issue](report-issue.md) opens with the draft under "What went wrong?" and every attachment ticked. Cancel it and choose `Dismiss`; the card goes away.

## Gotchas

- The connectors banner shows only with a Supporter license, and not for a service that `Couldn't reach`.
- `Don't offer again` turns off `Offer feedback reports in Agent Chat` for every chat.
