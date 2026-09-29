# Remote pairing and the secure channel

How a phone pairs with desktop Copilot and how every later connection is authenticated. Delivered by
[#610](https://github.com/Brevilabs/obsidian-copilot-private/issues/610) for epic
[#605](https://github.com/Brevilabs/obsidian-copilot-private/issues/605). The session protocol that runs over
an authenticated connection is [`AGENT_SESSION_HOST.md`](./AGENT_SESSION_HOST.md) (#613).

## Rules the desktop listener follows

- **Only with Copilot Plus, and only while it is needed.** The vault window listens when Plus is active, a
  Tailscale address exists, and at least one phone is paired or a pairing is open. Otherwise nothing listens.
- **Only on the Tailscale address.** The listener binds to one IPv4 address in `100.64.0.0/10` found on a
  Tailscale adapter (`utunN`, `tailscale0`, `Tailscale`) through `os.networkInterfaces()`. It never binds
  `0.0.0.0`, loopback or a LAN address. A `100.64.0.0/10` address on any other adapter is ignored. Other
  VPNs also create `utunN` adapters on macOS, so a `utunN` adapter counts only when it also carries an
  address in `fd7a:115c:a1e0::/48`, which Tailscale assigns to its own adapter.
- **The listener follows its reasons.** While a phone is paired or a pairing is open, the service checks every
  15 seconds that the Tailscale address, Copilot Plus and the port still allow listening. It rebinds when the
  address changes, closes the port when the address disappears or Plus lapses, and retries a port that was
  busy at startup. Closing the plugin closes the listener before anything else is flushed.
- **One port per vault window,** chosen by the OS on first use and kept in device-local storage
  (`app.saveLocalStorage`) so paired phones can reconnect. A busy remembered port is replaced only when no
  phone is paired, because a paired phone stores the port.
- **Every connection authenticates in its first frame** within 5 seconds of connecting, however slowly it
  sends, or it is closed.

## Pairing

The desktop shows a QR code for

```
obsidian://copilot-pair?host=<100.x>&port=<port>&vault=<vault name>&vaultId=<_keychainVaultId>&secret=<one-time secret>&desktop=<desktop name>
```

The secret is 192 random bits, single-use and valid for 5 minutes; starting a new pairing invalidates the
previous secret. The phone opens the link (`registerObsidianProtocolHandler("copilot-pair")`, or the
paste-a-link field) and refuses it when `vaultId` is not the open vault's `_keychainVaultId` or `host` is not a
canonical dotted-decimal address in `100.64.0.0/10`.

A link can come from any web page or message, and pairing makes the phone trust the desktop it names, so the
phone then asks the person to confirm. The dialog shows the desktop's name, its address and the vault open on
the phone, and the phone connects to `ws://host:port` only after the person chooses Pair. Declining spends no
secret.

Each phone keeps a random id in device-local storage (`copilot-remote-client-id:v1`) and sends it in the pair
frame. The desktop replaces every earlier entry that carries the same id: it removes the entry, so its token is
rejected from then on, and closes that entry's connections with `4403`. A pairing without an id, or from a phone
that lost its local storage, adds a new entry.

## Channel frames

The first text frame on every connection is one of:

| Client frame                                   | Server reply                                    | Meaning                                                        |
| ---------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `{type:"pair", secret, deviceName, clientId?}` | `{type:"paired", token, deviceId, desktopName}` | Spends the one-time secret and returns a 256-bit device token. |
| `{type:"auth", token}`                         | `{type:"authed", deviceId}`                     | Presents the device token.                                     |
| either, when rejected                          | `{type:"denied", reason}` then close `4401`     | `pairing-rejected`, `token-rejected` or `bad-request`.         |

The names `pair`, `auth`, `paired`, `authed` and `denied` belong to this layer. After `authed` or `paired`,
every text frame is the session protocol's. Close codes: `4401` denied, `4403` device revoked, `4408`
authentication timeout, `1001` desktop shutting down.

Pre-authentication limits: 8 connections past the WebSocket upgrade that have not authenticated, 4 unauthenticated
connections per source address, 64 connections in total, first frame at most 4096 bytes and text only. A plain
HTTP request is answered with `426` and `Connection: close`. Authenticated messages are capped at 8 MiB and at
1024 fragments. A ping is answered only while nothing waits to be written, so a peer that pings without
reading cannot grow memory. Any other frame the codec cannot accept ends the connection with the close code
RFC 6455 assigns to it: `1002` for a protocol error, `1003` for a binary frame, `1007` for invalid UTF-8, `1009` for
a frame over the limit.

The listener does not check the `Origin` or `Host` header: a token is the only credential, a web page cannot
obtain one, and a phone's `Origin` differs between iOS and Android.

## Where #613 attaches

Desktop: `plugin.remoteHost.onConnection(handler)` calls `handler(connection)` once per authenticated
connection.

```ts
interface RemoteConnection {
  readonly deviceId: string;
  readonly deviceName: string;
  send(text: string): void;
  onMessage(handler: (text: string) => void): () => void; // register inside the connection handler
  onClose(handler: (event: { code: number }) => void): () => void;
  close(code?: number): void;
}
```

`RemoteConnection` carries text frames and nothing else, so `SessionHost.connect(send, onClose)` maps onto it
directly: `send` is `connection.send`, `onClose` is `connection.onClose`, and `connection.onMessage` feeds
`receive`. `deviceId` identifies the connection's device for command origin. Revoking a device closes its
connections with `4403`; `onClose` fires for every close.

Phone: `plugin.remoteClient.connect(desktop)` resolves to `{ ok: true, channel, deviceId }` or
`{ ok: false, reason: "unreachable" | "token-rejected" | "protocol" }`. `RemoteChannel` has the same
`send`, `onMessage`, `onClose` and `close`, which is the shape a `ClientTransport` needs. `connect` applies an
8-second connect timeout because Obsidian iOS leaves a socket to an unreachable address in `CONNECTING`.
`store.list()` holds the desktops paired for the open vault.

## Secrets

Device data lives in Obsidian `SecretStorage` through `KeychainService`, keyed by the synced vault id, and
never in `data.json`. A phone that cannot read its saved desktops refuses to add or remove one instead of
overwriting the list. The desktop and the phone use different entries because they can share one OS keychain
and one vault id:

| Role    | Key (before the `copilot-v<vaultId>-` prefix) | Content                                                                |
| ------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Desktop | `remote-host-devices`                         | Paired devices with the SHA-256 of each token, never the token.        |
| Phone   | `remote-client-desktops`                      | Paired desktops with host, port, device token, desktop name and vault. |

Tokens are compared in constant time. Token hashes, tokens and secrets are never logged.

## Bundle size

Obsidian Sync rejects files over 5 MB, so `scripts/bundleSizeGuard.js` fails the build at 5,000,000 bytes.
The `ws` package adds about 48 KB to `main.js`, more than the headroom the bundle had, so the desktop
listener speaks the server side of RFC 6455 itself: `RemoteServer.ts` does the HTTP upgrade with Node's
`http` and `webSocketFrames.ts` decodes masked text frames, ping, pong and close under strict size bounds.
It supports text frames only and negotiates no extensions. `ws` is a development dependency used by the
tests as an independent client. `scripts/dedupeIdenticalPackages.js` bundles one copy of a package that npm
nested under several dependents, which is what makes room for this feature. It merges copies only when they
have the same name and version, byte-identical files, and every dependency they declare resolves to an
interchangeable copy from each location. The copy it keeps is the shallowest, alphabetically first one, so the
bundle does not depend on the order esbuild resolves imports in, and only imports of a package installed more
than once go through the plugin.

## Keeping the desktop awake

[#608](https://github.com/Brevilabs/obsidian-copilot-private/issues/608). `KeepAwakeService` (`src/keepAwake/`)
holds at most one Electron `powerSaveBlocker` (`prevent-app-suspension`: idle system sleep is blocked, the
display may still sleep) for the vault window, and releases it on plugin unload.

| Holds the blocker when                                                | Notes                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Any agent session is `running` (`AgentSessionManager.hasRunningTurn`) | Every desktop user, paired or not. A turn waiting on a permission prompt does not count.                |
| A phone is paired, Plus is active, and the mode allows it             | `never`: no. `plugged` (default): only while `powerMonitor.isOnBatteryPower()` is false. `always`: yes. |

The mode is per desktop and per vault window, kept in `app.saveLocalStorage` (`copilot-keep-awake-mode:v1`)
so it never syncs to another desktop. Both APIs come from `electron.remote`; when either is missing the
service is not created and the setting is hidden. `on-ac` / `on-battery` events are delivered on macOS and
Windows only, so on Linux a power source change is noticed at the next turn or pairing change. Closing a
laptop lid still sleeps the machine.
