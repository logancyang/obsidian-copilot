# Runtime tests

Executable Gherkin contracts that run Copilot's Agent Mode session layer against
the real pinned `opencode` executable. A mocked unit test cannot detect a binary
incompatibility; these scenarios can.

```bash
npm run test:runtime
```

The command bundles the suite (`build.mjs`), installs the pinned opencode
release into `runtime-tests/.opencode/` (`bin/fetchOpencode.ts`), and runs
`features/` with Cucumber. It needs no credentials and makes no inference
requests. It runs on macOS and Linux.

## Test boundary

A scenario talks to Copilot the way the Agent Chat view does: it creates a chat
through `AgentSessionManager.createSession`, sends through
`AgentChatUIState.sendMessage`, and reads the conversation from
`AgentChatUIState.getMessages()` as it changes. Everything from there to the
model is production code or the real runtime.

**Real:** `AgentSessionManager`, `AgentModelPreloader` (the plugin-load probe
whose warm process the first chat adopts), `AgentSession`, `AgentMessageStore`,
`AgentChatUIState`, the default permission prompter, the backend registry and
`OpencodeBackendDescriptor`, `OpencodeBackend.buildSpawnDescriptor` and
`buildOpencodeConfig`, `AcpBackendProcess`, `AcpProcessManager` (a real
`child_process.spawn`), `@agentclientprotocol/sdk`, `VaultClient`,
`wireTranslate`, the settings store, `createModelManagement` (provider, model,
and backend registries), `KeychainService`, the opencode binary, and opencode's
own `@ai-sdk/openai-compatible` provider adapter talking HTTP.

Copilot is configured through its normal paths: the BYOK wizard's
`setup.byok.setupProvider` adds an OpenAI-compatible provider with a key and
enables its model for opencode, the Default model picker's
`persistDefaultSelection` makes it the default, and the env-overrides setting
passes one runtime flag. `buildOpencodeConfig` turns that into opencode's
config, so config generation is under test.

**Substituted:**

