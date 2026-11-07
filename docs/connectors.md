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

## Add a custom connector

Add a server that isn't in **Browse connectors**, such as one that runs on your computer or takes an API key.

1. Open **Settings → Copilot → Connectors** and click **Add custom connector**, or click **add a custom connector** at the bottom of **Browse connectors**.
2. Paste the server's config from its README: a whole `"mcpServers"` block, which can add several servers, or one server with a `"name"`. A local server has `command`, `args`, and `env`. A remote server has `url` and `headers`.
3. Check the command or URL shown below the box, then click **Add**.

Every agent gets the connector's tools in new chats. A chat that is already open shows **settings changed** with **Reload**.

You can also ask the agent in a chat to set up a service that isn't in **Browse connectors**. It looks up the server and shows an **Add custom connector** card with the full command or URL. Type any keys into the card, not the chat, then click **Add**. If the connector can't start, tell the agent and it shows a card that updates the same connector.

Values in `env` and `headers` stay in this device's keychain and don't sync. Put API keys there, not in `args` or the `url`, which sync with your vault. On each other device, the connector shows **Add API key on this device** until you click **Add API key** and fill in the values there.

| Status                         | What to do                                                        |
| ------------------------------ | ----------------------------------------------------------------- |
| **Add API key on this device** | Click **Add API key** and fill in the values.                     |
| **Key not accepted**           | Click **Add API key** and enter a new key.                        |
| **Couldn't start**             | Check the command and the reason shown, then click **Try again**. |
| **Couldn't reach**             | Check the URL, then click **Try again**.                          |

From a custom connector's **⋯** menu:

- **Edit** opens its config with every value blank. Leave a value blank to keep the one on this device. The dialog names any value this device doesn't have yet.
- **Turn off on this device** stops it on this device only. Your other devices keep using it.
- **Remove** deletes it from all your devices.

## A service shows up twice

If you already added a service or a custom connector's server as an MCP server directly in Claude Code, Codex, or OpenCode, that agent sees it twice: once from its own setup and once from Copilot. Remove one of them so the agent has a single set of its tools.

## Service names and logos

Service names and logos belong to their owners and appear only to show which service a connector connects to. Copilot isn't created by, affiliated with, or endorsed by these services. Vercel, the Vercel design, Next.js and related marks, designs and logos are trademarks or registered trademarks of Vercel, Inc. or its affiliates in the US and other countries.
