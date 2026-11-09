# Connector cards

Cards the agent shows below its reply when the request needs a service that is not connected or whose login expired, so the user can connect it without leaving the chat.

## Sub-features

- card-connect: `Connect <service>` says "Log in once and every agent can use your <service> account." with `Not now` and `Connect`.
- card-login-expired: `Your <service> login expired` says "Reconnect, then ask the agent to try again." with `Reconnect`.
- card-waiting: while the login runs, "Finish logging in in your browser…" with `Cancel` and `No browser window? Copy the login link`.
- card-connected: once logged in, the card reads "<service> connected. Every agent can use it now."
- card-login-failed: a login that does not finish says why, with `Try again`.
- card-unreachable: `Couldn't reach <service>` with "Copilot tries again in your next chat." and no button.
- card-upsell: without Supporter access, `Connect <service> with Connectors` says "Connectors is a preview for Supporters." with `See plans`.

## How to get to it

- Ask the agent to do something in a service that is not connected, such as "list my Todoist tasks".
- Ask the agent to use a connected service whose login expired.

## Driving it

- Connect: with Todoist not connected, ask "list my Todoist tasks". The reply ends with `Connect Todoist`. Choose `Connect`, log in in the browser, and return: the card reads "Todoist connected. Every agent can use it now." Choose `Reload` on the `<agent> settings changed` [card](status-and-error-cards.md) and send the request again; the agent lists the tasks.
- Not now: on a `Connect <service>` card, choose `Not now`. The card goes away and nothing connects.
- Waiting: choose `Connect`, then `Cancel` before logging in. The card returns to `Connect <service>`.
- Login failed: choose `Connect`, then deny access on the service's page. The card reads "Login was cancelled on <service>'s page." with `Try again`.
- Expired: revoke Copilot's access on a connected service's own site, then ask the agent to use it. The reply ends with `Your <service> login expired`; choose `Reconnect` and log in.
- Unreachable: with a connected service's server down, ask the agent to use it. The card reads `Couldn't reach <service>` with no button.
- Upsell: without a Supporter license, ask for a service that is not connected. `Connect <service> with Connectors` shows `See plans`.

## Gotchas

- The agent decides when to show a card. Nothing connects until the user chooses `Connect` or `Reconnect`.
- An open chat can use a service connected from its card only after `Reload` on its `<agent> settings changed` card.
- A login started from a card blocks every other `Connect` and `Reconnect`, in other chats and in the [Connectors tab](connectors-tab.md), until it finishes or is cancelled.
