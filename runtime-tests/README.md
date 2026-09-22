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

## Scenarios

Every scenario runs in one evidence environment, the scripted runtime:
production Copilot code driving the real pinned opencode process, with only
remote inference replaced by the scripted provider. A pass says nothing about a
hosted model's behavior or about Obsidian's UI.

| Scenario                                                                                                                                              | Behavior it protects                                                                                                                                                                                                                                                                                                                                              | Origin                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `streaming.feature`: A streamed answer appears in the conversation word by word and then completes                                                    | Streamed text reaches the conversation in order, and the turn ends only after its last word.                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                     |
| `model-selection.feature`: A model picked mid-conversation at `<effort>` effort reaches that model's endpoint with that effort                        | The model picker offers exactly the enabled models and the effort levels opencode advertises; a pick is confirmed by opencode; the next turn goes to the picked model on its own provider's endpoint with that effort. One example per level, because each checks opencode's own mapping of that level onto the request, which the OpenCode V2 migration changes. | [#2898](https://github.com/logancyang/obsidian-copilot/issues/2898), [private #76](https://github.com/Brevilabs/obsidian-copilot-private/issues/76)                                                                                   |
| `model-selection.feature`: The mode picked in a conversation is confirmed and the next new conversation switches to it                                | opencode confirms the picked mode, and the next new conversation switches to it once it is ready.                                                                                                                                                                                                                                                                 | [private #71](https://github.com/Brevilabs/obsidian-copilot-private/issues/71)                                                                                                                                                        |
| `model-selection.feature`: A conversation continues on the model and effort of its last turn after opencode restarts                                  | The effort picker changes effort alone; after a pick made before the chat's last turn, the chat's Reload action resumes the conversation, which keeps its transcript and shows and uses the model and effort of its last turn.                                                                                                                                    | [private #475](https://github.com/Brevilabs/obsidian-copilot-private/issues/475)                                                                                                                                                      |
| `model-selection.feature`: A new conversation starts on the default model and effort saved in settings                                                | The saved default model and effort are applied before a new chat can send, and its first request uses them.                                                                                                                                                                                                                                                       | [private #201](https://github.com/Brevilabs/obsidian-copilot-private/issues/201)                                                                                                                                                      |
| `model-selection.feature`: A saved default model that is turned off gives way to an enabled model, and the user is told                               | After opencode restarts on the new model list, a new chat starts on an enabled model instead, one notice names the model that is gone, and the saved default is kept.                                                                                                                                                                                             | [private #474](https://github.com/Brevilabs/obsidian-copilot-private/issues/474)                                                                                                                                                      |
| `model-selection.feature`: A saved effort on a default model with no effort levels is dropped instead of changing the model                           | The saved model is still applied, no effort is sent, and the saved default drops the effort.                                                                                                                                                                                                                                                                      | [private #364](https://github.com/Brevilabs/obsidian-copilot-private/issues/364), [private #219](https://github.com/Brevilabs/obsidian-copilot-private/issues/219)                                                                    |
| `turn-lifecycle.feature`: A stopped answer keeps the words already shown, and the next message is answered after it                                   | The stop button ends the turn as cancelled with its words kept, opencode closes the provider request, and the chat is idle. The next message is answered in the same chat, and nothing of the stopped turn reaches it beyond the history opencode keeps.                                                                                                          | [private #163](https://github.com/Brevilabs/obsidian-copilot-private/issues/163)                                                                                                                                                      |
| `turn-lifecycle.feature`: An answer that resumes after the user switched chats lands only in the chat that asked                                      | Switching tabs does not stop another chat's turn. A second chat runs its own turn while the first one's answer is held, the held answer finishes only in the chat that asked, the shown chat stays shown, and the finished background chat asks for attention. Neither chat's request carries the other's conversation.                                           | [private #276](https://github.com/Brevilabs/obsidian-copilot-private/issues/276), [private #99](https://github.com/Brevilabs/obsidian-copilot-private/issues/99), [#2987](https://github.com/logancyang/obsidian-copilot/issues/2987) |
| `provider-errors.feature`: A provider that keeps answering `<status>` is retried five times, then its error is shown and the next message is answered | For a 429 and a 500, opencode makes six attempts; the chat then shows the provider's message as the turn's error and an error status, and the next message is answered in the same chat.                                                                                                                                                                          | [#3104](https://github.com/logancyang/obsidian-copilot/issues/3104), [#2980](https://github.com/logancyang/obsidian-copilot/issues/2980), [private #553](https://github.com/Brevilabs/obsidian-copilot-private/issues/553)            |
| `provider-errors.feature`: A stream that breaks mid-answer is retried, and when the retry is refused the words shown stay with the error              | opencode retries a dropped stream; when the retry is refused, the chat keeps the words already shown, adds the error, and answers the next message.                                                                                                                                                                                                               | [private #163](https://github.com/Brevilabs/obsidian-copilot-private/issues/163)                                                                                                                                                      |

What the pinned opencode advertises and sends, as observed by running it:

- **Effort.** For an OpenAI-compatible model whose Copilot row declares
  `reasoning`, opencode offers `low`, `medium`, `high`, and `default`. The
  first three are sent as the request's `reasoning_effort`; `default` sends
  none. A model that does not declare `reasoning` gets no effort control and
  no field. Copilot starts a new chat whose saved effort is empty at the
  lowest level offered.
- **Mode.** opencode offers Default (`copilot-build`) and Auto (`build`). A
  text turn's request is the same in both, with the same tools and system
  prompt, so the mode scenario asserts the confirmed state. What the mode
  changes, whether an edit asks first, is a file-edit behavior.
- **Stop.** On `session/cancel`, opencode closes the provider request within
  milliseconds and answers the prompt with `cancelled`. Copilot sends the next
  prompt one second after the stopped one settles (`CANCELLED_TURN_QUIET_MS`).
  opencode keeps the stopped answer's words in its history: the next request
  carries them as the assistant's reply.
- **Two chats.** Chats on one opencode process run their turns concurrently:
  a second chat's turn completes while the first chat's answer is held.
- **Provider errors.** opencode retries a 429, a 500, and a dropped
  connection five times, so a provider that keeps failing gets six attempts.
  A 400 fails at once, unless its body reads like a server error (a body
  naming `server_error` was retried). A `retry-after-ms: 0` header makes the
  retries immediate. Without a header the waits double: a 500 was retried
  after 2.3, 4.9, 9.5, 18.4, and 38.9 s and reached the chat after 75 s. A
  dropped connection was retried after about 2.5 s. When the attempts run
  out, the prompt fails with JSON-RPC `-32603` and the provider's message,
  which the chat shows as `**Error:** Internal error: <message>`. opencode
  keeps a failed turn's question in its history with no reply, and drops the
  words shown before a break.

### Known gaps (unverified)

These behaviors do not hold in the scripted runtime, so no scenario asserts
them. Each was observed with a scenario run outside the suite.

- **A pick made after the chat's last turn is lost on the Reload action.** The
  resumed chat comes back on the model and effort of its last turn: after a
  turn on `alpha/model-a`, picking `bravo/model-b` at `high` effort, and Reload,
  the picker shows `alpha/model-a` and the next message goes to `model-a` on
  the `alpha` endpoint. The user's next message runs on a model and provider
  they did not pick, and nothing on screen says so.
  [#3319](https://github.com/logancyang/obsidian-copilot/issues/3319); open
  fix [#3323](https://github.com/logancyang/obsidian-copilot/pull/3323);
  [private #540](https://github.com/Brevilabs/obsidian-copilot-private/issues/540).
- **A chat with no turns comes back on OpenCode Zen/Big Pickle after the Reload
  action.** With `bravo/model-b` at `high` effort saved as the default, the
  resumed chat shows `OpenCode Zen/Big Pickle`, and its first message goes to
  `opencode.ai`, which the egress proxy refuses. A BYOK user's prompt goes to a
  hosted service they never configured.
  [#3319](https://github.com/logancyang/obsidian-copilot/issues/3319); open
  fix [#3323](https://github.com/logancyang/obsidian-copilot/pull/3323);
  [private #540](https://github.com/Brevilabs/obsidian-copilot-private/issues/540).
- **A retried stream repeats the words shown before it broke.** When a
  provider stream drops mid-answer and opencode's retry succeeds, opencode
  streams the whole retried answer on the same message, and the chat appends
  it: after "Alpha Bravo", a break, and a retry answering "Alpha Bravo
  Charlie", the chat shows `Alpha BravoAlpha Bravo Charlie`, while the next
  request's history carries an empty reply and then `Alpha Bravo Charlie`. The
  user reads a garbled answer that is not what the model was told it said. The scenario that breaks
  a stream has the retry refused instead.
  [private #163](https://github.com/Brevilabs/obsidian-copilot-private/issues/163);
  [private #553](https://github.com/Brevilabs/obsidian-copilot-private/issues/553).
- **A failing provider shows nothing until opencode stops retrying.** While
  opencode retries, the chat shows only a running turn: with no retry header,
  a 500 showed nothing for 75 s before the error appeared. The user cannot
  tell a failing provider from a slow one. The error scenarios ask the
  provider to retry at once to stay short.
  [#3104](https://github.com/logancyang/obsidian-copilot/issues/3104);
  [private #564](https://github.com/Brevilabs/obsidian-copilot-private/issues/564).
- **A new chat can take a message before its saved mode is applied.** Copilot
  asks opencode for the saved mode only once the chat is ready: with Auto
  saved, a new chat shows Default when it can first take a message, and a
  message sent then goes out before opencode confirms Auto. Whether that first
  message runs in Auto, or in Default and asks before an edit the user expected
  to happen without asking, depends on opencode's ordering, which no scenario
  checks. The mode scenario therefore waits for the switch.

## Test boundary

A scenario talks to Copilot the way the Agent Chat view does: it creates a chat
through `AgentSessionManager.createSession`, sends through
`AgentChatUIState.sendMessage`, and reads the conversation from
`AgentChatUIState.getMessages()` as it changes. It stops an answer with
`AgentChatUIState.cancel`, the stop button's call, switches chats with
`AgentSessionManager.setActiveSession`, a tab click's call, and reads each
chat's status and attention flag from the session, as the tab strip does: a
spinner while `running`, a red dot on `error`, an accent dot when the chat
needs attention. It picks a model, effort, or mode
through the callbacks of the pickers the chat input renders, which production
`buildAgentModelPicker` and `buildAgentModePicker` build from the running
opencode's reported state, and reads what those pickers show. Everything from
there to the model is production code or the real runtime.

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
`setup.byok.setupProvider` adds each OpenAI-compatible provider with a key and
enables its models for opencode, the Default model setting's
`persistDefaultSelection` saves the default model and effort, the opencode
tab's model toggle (`backendConfigRegistry.disableModel`) turns a model off,
and the env-overrides setting passes one runtime flag. `buildOpencodeConfig`
turns that into opencode's config, so config generation is under test.

Two session-lifecycle paths are driven the way the product drives them:

- **Settings change.** `AgentSessionManager.noteSpawnConfigChanged` is the call
  the settings subscriptions make when a spawn-time setting changes, such as a
  model turned off. With no chat open it restarts opencode's warm probe on the
  new config at once.
- **Reload action.** With a chat open, `noteSpawnConfigChanged` holds the
  restart; `applyHeldConfigChange`, the chat's Reload action, restarts opencode
  and resumes each open chat through `session/load`.

**Substituted:**

| Substitute                              | Stands in for                           | Why                                                                                                                                                                                                                     |
| --------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness/scriptedProvider.ts`           | The remote model provider               | The one substitution the epic allows. Deterministic SSE over real loopback HTTP, so opencode's own provider adapter still runs. It can also hold an answer open, drop the connection, or refuse with an HTTP error.     |
| `obsidianShim.ts` → `FileSystemAdapter` | Obsidian's vault adapter                | Must be a class (`instanceof` checks) rooted at the temp vault. `exists` is called when the session ensures the vault's `AGENTS.md`.                                                                                    |
| `obsidianShim.ts` → `Platform`          | Obsidian's platform flags               | `requireNodeModule` loads Node built-ins only on desktop.                                                                                                                                                               |
| `obsidianShim.ts` → `normalizePath`     | Obsidian's path normalizer              | Same rule; path helpers depend on it.                                                                                                                                                                                   |
| `obsidianShim.ts` → `requestUrl`        | Obsidian's HTTP helper                  | Throws in scenarios, so a remote call from Copilot code fails by name. Only the fetcher enables it.                                                                                                                     |
| `obsidianShim.ts` → `Notice`            | Obsidian's toast                        | Records each message, so a scenario can assert what the user was told.                                                                                                                                                  |
| Generated inert classes                 | Every other `obsidian` export           | `build.mjs` emits an empty class per name in `obsidian.d.ts` the shim lacks. Imported modules only subclass or type against them on this path.                                                                          |
| `harness/obsidianApp.ts` → `vault`      | Obsidian's `Vault`                      | `adapter` and `getName` feed the spawn; `getAbstractFileByPath` answers the empty index (callers fall back to the adapter); `on`/`offref` accept the project content tracker's subscriptions, and no vault event fires. |
| `obsidianApp.ts` → `metadataCache`      | Obsidian's `MetadataCache`              | Same tracker subscription; nothing fires.                                                                                                                                                                               |
| `obsidianApp.ts` → `workspace`          | Obsidian's `Workspace`                  | `getLeavesOfType` answers "no chat view is focused" when a finished turn asks whether to raise attention.                                                                                                               |
| `obsidianApp.ts` → `secretStorage`      | The OS keychain behind `SecretStorage`  | In memory, so the synthetic key never reaches a real keychain. `KeychainService` itself is real.                                                                                                                        |
| Plugin object in `harness/runtime.ts`   | `CopilotPlugin`                         | Carries `app`, `manifest.version`, and the real `modelManagement` — the only members the session layer and opencode descriptor read on this path.                                                                       |
| `window = globalThis`                   | Electron's `window`                     | Agent Mode schedules timers with `window.setTimeout`.                                                                                                                                                                   |
| `build.mjs` bundle                      | The plugin's `esbuild.config.mjs` build | Node loads an ESM bundle with a CommonJS banner (`require`, `__dirname`) and `obsidian` aliased to the shim. `process.env.NODE_ENV` is `"production"`, as in a release build.                                           |

A `WARN` or `ERROR` line in Copilot's log fails the scenario, so a stand-in
that lacks a member the session layer calls fails the run even where production
code catches the error. Removing any one member of `harness/obsidianApp.ts`
makes the scenario fail.

**Not wired:** everything else `createAgentSessionManager` and `main.ts` set up
around the manager. None of it is on the paths the scenarios drive:

- chat persistence (`AgentChatPersistenceManager`) and the session index
  (`AgentSessionIndex`);
- `SkillManager`, so opencode gets the empty skill deny list production uses
  before skills load;
- the ask-user-question prompter;
- each backend's `onPluginLoad` and the `beforeBackendStart` gate that waits
  for it (for opencode, the install reconcile and auto-upgrade; the suite sets
  the binary path directly);
- the subscriptions that restart or refresh a backend when provider, model,
  env-override, system-prompt, managed-env, skill, or install settings change.
  The scenarios that turn a model off or use the Reload action call
  `noteSpawnConfigChanged` in their place;
- `wireAgentModelDiscovery` and the ACP frame-log sink;
- settings persistence (`plugin.saveData`): settings live in the in-memory
  store;
- the Self-Host web search bridge, which the spawn reads only in Self-Host mode.

**Why not the plugin-level entry point.** `createAgentSessionManager(app,
plugin)` runs this scenario to a pass with the same stand-ins, but it also
seeds built-in skills and starts chat persistence, which call vault-adapter
members the stand-in lacks: a passing run logged 11 `ERROR` lines
(`adapter.mkdir is not a function`, ten from skill seeding and one from
`AgentChatPersistenceManager`), which the log check fails. It also runs every
registered backend's load-time hooks, so what it does depends on what the host
has installed. Supporting it would mean standing in for more of Obsidian's
vault adapter for features the streaming contract does not reach, so the suite
constructs `AgentSessionManager` with the collaborators that function passes
for opencode.

## Isolation

Each scenario gets a fresh temp root holding the vault and an agent home. For
the scenario's duration the harness points `HOME` and the four `XDG_*` roots at
the agent home and moves the working directory to the temp root, so neither
Copilot, the opencode it spawns, nor the `opencode --version` probe that runs
before every spawn reads or writes the developer's state or the repository's
project config. The key is synthetic, the keychain is in memory, and settings
live in the in-memory store. Each scenario starts from `DEFAULT_SETTINGS`, a
fresh install's settings, and teardown returns to them; the settings tab's
reset (`resetSettings`) keeps every provider that has a key, so it would carry
one scenario's providers into the next.

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
  nothing else during a turn. That install honors a registry set in the
  developer's npm config, so the harness pins `npm_config_registry` to
  `registry.npmjs.org`.
- **Turned off:** the catalog download, via `OPENCODE_DISABLE_MODELS_FETCH=1`
  in the env-overrides setting. No setting disables the plugin install.
- **Reported:** any refused destination other than `registry.npmjs.org:443`
  fails the scenario, as does any request the scripted provider refuses: a
  path other than a configured provider row's `/<name>/v1/chat/completions`, a
  missing or wrong key, a model that row does not serve, an agent turn whose
  last user message no conversation sent, or a turn with no scripted reply.
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
- Copilot logs a `WARN` or `ERROR` line during the scenario. The check runs
  before teardown, because a clean shutdown right after a turn logs two
  warnings of its own: `backend opencode exited`, and a `session/list` title
  poll cut off by the closing connection. A restart inside a scenario, from a
  settings change or the Reload action, logs the same two, which are expected
  only while that restart runs. A settings change stops the warm probe without
  waiting for it to exit, so the harness also waits for that exit. A turn a
  scenario makes fail on a provider error logs three lines of its own:
  opencode's `Error handling request`, the session's `prompt failed`, and the
  chat view's `turn failed`. The scenario expects one of each per failed turn,
  counted rather than timed, because opencode's stderr can arrive after the
  turn has ended;
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
release lookup, download, extraction, and a `--version` check — with the home
directory pointed at `runtime-tests/.opencode/`. Downloads are version-checked,
not checksum-verified: the installer compares the version the binary reports,
not the release asset's digest. A cached binary is reused only while it reports
the pinned version; anything else is deleted and reinstalled. A failed lookup,
download, or version check exits non-zero before any scenario runs (checked
with a pin naming a missing release and with a download that reports another
version). Without the cached binary a scenario
fails with `No file at …` rather than using an opencode found on `PATH`. CI
caches `runtime-tests/.opencode/` keyed on the OS, architecture, and pinned
version.

## Timeouts and measurements

| Bound                  | Value  | Where                                                 |
| ---------------------- | ------ | ----------------------------------------------------- |
| Startup                | 30 s   | Spawn, ACP `initialize`, `session/new`, default model |
| Turn                   | 20 s   | Send until the session reports its stop reason        |
| Streamed chunk visible | 10 s   | The scripted provider's pace barrier                  |
| Answer held            | 20 s   | Send until the provider holds the answer              |
| Held request closed    | 10 s   | Stop until opencode closes the held request           |
| Selection confirmed    | 10 s   | A pick, or a new chat's saved mode, until shown       |
| Settings change        | 30 s   | Old warm probe exits and the new one is warm          |
| Reload action          | 30 s   | Restart until the resumed chat can take a message     |
| Teardown wait          | 30 s   | In-flight startups before shutdown                    |
| Cucumber step          | 60 s   | `setDefaultTimeout`, above the harness bounds         |
| CI job                 | 10 min | `timeout-minutes` on the runtime job                  |

A scenario is bounded by its steps; the longest (open plus send) is bounded by
50 s of harness waits.

Measured durations, with the pinned binary already cached:

| Where                                      | Scenario    | `test:runtime`            | Whole job |
| ------------------------------------------ | ----------- | ------------------------- | --------- |
| Apple M-series Mac, darwin-arm64, Node 26  | 1.6 – 4.9 s | 48 s                      | —         |
| GitHub `ubuntu-latest`, linux-x64, Node 22 | 3.8 s mean  | 61 s, after a 4 s install | 87 s      |

Locally, startup through a ready session takes about 1.2 s and a turn about
1 s; the longest scenarios are the Reload action (4.8 s) and the broken stream
(4.9 s), which waits out opencode's 2.5 s retry delay. A stopped answer adds
Copilot's one-second wait before the next prompt. In CI, `npm ci` takes 14-20 s
of the job, and the report of a passing run is not uploaded, so the CI
scenario time is the suite's time over its fifteen scenarios. On a cache
miss the CI install step downloads the release in 5 s, against 1-2 s after a
2-3 s cache restore on a hit. The startup and turn bounds are over fifteen
times their local durations; the job bound is over six times the CI job.

## Failure report

Every run writes `runtime-tests/.report/summary.json` with the opencode
version, OS, Node version, commit (in CI, the pushed commit rather than the
merge commit a pull request checks out), total elapsed time, and each
scenario's result, elapsed time, and error. A failed scenario also gets
`logs/<n>-<scenario>.log`: Copilot's log buffer (which includes ACP frames and
opencode's stderr), opencode's own log files, the provider's requests and
refusals, and the refused network attempts. Everything written passes through
`redactLogText` (`src/utils/redactLog.ts`), the redaction Copilot applies to
bug-report logs: home-directory user names, email addresses, key- and
token-shaped values, and `Bearer` and `Basic` credentials. CI uploads the
directory as the `runtime-report` artifact when the job fails.

## The harness

`harness/` carries no test-runner vocabulary, so any test format can drive it.
`Runtime` owns the temp dirs, the scripted provider, the egress proxy, and the
session manager, and restarts opencode the way the product does;
`Conversation` wraps one chat's `AgentChatUIState` and records every distinct
state of the latest answer. The scripted provider serves each
configured provider row at its own base path, records the endpoint, model,
`reasoning_effort`, and conversation of every request, and streams each word
only after the previous one is visible in the conversation that sent the
request, so a scenario can assert the order text arrives in without timing
assumptions, and a word that reaches another chat stalls the answer and fails
the scenario by name.

A held answer stops after its first words, once the conversation shows them,
and stays open until the scenario releases it with the rest or breaks the
connection, or opencode closes the request. The wait for a hold, and every
wait after it, reports what the provider has received and held, so an answer
held on purpose reads differently from a request that never arrived. An error
reply refuses every retry of the question it refused, as a failing provider
does.
