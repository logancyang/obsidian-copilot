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

| Scenario                                                                                                                    | Behavior it protects                                                                                                                                                                                                                          | Origin                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `streaming.feature`: A streamed answer appears in the conversation word by word and then completes                          | Streamed text reaches the conversation in order, and the turn ends only after its last word.                                                                                                                                                  | —                                                                                                                                                                  |
| `model-selection.feature`: A model and effort picked mid-conversation reach that model's endpoint with that effort          | The model picker offers exactly the enabled models and the effort levels opencode advertises; a pick is confirmed by opencode; the next turn goes to the picked model on its own provider's endpoint with that effort. One example per level. | [#2898](https://github.com/logancyang/obsidian-copilot/issues/2898), [private #76](https://github.com/Brevilabs/obsidian-copilot-private/issues/76)                |
| `model-selection.feature`: The mode picked in a conversation is confirmed and new conversations open in it                  | opencode confirms the picked mode, and the next new conversation switches to it.                                                                                                                                                              | [private #71](https://github.com/Brevilabs/obsidian-copilot-private/issues/71)                                                                                     |
| `model-selection.feature`: A conversation continues on the model and effort of its last turn after opencode restarts        | The effort picker changes effort alone; the chat's Reload action resumes the conversation, which shows and uses the model and effort of its last turn.                                                                                        | [private #475](https://github.com/Brevilabs/obsidian-copilot-private/issues/475)                                                                                   |
| `model-selection.feature`: After Copilot reloads, a new conversation starts on the saved default model and effort           | The saved default model and effort are applied before a new chat can send, and its first request uses them.                                                                                                                                   | [private #201](https://github.com/Brevilabs/obsidian-copilot-private/issues/201)                                                                                   |
| `model-selection.feature`: A saved default model that is turned off gives way to an enabled model, and the user is told     | A new chat starts on an enabled model instead, one notice names the model that is gone, and the saved default is kept.                                                                                                                        | [private #474](https://github.com/Brevilabs/obsidian-copilot-private/issues/474)                                                                                   |
| `model-selection.feature`: A saved effort on a default model with no effort levels is dropped instead of changing the model | The saved model is still applied, no effort is sent, and the saved default drops the effort.                                                                                                                                                  | [private #364](https://github.com/Brevilabs/obsidian-copilot-private/issues/364), [private #219](https://github.com/Brevilabs/obsidian-copilot-private/issues/219) |

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

## Test boundary

A scenario talks to Copilot the way the Agent Chat view does: it creates a chat
through `AgentSessionManager.createSession`, sends through
`AgentChatUIState.sendMessage`, and reads the conversation from
`AgentChatUIState.getMessages()` as it changes. It picks a model, effort, or mode
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

- **Reload action.** `AgentSessionManager.noteSpawnConfigChanged`, which the
  settings subscriptions call when a spawn-time setting changes, holds the
  restart while a chat is open; `applyHeldConfigChange`, the chat's Reload
  action, restarts opencode and resumes each open chat through `session/load`.
- **Copilot reload.** `Runtime.reloadCopilot` shuts the manager down as plugin
  unload does, then builds new model registries, a new manager, and a new
  model probe as plugin load does.

**Substituted:**

| Substitute                              | Stands in for                           | Why                                                                                                                                                                                                                     |
| --------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness/scriptedProvider.ts`           | The remote model provider               | The one substitution the epic allows. Deterministic SSE over real loopback HTTP, so opencode's own provider adapter still runs.                                                                                         |
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
| `Runtime.reloadCopilot`                 | Disabling and re-enabling the plugin    | Settings and the keychain stay in memory, standing in for `data.json` and the OS keychain; they are not serialized and loaded back. The backends' `onPluginLoad` hooks do not run.                                      |
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
  A scenario that turns a model off reloads Copilot before it opens a chat, and
  the Reload action scenario calls `noteSpawnConfigChanged` in their place;
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
  last user message is not the text sent, or a turn with no scripted answer.
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
  poll cut off by the closing connection. A Reload action or Copilot reload
  inside a scenario logs the same two, which are expected only while that
  restart or unload runs. Plugin unload stops a warm model probe without
  waiting for it to exit, so a Copilot reload also waits for that exit;
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
| Selection confirmed    | 10 s   | A pick, or a new chat's saved mode, until shown       |
| Reload action          | 30 s   | Restart until the resumed chat can take a message     |
| Copilot reload         | 30 s   | Startups settle, unload, and every stopped exit       |
| Teardown wait          | 30 s   | In-flight startups before shutdown                    |
| Cucumber step          | 60 s   | `setDefaultTimeout`, above the harness bounds         |
| CI job                 | 10 min | `timeout-minutes` on the runtime job                  |

A scenario is bounded by its steps; the longest (open plus send) is bounded by
50 s of harness waits.

Measured durations:

| Where                                      | Cache | Scenario    | `test:runtime` / install         | Whole job |
| ------------------------------------------ | ----- | ----------- | -------------------------------- | --------- |
| Apple M-series Mac, darwin-arm64, Node 26  | Cold  | 1.6 – 4.8 s | 37 s, including the install      | —         |
| Apple M-series Mac, darwin-arm64, Node 26  | Warm  | 1.6 – 4.8 s | 33 s                             | —         |
| GitHub `ubuntu-latest`, linux-x64, Node 22 | Cold  | 4.7 s mean  | 52 s, after a 5 s install        | 88 s      |
| GitHub `ubuntu-latest`, linux-x64, Node 22 | Warm  | 4.7 s mean  | 52 s, after a 1 s cached install | 82 s      |

Locally, startup through a ready session takes about 1.2 s and a turn about
1 s; the longest scenario, the Reload action, takes 4.8 s. In CI, `npm ci`
takes 14-20 s of the job, and the report of a passing run is not uploaded, so
the CI scenario time is the suite's time over its ten scenarios. The CI numbers
come from a job's first run and a rerun that hit the binary cache. The startup
and turn bounds are over fifteen times their local durations; the job bound is
over six times the cold CI job.

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
session manager, and restarts opencode or reloads Copilot the way the product
does; `Conversation` wraps one chat's `AgentChatUIState` and records every
distinct state of the latest answer. The scripted provider serves each
configured provider row at its own base path, records the endpoint, model,
and `reasoning_effort` of every request, and streams each word only after the
previous one is visible in the conversation, so a scenario can assert the
order text arrives in without timing assumptions.
