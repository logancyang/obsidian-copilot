# Connectors

Connectors let Claude Code, Codex, and OpenCode work with services such as Notion, Linear, Jira, and Todoist from your chats. Log in to a service once and every agent can use it.

Connectors is a preview for Supporters and works on desktop only. Without Supporter access, the Connectors tab offers **Already a Supporter? Enter your license key** and **See plans**.

## Connect a service

1. Open **Settings → Copilot → Connectors** and click **Browse connectors**.
2. Find the service by name, by category, or by what you want to do, such as "tasks" or "meetings".
3. Click **Connect**, then log in and approve Copilot on the service's page in your browser.
4. When the browser says the service is connected, go back to Obsidian.

If no browser window opens, click **Copy the login link** and open it yourself. You can log in to one service at a time; click **Cancel** to stop a login. Leaving **Settings → Copilot → Connectors** also cancels a login you started there. If the login doesn't finish, the row says why; click **Try again**.

New chats can use the service right away. A chat that is already open shows **settings changed** with **Reload**; click **Reload** to give that chat the service. See [Applying a settings change](agent-mode-and-tools.md#applying-a-settings-change).

## Connect from a chat

When your request needs a service you haven't connected, the agent shows a card such as **Connect Notion** below its reply.

- Click **Connect** and log in in your browser, or **Not now** to continue without it.
- When the card says the service is connected, click **Reload** on the **settings changed** notice at the top of the chat, then send your next message. The agent continues in the same chat.

When a service's login has expired, the card says so, for example **Your Notion login expired**. Click **Reconnect**, log in, then send your next message.

Nothing connects until you click.

## Reconnect a service

When the chat says **You have connectors that need your attention**, click **Manage** and reconnect the service that needs login.

Open **Settings → Copilot → Connectors**. A service that isn't **Connected** shows one of these:

| Status             | What to do                                                               |
| ------------------ | ------------------------------------------------------------------------ |
| **Needs login**    | Click **Reconnect** and log in again.                                    |
| **Couldn't reach** | Copilot tries again in your next chat. Click **Try again** to check now. |

You can also choose **Reconnect** from the **⋯** menu on any row.

## Disconnect a service

In **Settings → Copilot → Connectors**, open the service's **⋯** menu, choose **Disconnect**, and confirm.

Disconnecting signs Copilot out of the service where the service supports it, and removes the service from every agent on all your devices. Connect it again anytime from **Browse connectors**.

## Logins and devices

Logins stay in this device's keychain. Copilot never sees your password.

Your list of connectors follows a synced vault, but each device logs in on its own. On another device, a synced service shows **Needs login** until you click **Reconnect** there.

## Request a connector

At the bottom of **Browse connectors**, click **Request a connector**. If a search finds nothing, click the **Request** button it offers instead. Either link opens a prefilled request on GitHub.

## A service shows up twice

If you already added a service as an MCP server directly in Claude Code, Codex, or OpenCode, that agent sees the service twice: once from its own setup and once from Copilot. Remove one of them so the agent has a single set of that service's tools.

## Service names and logos

Service names and logos belong to their owners and appear only to show which service a connector connects to. Copilot isn't created by, affiliated with, or endorsed by these services. Vercel, the Vercel design, Next.js and related marks, designs and logos are trademarks or registered trademarks of Vercel, Inc. or its affiliates in the US and other countries.
