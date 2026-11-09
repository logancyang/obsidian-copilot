# Custom connectors

Servers the user adds from a pasted config, listed on the [Connectors tab](connectors-tab.md) with a `Custom` tag, and the dialog that adds and edits them.

## Sub-features

- custom-add: `Add custom connector` takes a pasted `mcpServers` block or one server with a name, shows each server it found as `Local · <command>` or `Remote · <url>` and how many values stay in this device's keychain, then `Add`.
- custom-invalid: a config that cannot be read shows why under the box, and `Add` stays disabled.
- custom-status: a custom row reads `Connected · <N> tools`, `Starting…`, `Starts in your next chat`, `Couldn't start · <reason>`, `Couldn't reach · <reason>`, `Key not accepted`, `Add API key on this device`, or `Off on this device`.
- custom-fix: `Add API key` opens the edit dialog for a missing or rejected key; `Try again` restarts a server that couldn't start or be reached.
- custom-edit: `Edit` from `More actions` opens `Edit <name>` with every stored value blank, "Leave a value blank to keep the one stored on this device.", and names any value this device lacks as "No value on this device: <names>".
- custom-turn-off: `Turn off on this device` and `Turn on on this device` in `More actions`.
- custom-remove: `Remove` in `More actions` asks `Remove <name>?` first.
- custom-tools: the tool count on a connected custom row opens its [tools page](connector-tools-page.md).

## How to get to it

- `Add custom connector` on the [Connectors tab](connectors-tab.md).
- `add a custom connector` at the bottom of [Browse connectors](browse-connectors.md).

## Driving it

- Add: choose `Add custom connector` and paste a local server's config with an API key under `env`. The dialog shows `Local · <command>` and "1 value stays in this device's keychain"; choose `Add`. A `Custom` row appears and reads `Connected · <N> tools` once the server starts.
- Invalid: paste text that is not a server config. The reason shows under the box and `Add` is disabled.
- Edit: choose `Edit` from the row's `More actions`. `Edit <name>` shows the config with its values blank; change an argument, choose `Save`, and the row restarts.
- Missing key: on a second device with the same vault, open the tab. The row reads `Add API key on this device`; `Add API key` opens the edit dialog naming the missing value.
- Couldn't start: add a server whose command does not exist. The row reads `Couldn't start · <reason>` with `Try again`.
- Turn off: choose `Turn off on this device`. The row reads `Off on this device`; `Turn on on this device` starts it again.
- Remove: choose `Remove`. `Remove <name>?` says agents lose access on all devices; confirm and the row goes away.
- Tools: choose the tool count on a connected custom row. Its tools page opens.

## Gotchas

- Values in `env` and `headers` stay in this device's keychain and do not sync; the command, its arguments, and the URL sync with the vault.
- `Turn off on this device` affects only this device. `Remove` removes the connector from every device.
- A custom connector that couldn't start, lacks a key, or had its key rejected raises the [Connectors tab](connectors-tab.md) warning and the chat's [connectors banner](status-and-error-cards.md). `Couldn't reach` does not.
- Open chats get a custom connector that was added, edited, turned off, or removed only after `Reload` on their `<agent> settings changed` [card](status-and-error-cards.md).
