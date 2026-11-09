# Connectors tab

The Connectors tab in Copilot settings: the services the user connected, each with its status and the fix for it, and the way into [Browse connectors](browse-connectors.md) and [custom connectors](custom-connectors.md).

## Sub-features

- connectors-upsell: without Supporter access, the tab shows `Connectors is a preview for Supporters`, `Already a Supporter? Enter your license key`, and `See plans`.
- connectors-empty: with nothing connected, `Connect the services you work in` offers `Browse connectors` and `Add custom connector`, and says logins stay in this device's keychain.
- connectors-list: the `Connectors` heading, "Connect agents with external services.", `Browse connectors`, a row per connected service, then `Add custom connector`.
- connectors-status: a row reads `Connected`, with the service's account and its tool count, such as `Connected · 14 tools`; `Needs login` with `Reconnect`; or "Couldn't reach <service> just now. Copilot tries again in your next chat." with `Try again`.
- connectors-tool-count: the tool count opens the service's [tools page](connector-tools-page.md); a service with no tools reads `0 tools` and opens nothing.
- connectors-login: while a login runs, its row reads "Waiting for you to log in in your browser…" with `Cancel`, and "Didn't see a browser window?" offers `Copy the login link` or `open it again`. A login that does not finish says why, such as "The login timed out. Try again when you're ready.", with `Try again`.
- connectors-row-menu: each row's `More actions` menu offers `Reconnect` and `Disconnect`; `Disconnect` asks `Disconnect <service>?` first.
- connectors-tab-warning: the tab's name in Settings carries a warning, "You have connectors that need your attention", while a service needs login or a custom connector needs the user.

## How to get to it

- Settings → Copilot → Connectors.
- `Manage` on the [connectors banner](status-and-error-cards.md) in Agent Chat.
- `Back` from [Browse connectors](browse-connectors.md) or a [tools page](connector-tools-page.md).

## Driving it

- Upsell: without a Supporter license, open the Connectors tab. `Connectors is a preview for Supporters` shows with `See plans`; `Already a Supporter? Enter your license key` opens the Basic tab.
- Empty: with a Supporter license and nothing connected, open the tab. `Connect the services you work in` shows `Browse connectors` and `Add custom connector`.
- List: connect a service from [Browse connectors](browse-connectors.md) and choose `Back`. Its row reads `Connected · <N> tools` under the `Connectors` heading.
- Tool count: choose the tool count on a connected row. The service's tools page opens.
- Login: choose `Reconnect` from a row's `More actions`. The row reads "Waiting for you to log in in your browser…"; `Copy the login link` puts the link on the clipboard and reads `Copied`. Choose `Cancel`; the row returns to its status.
- Login blocked: while one login waits, hover another row's `Reconnect`. It is disabled with "Finish or cancel the <service> login first".
- Needs login: revoke Copilot's access on the service's own site, then start a chat that uses it. The row reads `Needs login` with `Reconnect`, and the tab's name shows its warning.
- Couldn't reach: with a connected service's server down, start a chat. The row reads "Couldn't reach <service> just now." with `Try again`; `Try again` stays disabled until the check ends, and the row reads `Connected` once the service answers.
- Disconnect: choose `Disconnect` from a row's `More actions`. `Disconnect <service>?` says agents lose access on all devices; confirm and the row goes away.

## Gotchas

- Leaving the Connectors tab cancels a login started there.
- Only one login runs at a time, across Settings and the chat's [connector cards](connector-cards.md).
- The list of connected services follows a synced vault, but each device logs in on its own: on another device a synced service reads `Needs login` until it is reconnected there.
- A service that could not be reached keeps `Couldn't reach` until `Try again` or the next chat checks it, even while the tab stays open.
- A chat that is already open gets a newly connected or disconnected service only after `Reload` on its `<agent> settings changed` [card](status-and-error-cards.md).
