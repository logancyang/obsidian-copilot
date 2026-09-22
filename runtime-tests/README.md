# Runtime tests

Executable proof that the pinned `opencode` executable still works with
Copilot's real config generation and ACP wiring. A passing mocked unit test
cannot detect a binary incompatibility; these scenarios can.

```bash
npm run test:runtime
```

That bundles the suite, downloads and verifies the pinned opencode release into
`runtime-tests/.opencode/<version>/` (cached; a download or version mismatch
fails the run rather than falling back to another local opencode), and runs
`runtime-tests/features/`. Cold ≈ 20s, warm ≈ 14s on an M-series laptop.

Jest never sees any of this: `jest.config.js` roots are `src`, `dev` and
`scripts`.

## What is real

Everything between the step definitions and the model:
`OpencodeBackend.buildSpawnDescriptor` → `buildOpencodeConfig` →
`AcpProcessManager` (a real `child_process.spawn` of the real binary) →
`@agentclientprotocol/sdk` → `VaultClient` → `wireTranslate` →
`AcpBackendProcess`, plus `BackendConfigRegistry`, `ConfiguredModelRegistry`,
the settings store and the production `OpencodeBackendDescriptor`.

The scripted provider is configured the way a user configures a local model: an
`openai-compatible` BYOK provider row with a `baseUrl`, enabled for the
`opencode` backend. `buildOpencodeConfig` turns that into the runtime's
`@ai-sdk/openai-compatible` entry, so config generation is under test rather
than bypassed. The `OPENCODE_CONFIG_CONTENT` override is deliberately unused.

## What is substituted, and why

| Substitute                                                      | Stands in for                          | Why                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness/scriptedProvider.ts`                                   | The remote model provider              | The only substitution the epic allows. Deterministic SSE over real HTTP on loopback, so the agent's own provider adapter is still exercised.                                                                           |
| `obsidianShim.ts` → `FileSystemAdapter`                         | Obsidian's vault adapter               | Must be a real class: `AcpBackendProcess.start` and `VaultClient.resolveVaultRelative` both do `instanceof FileSystemAdapter`. Reads and writes hit the real temp vault, because the agent's file tools go through it. |
| `obsidianShim.ts` → `Platform`                                  | Obsidian's platform flags              | `requireNodeModule` refuses to load Node built-ins unless `isDesktopApp && !isMobile`.                                                                                                                                 |
| `obsidianShim.ts` → `normalizePath`                             | Obsidian's path normalizer             | Same rule (backslashes to slashes, no leading/trailing slash); `VaultClient` depends on it.                                                                                                                            |
| `obsidianShim.ts` → `Notice`                                    | Obsidian's toast                       | Nothing renders here.                                                                                                                                                                                                  |
| `obsidianShim.ts` → `requestUrl`                                | Obsidian's HTTP helper                 | Throws. An unexpected remote call from plugin code surfaces as a named failure rather than silent egress.                                                                                                              |
| `obsidianShim.ts` → `Component`, `Modal`, `PluginSettingTab`, … | Obsidian UI base classes               | The backend descriptor pulls in settings panels and modals that only subclass them.                                                                                                                                    |
| Generated inert classes                                         | Every other `obsidian` export          | `build.mjs` emits one per name declared in `obsidian.d.ts` that the shim does not implement, so the checked-in shim stays limited to APIs whose behaviour matters.                                                     |
| `harness/obsidianApp.ts`                                        | Obsidian's `App`                       | Agent Mode reads exactly `vault.adapter` and `vault.getName()`.                                                                                                                                                        |
| Duck-typed `ProviderRegistry`                                   | `modelManagement`'s `ProviderRegistry` | The real one reads keys from Electron's keychain. The scripted provider row takes no key, so this answers `null` — what the real registry answers for a keyless row.                                                   |
| `globalThis.window = globalThis`                                | Electron's window                      | `AcpProcessManager.shutdown` schedules its SIGTERM grace period with `window.setTimeout`.                                                                                                                              |

## Isolation

Each scenario gets a fresh temp root holding the vault and an agent home.
`HOME` and the four `XDG_*` roots are redirected there through the production
`agentMode.backends.opencode.envOverrides` setting, so nothing touches the
developer's `~/.config/opencode` or `~/.local/share/opencode`. Settings live in
the in-memory jotai store and are reset on teardown; nothing writes to
`~/.obsidian-copilot`. The subprocess and the HTTP server are torn down in an
`After` hook, so an assertion failure still cleans up.

Every conversation is pinned to a scripted model. Left alone, opencode starts a
session on one of its own hosted free models and the turn would leave the
machine. Note that the binary still contacts its own catalog services at
startup; the suite constrains _inference_, not opencode's own bootstrap.

## The harness

`harness/` is deliberately free of test-runner vocabulary — no World, no hooks,
no assertions — so the same harness can be driven from any test format.

```ts
class Runtime {
  readonly provider: ScriptedProvider;
  readonly permissionPrompts: PermissionPrompt[];
  readonly vaultPath: string;
  start(options: { binaryPath: string; models: readonly string[] }): Promise<void>;
  openConversation(modelId: string): Promise<Conversation>;
  answerPermissionsWith(answer: "allow" | "deny"): void;
  readVaultFile(relativePath: string): Promise<string | null>;
  writeVaultFile(relativePath: string, content: string): Promise<void>;
  stop(): Promise<void>;
}

class Conversation {
  readonly sessionId: string;
  selectModel(modelId: string): Promise<void>;
  send(text: string): Promise<Turn>; // Turn = { text, stopReason }
  sendWithoutWaiting(text: string): void;
  awaitTurn(): Promise<Turn>;
  cancel(): Promise<void>;
  waitForText(needle: string, timeoutMs?: number): Promise<void>;
}

class ScriptedProvider {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[]; // { url, model, body }
  reply(...replies: ScriptedReply[]): void;
}

type ScriptedReply =
  | { kind: "text"; text: string }
  | { kind: "hold"; text: string } // streams, then waits to be aborted
  | { kind: "toolCall"; name: string; arguments: Record<string, unknown> };

function pinnedBinaryPath(): string;
```

Scripted replies are consumed one per _agent_ turn. opencode names a
conversation with a second, tool-less completion call; that one gets a fixed
answer so it cannot eat a scripted reply.

## The runner

`build.mjs` bundles the step definitions with esbuild — the same mechanism that
builds the plugin — and Cucumber loads the bundle. One step covers all three
resolution problems: aliasing `obsidian`, resolving `@/`, and loading the
`.svg`/`.md` assets that production Agent Mode modules import. It also inlines
the ESM-only ACP SDK, which puts Jest's global `__mocks__` alias for that
package out of reach by construction. Output is ESM because some bundled React
dependencies use top-level await; the banner restores `require` and `__dirname`.