| Substitute                              | Stands in for                          | Why                                                                                                                                                                                                                     |
| --------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness/scriptedProvider.ts`           | The remote model provider              | The one substitution the epic allows. Deterministic SSE over real loopback HTTP, so opencode's own provider adapter still runs.                                                                                         |
| `obsidianShim.ts` → `FileSystemAdapter` | Obsidian's vault adapter               | Must be a class (`instanceof` checks) rooted at the temp vault. `exists` is called when the session ensures the vault's `AGENTS.md`.                                                                                    |
| `obsidianShim.ts` → `Platform`          | Obsidian's platform flags              | `requireNodeModule` loads Node built-ins only on desktop.                                                                                                                                                               |
| `obsidianShim.ts` → `normalizePath`     | Obsidian's path normalizer             | Same rule; path helpers depend on it.                                                                                                                                                                                   |
| `obsidianShim.ts` → `requestUrl`        | Obsidian's HTTP helper                 | Throws in scenarios, so a remote call from Copilot code fails by name. Only the fetcher enables it.                                                                                                                     |
| Generated inert classes                 | Every other `obsidian` export          | `build.mjs` emits an empty class per name in `obsidian.d.ts` the shim lacks. Imported modules only subclass or type against them on this path.                                                                          |
| `harness/obsidianApp.ts` → `vault`      | Obsidian's `Vault`                     | `adapter` and `getName` feed the spawn; `getAbstractFileByPath` answers the empty index (callers fall back to the adapter); `on`/`offref` accept the project content tracker's subscriptions, and no vault event fires. |
| `obsidianApp.ts` → `metadataCache`      | Obsidian's `MetadataCache`             | Same tracker subscription; nothing fires.                                                                                                                                                                               |
| `obsidianApp.ts` → `workspace`          | Obsidian's `Workspace`                 | `getLeavesOfType` answers "no chat view is focused" when a finished turn asks whether to raise attention.                                                                                                               |
| `obsidianApp.ts` → `secretStorage`      | The OS keychain behind `SecretStorage` | In memory, so the synthetic key never reaches a real keychain. `KeychainService` itself is real.                                                                                                                        |
| Plugin object in `harness/runtime.ts`   | `CopilotPlugin`                        | Carries `app`, `manifest.version`, and the real `modelManagement` — the only members the session layer and opencode descriptor read on this path.                                                                       |
| `window = globalThis`                   | Electron's `window`                    | Agent Mode schedules timers with `window.setTimeout`.                                                                                                                                                                   |

Every stand-in member was checked by running the scenario with it removed: the
session layer either throws or logs a swallowed warning, and a passing run logs
no `WARN` or `ERROR` line.

**Not wired:** chat persistence (`AgentChatPersistenceManager`), the session
index, and `SkillManager`. They are optional collaborators the streaming
contract does not reach; without `SkillManager`, opencode gets the empty skill
deny list production uses before skills load.

**Why not the plugin-level entry point.** `createAgentSessionManager(app,
plugin)` does run headless with these stand-ins, but it also runs every
registered backend's load-time hooks and preloads, so its behavior depends on
what the host has installed: on a developer machine it found
`~/.local/bin/claude` and started a Claude SDK probe session. It seeds built-in
skills into the vault while teardown deletes it (`ENOTEMPTY`), and it leaves
handles open: the Cucumber process had not exited three minutes after the
scenario finished. The suite therefore constructs `AgentSessionManager` with
the collaborators that function passes for opencode.

## Isolation

Each scenario gets a fresh temp root holding the vault and an agent home. For
the scenario's duration the harness points `HOME` and the four `XDG_*` roots at
the agent home and moves the working directory to the temp root, so neither
Copilot, the opencode it spawns, nor the `opencode --version` probe that runs
before every spawn reads or writes the developer's state or the repository's
project config. The key is synthetic, the keychain is in memory, settings live
in the in-memory store, and all of it is reset on teardown.

Teardown runs in an `After` hook, so a failed assertion still cleans up. It
waits for any process startup still in flight (`AgentSessionManager.shutdown`
does not stop a starting process), shuts the manager down, then kills and
reports as a failure any process whose command line still names the scenario's
vault. Interrupting the run with SIGINT or SIGKILL mid-scenario left no
opencode process in a local check; the temp dir then stays in the OS temp
directory.

## Network

opencode honors `HTTP_PROXY`/`HTTPS_PROXY`. The harness points them at
`harness/egressProxy.ts`, a loopback proxy that refuses every request and
records its destination; `NO_PROXY` exempts loopback so the scripted provider
is reachable.

- **Blocked:** every proxied request. With nothing turned off, the pinned
  release contacts `models.opencode.ai` (the models.dev catalog) and
  `registry.npmjs.org` (an unconditional background
  `npm install @opencode-ai/plugin` in its config directory) at startup, and
  nothing else during a turn.
- **Turned off:** the catalog download, via `OPENCODE_DISABLE_MODELS_FETCH=1`
  in the env-overrides setting. No setting disables the plugin install.
- **Reported:** any refused destination other than `registry.npmjs.org:443`
  fails the scenario, as does any request the scripted provider refuses (an
  unknown path, a missing or wrong key, a turn with no scripted answer).
  Copilot's own `requestUrl` throws.
- **Unconstrained:** a connection that ignores the proxy variables. None was
  observed: sampling `lsof` every 50 ms across three runs saw only loopback
  sockets on the opencode process, while the same probe without the proxy saw
  connections to remote port-443 addresses. DNS lookups are not intercepted.
  Environment variables of the test process other than the ones above (for
  example a provider key exported in a developer's shell) are inherited by
  opencode, as Obsidian's are in production.

opencode starts every session on its hosted `opencode/big-pickle` model; the
scenario's default model moves it to the scripted one before the first prompt.
With the default removed, the turn goes to `opencode.ai:443`, which the proxy
refuses and the scenario reports.

## Runner guarantees

The run fails, each checked by trying it, when:

- a step is undefined, or pending (`strict: true` in `cucumber.mjs`);
- a scenario is skipped (the `After` hook; Cucumber alone exits 0);
- no scenario runs, for example after a path typo (the `AfterAll` hook;
  Cucumber alone exits 0).

Jest never sees this suite: its roots are `src`, `dev`, and `scripts`, and
`npx jest --listTests` lists nothing under `runtime-tests/`. The bundle resolves
`@agentclientprotocol/sdk` and every other package from `node_modules`, so
Jest's `moduleNameMapper` mocks (`__mocks__/`) cannot apply; the built bundle
contains the SDK's `dist/` sources and no `__mocks__` code.

## Pinned binary

`bin/fetchOpencode.ts` installs `OPENCODE_PINNED_VERSION` with the plugin's own
installer, `OpencodeBinaryManager.install()` — platform resolution, GitHub
release lookup, download, extraction, and `--version` verification — with the
home directory pointed at `runtime-tests/.opencode/`. A cached binary is reused
only while it reports the pinned version; anything else is deleted and
reinstalled. A failed lookup, download, or verification exits non-zero before
any scenario runs (checked with a pin naming a missing release and with a
download that reports another version). Without the cached binary a scenario
fails with `No file at …` rather than using an opencode found on `PATH`. CI
caches `runtime-tests/.opencode/` keyed on the OS, architecture, and pinned
version.

## Timeouts and measurements

| Bound                  | Value  | Where                                                 |
| ---------------------- | ------ | ----------------------------------------------------- |
| Startup                | 30 s   | Spawn, ACP `initialize`, `session/new`, default model |
| Turn                   | 20 s   | Send until the session reports its stop reason        |
| Streamed chunk visible | 10 s   | The scripted provider's pace barrier                  |
| Teardown wait          | 30 s   | In-flight startups before shutdown                    |
| Cucumber step          | 60 s   | `setDefaultTimeout`, above the harness bounds         |
| CI job                 | 10 min | `timeout-minutes` on the runtime job                  |

A scenario is bounded by its steps; the longest (open plus send) is bounded by
50 s of harness waits.

Measured durations:

| Where                                      | Cache | Scenario | `test:runtime` / install          | Whole job |
| ------------------------------------------ | ----- | -------- | --------------------------------- | --------- |
| Apple M-series Mac, darwin-arm64, Node 26  | Cold  | 2.8 s    | 10.5 s, including a 5.4 s install | —         |
| Apple M-series Mac, darwin-arm64, Node 26  | Warm  | 2.8 s    | 7.0 s                             | —         |
| GitHub `ubuntu-latest`, linux-x64, Node 22 | Cold  | 4.7 s    | 9 s, after a 6 s install          | 52 s      |
| GitHub `ubuntu-latest`, linux-x64, Node 22 | Warm  | 4.0 s    | 8 s, after a 2 s cached install   | 42 s      |

Locally, startup through a ready session takes about 1.2 s and the turn about
1 s. In CI, `npm ci` takes 16-20 s of the job; the CI numbers come from the
job's first run and a rerun that hit the binary cache. The startup and turn
bounds are over fifteen times their local durations and at least four times the
whole cold CI scenario; the job bound is over ten times the cold CI job.

## Failure report

Every run writes `runtime-tests/.report/summary.json` with the opencode
version, OS, Node version, commit, total elapsed time, and each scenario's
result, elapsed time, and error. A failed scenario also gets
`logs/<n>-<scenario>.log`: Copilot's log buffer (which includes ACP frames and
opencode's stderr), opencode's own log files, the provider's requests and
refusals, and the refused network attempts. Everything written is redacted:
key- and token-shaped values, `Bearer` credentials, and home-directory paths.
CI uploads the directory as the `runtime-report` artifact when the job fails.

## The harness

`harness/` carries no test-runner vocabulary, so any test format can drive it.
`Runtime` owns the temp dirs, the scripted provider, the egress proxy, and the
session manager; `Conversation` wraps one chat's `AgentChatUIState` and records
every distinct state of the latest answer. The scripted provider streams each
word only after the previous one is visible in the conversation, so a scenario
can assert the order text arrives in without timing assumptions.
