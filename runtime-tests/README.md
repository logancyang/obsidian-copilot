# Runtime tests

Executable Gherkin contracts that run Copilot's Agent Mode session layer against
the real pinned `opencode` executable. A mocked unit test cannot detect a binary
incompatibility; these scenarios can.

```bash
npm run test:runtime
```

The command bundles the suite (`build.mjs`), checks the step vocabulary
(`vocabulary.mjs`), installs the pinned opencode release into
`runtime-tests/.opencode/` (`bin/fetchOpencode.ts`), and runs `features/` with
Cucumber. It needs no credentials and makes no inference requests. It runs on
macOS and Linux. `npm run test:runtime:steps` prints every step the scenarios
use. When a change needs a scenario, and how to write one, is in the
[testing guide](../designdocs/agents/TESTING_GUIDE.md#runtime-contracts-gherkin).

## Scenarios

Every scenario runs in one evidence environment, the scripted runtime:
production Copilot code driving the real pinned opencode process, with only
remote inference replaced by the scripted provider. A pass says nothing about a
hosted model's behavior or about Obsidian's UI.

| Scenario                                                                                                                                              | Behavior it protects                                                                                                                                                                                                                                                                                                                                                                                   | Origin                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `streaming.feature`: A streamed answer appears in the conversation word by word and then completes                                                    | Streamed text reaches the conversation in order, and the turn ends only after its last word.                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                  |
| `model-selection.feature`: A model picked mid-conversation at `<effort>` effort reaches that model's endpoint with that effort                        | The model picker offers exactly the enabled models and the effort levels opencode advertises; a pick is confirmed by opencode; the next turn goes to the picked model on its own provider's endpoint with that effort. One example per level, because each checks opencode's own mapping of that level onto the request, which the OpenCode V2 migration changes.                                      | [#2898](https://github.com/logancyang/obsidian-copilot/issues/2898), [private #76](https://github.com/Brevilabs/obsidian-copilot-private/issues/76)                                                                                                |
| `model-selection.feature`: The mode picked in a conversation is confirmed and the next new conversation switches to it                                | opencode confirms the picked mode, and the next new conversation switches to it once it is ready.                                                                                                                                                                                                                                                                                                      | [private #71](https://github.com/Brevilabs/obsidian-copilot-private/issues/71)                                                                                                                                                                     |
| `model-selection.feature`: A conversation continues on the model and effort of its last turn after opencode restarts                                  | The effort picker changes effort alone; after a pick made before the chat's last turn, the chat's Reload action resumes the conversation, which keeps its transcript and shows and uses the model and effort of its last turn.                                                                                                                                                                         | [private #475](https://github.com/Brevilabs/obsidian-copilot-private/issues/475)                                                                                                                                                                   |
| `model-selection.feature`: A new conversation starts on the default model and effort saved in settings                                                | The saved default model and effort are applied before a new chat can send, and its first request uses them.                                                                                                                                                                                                                                                                                            | [private #201](https://github.com/Brevilabs/obsidian-copilot-private/issues/201)                                                                                                                                                                   |
| `model-selection.feature`: A saved default model that is turned off gives way to an enabled model, and the user is told                               | After opencode restarts on the new model list, a new chat starts on an enabled model instead, one notice names the model that is gone, and the saved default is kept.                                                                                                                                                                                                                                  | [private #474](https://github.com/Brevilabs/obsidian-copilot-private/issues/474)                                                                                                                                                                   |
| `model-selection.feature`: A saved effort on a default model with no effort levels is dropped instead of changing the model                           | The saved model is still applied, no effort is sent, and the saved default drops the effort.                                                                                                                                                                                                                                                                                                           | [private #364](https://github.com/Brevilabs/obsidian-copilot-private/issues/364), [private #219](https://github.com/Brevilabs/obsidian-copilot-private/issues/219)                                                                                 |
| `turn-lifecycle.feature`: A stopped answer keeps the words already shown, and the next message is answered after it                                   | The stop button ends the turn as cancelled with its words kept, opencode closes the provider request, and the chat is idle. The next message is answered in the same chat, is the last question sent, and its answer carries none of the stopped turn's words.                                                                                                                                         | [private #163](https://github.com/Brevilabs/obsidian-copilot-private/issues/163)                                                                                                                                                                   |
| `turn-lifecycle.feature`: An answer stopped while opencode waits to retry it keeps the words shown, and opencode does not try again                   | After a stream breaks and opencode's retry is refused with a one-minute `retry-after-ms`, Stop ends the turn as cancelled with the words already shown, though opencode itself answers `end_turn`. opencode makes no further attempt, and the next message is answered without waiting out the retry.                                                                                                  | [private #163](https://github.com/Brevilabs/obsidian-copilot-private/issues/163)                                                                                                                                                                   |
| `turn-lifecycle.feature`: An answer that resumes after the user switched chats lands only in the chat that asked                                      | Switching tabs does not stop another chat's turn. A second chat runs its own turn while the first one's answer is held, the held answer finishes only in the chat that asked, the shown chat stays shown, and the finished background chat asks for attention. The second chat's request carries no message the first chat sent.                                                                       | [private #276](https://github.com/Brevilabs/obsidian-copilot-private/issues/276), [private #99](https://github.com/Brevilabs/obsidian-copilot-private/issues/99), [#2987](https://github.com/logancyang/obsidian-copilot/issues/2987)              |
| `provider-errors.feature`: A provider that keeps answering `<status>` is retried, then its error is shown and the next message is answered            | For a 429 and a 500, opencode retries; once it gives up, the chat shows the provider's message as the turn's error and an error status, and the next message is answered in the same chat.                                                                                                                                                                                                             | [#3104](https://github.com/logancyang/obsidian-copilot/issues/3104), [#2980](https://github.com/logancyang/obsidian-copilot/issues/2980), [private #553](https://github.com/Brevilabs/obsidian-copilot-private/issues/553)                         |
| `provider-errors.feature`: A stream that breaks mid-answer is retried, and when the retry is refused the chat keeps the words shown and ends in error | opencode retries a dropped stream; when the retry is refused, the chat keeps the words already shown and an error status, and the next message is answered. The error's text is not drawn; see Known gaps.                                                                                                                                                                                             | [private #163](https://github.com/Brevilabs/obsidian-copilot-private/issues/163)                                                                                                                                                                   |
| `file-edits.feature`: An edit the user allows changes exactly that note, and the model is told the result                                             | In Default mode opencode's `edit` and `write` tools each show a permission card naming the tool's kind and the note, with its diff. Allow once changes that note to the expected bytes and nothing else under the temp root, Copilot writes those bytes through the vault adapter, the chat shows the edit as done, and the model's next request carries the result the chat shows for that tool call. | [private #556](https://github.com/Brevilabs/obsidian-copilot-private/issues/556), [private #28](https://github.com/Brevilabs/obsidian-copilot-private/issues/28)                                                                                   |
| `file-edits.feature`: An edit the user rejects leaves every file unchanged, and the chat carries on                                                   | Reject leaves every file byte-identical, the chat shows the edit as failed, the turn ends with the chat idle, and the next message is answered. What opencode does after the rejection is an observation, not asserted.                                                                                                                                                                                | [private #556](https://github.com/Brevilabs/obsidian-copilot-private/issues/556)                                                                                                                                                                   |
| `file-edits.feature`: A note the agent reads reaches the model without asking, and no file changes                                                    | opencode's `read` tool runs without a permission card, the note's text reaches the model's next request, and no file changes.                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                  |
| `file-edits.feature`: In Auto mode the agent edits a note without asking                                                                              | After the user picks Auto, an edit shows no permission card and changes the note, and the model is told the result.                                                                                                                                                                                                                                                                                    | [private #556](https://github.com/Brevilabs/obsidian-copilot-private/issues/556)                                                                                                                                                                   |
| `file-edits.feature`: A new chat's first edit asks when Default is saved, while another chat on the same opencode runs in Auto                        | A message sent as soon as a new chat can take one runs in the saved Default mode: its edit shows a permission card, and Reject leaves every file unchanged, although another chat on the same opencode process is in Auto.                                                                                                                                                                             | [private #71](https://github.com/Brevilabs/obsidian-copilot-private/issues/71), [private #556](https://github.com/Brevilabs/obsidian-copilot-private/issues/556)                                                                                   |
| `file-edits.feature`: An agent answering a read-only question cannot change a note                                                                    | When a multi-agent turn asks opencode read-only, Copilot refuses its `edit` and its `write` without showing a card, and every file stays byte-identical. The shell and the `task` subagent are not covered; see Known gaps.                                                                                                                                                                            | [private #12](https://github.com/Brevilabs/obsidian-copilot-private/issues/12), [private #573](https://github.com/Brevilabs/obsidian-copilot-private/issues/573), [private #572](https://github.com/Brevilabs/obsidian-copilot-private/issues/572) |
| `file-edits.feature`: An agent answering a read-only question can still run a shell command that reads a note                                         | Copilot lets a read-only answer run a shell command, whose output reaches the model, and `FanoutTurnView` draws the model's reply as the answer. No file changes.                                                                                                                                                                                                                                      | [private #138](https://github.com/Brevilabs/obsidian-copilot-private/issues/138)                                                                                                                                                                   |

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
  changes, whether an edit asks first, is a file-edit behavior. opencode
  offers no read-only mode: Copilot's only read-only surface for it is the
  answer an @-mentioned agent gives in a multi-agent turn, which runs in a
  session Copilot registers as read-only and whose write requests Copilot
  refuses without a card. That session starts in opencode's default agent,
  `copilot-build`, so its edits and shell commands ask Copilot first.
- **Stop.** On `session/cancel` while an answer streams, opencode closes the
  provider request within 5 ms and answers the prompt with `cancelled`. Stopped
  while it waits to retry, it answers `end_turn` within about 15 ms and makes
  no further attempt. Copilot shows the turn as `cancelled` in both cases,
  because Stop settles the turn without waiting for opencode's answer. Copilot
  sends the next prompt one second after the stopped one settles
  (`CANCELLED_TURN_QUIET_MS`).
- **Two chats.** Chats on one opencode process run their turns concurrently:
  a second chat's turn completes while the first chat's answer is held.
- **Provider errors.** opencode retries a 429, a 500, and a dropped
  connection five times, so a provider that keeps failing gets six attempts; a
  stream that breaks and whose retry is refused with a 400 gets two. A 400
  fails at once, unless its body reads like a server error (a body naming
  `server_error` got six attempts). A `retry-after-ms` header sets the wait,
  and `0` makes the retries immediate. Without a header the waits double from
  about 2 s: a 500 was retried after 2.4, 4.9, 9.2, 18.2, and 34.8 s and
  reached the chat after 70 s. A dropped connection was retried after 2.1 to
  2.5 s. When the attempts run out, the prompt fails with JSON-RPC `-32603` and
  the provider's message, which Copilot writes as
  `**Error:** Internal error: <message>`. The scenarios assert that opencode
  retried, not these counts, which are opencode's own policy.
- **History after an unfinished turn.** What opencode sends as the
  conversation on the next request. No scenario asserts it: it is opencode's
  behavior, and whether the model should be told about an unfinished turn this
  way needs a product decision.
  - After Stop while an answer streams, the stopped words become the model's
    reply: `user "First question"`, `assistant "Partial answer"`,
    `user "Second question"`.
  - After Stop while opencode waits to retry a broken answer, the words shown
    are dropped and the reply is empty: `user "Question"`, `assistant ""`,
    `user "Next question"`.
  - After a turn fails on a provider error, or a broken stream's retry is
    refused, the question is kept with no reply: `user "Question"`,
    `user "Next question"`.

- **Tools.** In both modes the model is offered `bash`, `edit`, `glob`,
  `grep`, `read`, `skill`, `task`, `todowrite`, `webfetch`, and `write`. The
  file tools take an absolute `filePath`: `edit` takes `oldString`,
  `newString`, and an optional `replaceAll`; `write` takes `content`; `read`
  takes an optional `offset` and `limit`. `bash` takes `command`, and an
  optional `timeout` and `workdir`. The scenarios map each operation onto these
  in one fixture, `OPENCODE_FILE_TOOLS` in `steps/index.ts`.
- **Edits.** In Default, `edit` and `write` ask once, with ACP kind `edit`, the
  note's absolute path as the title, the whole note before and after as the
  diff, and the options Allow once, Always allow, and Reject. `bash` asks with
  kind `execute` and the command as the title. Approved, an edit is written
  twice with the same bytes: opencode first sends `fs/write_text_file`, which
  Copilot's `VaultClient` writes through the vault adapter, and then its own
  tool writes the file on disk. The model is then told
  `Edit applied successfully.` by `edit` and `Wrote file successfully.` by
  `write`. In Auto, neither
  tool asks.
- **Rejected edits.** The tool call fails with "The user rejected permission
  to use this specific tool call.", and opencode ends the turn `end_turn`
  without asking the model again. The next request carries the rejection as
  that tool call's result: `user "Fix the note"`, `assistant ""` with the call,
  `tool "The user rejected permission to use this specific tool call."`,
  `user "Thanks"`. In a read-only answer the same rejection ends the answer
  with no text.
- **Reads.** `read` asks nothing in either mode and reads the file on disk
  itself; opencode never sends `fs/read_text_file`. The model gets the note
  inside `<path>`, `<type>`, and `<content>` tags with numbered lines, while
  the chat shows the note's plain text as the tool's result.
- **A vault reached through a symlink.** opencode resolves its working
  directory, so when the vault's path passes through a symlink (macOS's
  `/var` → `/private/var` temp dir), a file named by the vault's own path
  reads as outside it: every edit first asks for `external_directory`, with
  kind `other` and the vault folder as the title, before the edit's own card.
  The harness roots each scenario at the temp dir's real path.

### Known gaps (unverified)

These behaviors do not hold in the scripted runtime. None is verified, and a
release that ships with one ships what its consequence describes.

Three run as `@known-gap` scenarios, which assert the intended behavior and
pass only while it fails exactly as they state; the testing guide describes the
rule. Their descriptions carry the issue and the consequence:

- `model-selection.feature`: A model picked after the chat's last turn is
  still picked after opencode restarts
  ([#3319](https://github.com/logancyang/obsidian-copilot/issues/3319); open
  fix [#3323](https://github.com/logancyang/obsidian-copilot/pull/3323);
  [private #540](https://github.com/Brevilabs/obsidian-copilot-private/issues/540)).
  The resumed chat comes back on `alpha/model-a`, the model of its last turn.
- `model-selection.feature`: A chat with no turns is still on the saved
  default model after opencode restarts (same issues). The resumed chat shows
  `OpenCode Zen/Big Pickle`, and its first message goes to `opencode.ai`, which
  the egress proxy refuses.
- `file-edits.feature`: An agent answering a read-only question cannot change
  a note through the shell
  ([private #573](https://github.com/Brevilabs/obsidian-copilot-private/issues/573),
  [private #494](https://github.com/Brevilabs/obsidian-copilot-private/issues/494)).
  A multi-agent turn's read-only answer may run shell commands, so Copilot's
  relay skills (web search, fetch) keep working, and opencode has no sandbox of
  its own: opencode asks with kind `execute`, Copilot allows it once, and
  `printf … > note.md` overwrites the note. `rm` deleted a note the same way, a
  command writing `../outside.txt` changed a file outside the vault without an
  `external_directory` request, and `webfetch` ran without asking.

The rest are listed here, each with what keeps it from running as a scenario.
Each was observed with a scenario run outside the suite.

- **A retried stream repeats the words shown before it broke.** When a
  provider stream drops mid-answer and opencode's retry succeeds, opencode
  sends the whole retried answer as new chunks on the same message, and the
  chat appends them: after "Alpha Bravo", a break, and a retry answering
  "Alpha Bravo Charlie", the chat shows `Alpha BravoAlpha Bravo Charlie`, while
  the next request's history carries an empty reply and then
  `Alpha Bravo Charlie`. When every attempt drops, the reply reads
  `Alpha Bravo` six times. The user reads a garbled answer that is not what the
  model was told it said. The scenario that breaks a stream has the retry
  refused instead. Not executable: the scripted provider sends each word only
  once the chat shows everything before it, so the retried stream stalls at
  `Alpha BravoAlpha`, and the stall fails the run whatever the steps assert.
  [private #571](https://github.com/Brevilabs/obsidian-copilot-private/issues/571),
  the unfinished part of
  [private #163](https://github.com/Brevilabs/obsidian-copilot-private/issues/163).
- **A turn's error is not drawn once its reply has text.** Copilot writes a
  failed turn's error into the message's text, but the chat view draws a
  reply that has parts, including plain streamed text, from its parts alone.
  After "Alpha Bravo" and a break whose retry is refused, the chat draws
  `Alpha Bravo` and the tab's error dot, and the error's text is not on screen.
  The user sees a cut-off answer with no reason.
  The broken-stream scenario asserts what is drawn and the error status; when
  this is fixed, `drawnText` in `harness/runtime.ts` must follow the view's new
  rule and the scenario must expect the error. Not executable: where the chat
  should draw the error is not decided, so no step can state it.
  [private #388](https://github.com/Brevilabs/obsidian-copilot-private/issues/388).
- **A failing provider shows nothing until opencode stops retrying.** While
  opencode retries, the chat shows only a running turn: with no retry header,
  a 500 showed nothing for 70 s before the error appeared. The user cannot
  tell a failing provider from a slow one. The error scenarios ask the
  provider to retry at once to stay short. Not executable: what the chat
  should show while opencode retries is not decided.
  [#3104](https://github.com/logancyang/obsidian-copilot/issues/3104);
  [private #564](https://github.com/Brevilabs/obsidian-copilot-private/issues/564).
- **A new chat can take a message before its saved mode is applied.** Copilot
  asks opencode for the saved mode only once the chat is ready: with Auto
  saved, a new chat shows Default when it can first take a message, and a
  message sent then goes out before opencode confirms Auto. Copilot sends the
  mode request first, and opencode applied it before the message in 6 of 6
  runs, so the message's edit ran in Auto without a card; nothing in Copilot
  holds the message until the mode is confirmed, so the order is opencode's.
  A saved Default needs no request, because every opencode session starts in
  `copilot-build`: the first-edit scenario asserts it. The mode scenario waits
  for the switch. Not executable: opencode won the race in every run, so no
  scenario can make the message go first.
  [private #574](https://github.com/Brevilabs/obsidian-copilot-private/issues/574).
- **The agent can edit a note through its `task` subagent without asking.**
  `copilot-build` asks before `edit` and `bash`, but the model is also offered
  `task`, which runs opencode's `general` subagent with opencode's own
  permissions. When the scripted model called `task` and the subagent then
  called `edit` on `note.md`, opencode sent no permission request: in Default
  mode the chat showed no card and a single completed "Edit note" row, and the
  note changed. A shell write from the subagent changed the note the same way,
  and so did the same calls in a read-only answer. A Default-mode user who
  expects to approve every edit gets an edit they never saw. The scenarios
  cover edits the chat's own agent makes. Not executable: the subagent's own
  requests to the model carry a prompt no conversation sent, which the scripted
  provider refuses.
  [private #572](https://github.com/Brevilabs/obsidian-copilot-private/issues/572).

## Test boundary

A scenario talks to Copilot the way the Agent Chat view does: it creates a chat
through `AgentSessionManager.createSession`, sends through
`AgentChatUIState.sendMessage`, and reads the conversation from
`AgentChatUIState.getMessages()` as it changes, taking each message as the
chat view draws it: `AgentChatMessages` draws an assistant message that has
parts from its text parts, and any other from its text. It stops an answer with
`AgentChatUIState.cancel`, the stop button's call, switches chats with
`AgentSessionManager.setActiveSession`, a tab click's call, and reads each
chat's status and attention flag from the session, as the tab strip does: a
spinner while `running`, a red dot on `error`, an accent dot when the chat
needs attention. It picks a model, effort, or mode
through the callbacks of the pickers the chat input renders, which production
`buildAgentModelPicker` and `buildAgentModePicker` build from the running
opencode's reported state, and reads what those pickers show. It answers a permission card with
`AgentChatUIState.resolveToolPermission`, the card's `onResolve`, choosing the
option by the label its button shows; reads the card as `ToolPermissionCard`
renders it to static markup; and reads each tool call's row as `ActionCard`
draws it, from `lookupToolSummary`, and its result from the call's text output.
Everything from there to the model is production code or the real runtime.

A read-only question enters at `AgentSessionManager.runFanoutTurn`, with the
prompt built by `withReadOnlyPreamble`: the call `AgentSession` makes when a
message @-mentions agents other than the chat's own. The chat-side gate before
it, a Copilot Plus entitlement and a second installed agent, is not exercised,
and the settled answer is read as `FanoutTurnView` renders it to static markup.

**Real:** `AgentSessionManager`, `AgentModelPreloader` (the plugin-load probe
whose warm process the first chat adopts), `AgentSession`, `AgentMessageStore`,
`AgentChatUIState`, the default permission prompter with its read-only branch,
`FanoutOrchestrator`, `ToolPermissionCard`, `FanoutTurnView`, the backend registry and
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

| Substitute                              | Stands in for                           | Why                                                                                                                                                                                                                             |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness/scriptedProvider.ts`           | The remote model provider               | The one substitution the epic allows. Deterministic SSE over real loopback HTTP, so opencode's own provider adapter still runs. It can also hold an answer open, drop the connection, or refuse with an HTTP error.             |
| `obsidianShim.ts` → `FileSystemAdapter` | Obsidian's vault adapter                | Must be a class (`instanceof` checks) rooted at the temp vault. `exists` is called when the session ensures the vault's `AGENTS.md`; `write` when `VaultClient` answers opencode's `fs/write_text_file`, and records the write. |
| `obsidianShim.ts` → `Platform`          | Obsidian's platform flags               | `requireNodeModule` loads Node built-ins only on desktop.                                                                                                                                                                       |
| `obsidianShim.ts` → `normalizePath`     | Obsidian's path normalizer              | Same rule; path helpers depend on it.                                                                                                                                                                                           |
| `obsidianShim.ts` → `requestUrl`        | Obsidian's HTTP helper                  | Throws in scenarios, so a remote call from Copilot code fails by name. Only the fetcher enables it.                                                                                                                             |
| `obsidianShim.ts` → `Notice`            | Obsidian's toast                        | Records each message, so a scenario can assert what the user was told.                                                                                                                                                          |
| Generated inert classes                 | Every other `obsidian` export           | `build.mjs` emits an empty class per name in `obsidian.d.ts` the shim lacks. Imported modules only subclass or type against them on this path.                                                                                  |
| `harness/obsidianApp.ts` → `vault`      | Obsidian's `Vault`                      | `adapter` and `getName` feed the spawn; `getAbstractFileByPath` answers the empty index (callers fall back to the adapter); `on`/`offref` accept the project content tracker's subscriptions, and no vault event fires.         |
| `obsidianApp.ts` → `metadataCache`      | Obsidian's `MetadataCache`              | Same tracker subscription; nothing fires.                                                                                                                                                                                       |
| `obsidianApp.ts` → `workspace`          | Obsidian's `Workspace`                  | `getLeavesOfType` answers "no chat view is focused" when a finished turn asks whether to raise attention.                                                                                                                       |
| `obsidianApp.ts` → `secretStorage`      | The OS keychain behind `SecretStorage`  | In memory, so the synthetic key never reaches a real keychain. `KeychainService` itself is real.                                                                                                                                |
| Plugin object in `harness/runtime.ts`   | `CopilotPlugin`                         | Carries `app`, `manifest.version`, and the real `modelManagement` — the only members the session layer and opencode descriptor read on this path.                                                                               |
| `window = globalThis`                   | Electron's `window`                     | Agent Mode schedules timers with `window.setTimeout`.                                                                                                                                                                           |
| `build.mjs` → `Markdown`                | Obsidian's Markdown renderer            | Copilot's `Markdown` component renders through Obsidian after mount, which a static render never reaches; the bundle serves it as its source text. The rendered read-only answer gets an `app` with no open note.               |
| `build.mjs` bundle                      | The plugin's `esbuild.config.mjs` build | Node loads an ESM bundle with a CommonJS banner (`require`, `__dirname`) and `obsidian` aliased to the shim. `process.env.NODE_ENV` is `"production"`, as in a release build.                                                   |

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

Each scenario gets a fresh temp root holding the vault and an agent home, under
the real path of the OS temp dir (see "A vault reached through a symlink"). For
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

- a step is undefined or ambiguous, a step definition is unused, or no
  scenario is found (`vocabulary.mjs --check`, a dry run before the binary is
  installed);
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
  opencode's `Error handling request {`, the session's `prompt failed`, and
  the chat view's `turn failed`. The scenario expects each once per failed
  turn: the two Copilot lines only when they name that turn's error, and
  opencode's line, whose error follows on lines of their own, by count. They
  are matched regardless of when they were logged, because opencode's stderr
  can arrive after the turn has ended;
- Copilot answers a request opencode makes of it, such as
  `fs/write_text_file`, with an error. opencode logs such a failure only as an
  INFO frame and carries on, so the turn alone would not show it;
- no scenario runs, for example after a path typo (the `AfterAll` hook;
  Cucumber alone exits 0);
- a `@known-gap` scenario fails before its last step, fails there with a
  message that lacks its `Fails today with:` text, or passes (the step wrapper
  and the `After` hook in `steps/index.ts`).

The file-edit scenarios also record a digest of every file under the temp
root other than the agent home once the vault's notes are written, and assert
which of them changed, so a tool that writes beside the vault, or a note it
should not touch, fails the scenario. opencode itself wrote nothing there
outside the agent home in any file-edit scenario. An approved edit also
asserts the write that reached the vault adapter, because opencode's own tool
writes the same bytes to disk afterwards.

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
| Provider event         | 20 s   | Until the provider holds an answer or refuses a retry |
| Held request closed    | 10 s   | Stop until opencode closes the held request           |
| Permission card        | 20 s   | Send until the chat shows a card or the turn ends     |
| Read-only answer       | 20 s   | A read-only question until its answer settles         |
| Selection confirmed    | 10 s   | A pick, or a new chat's saved mode, until shown       |
| Settings change        | 30 s   | Old warm probe exits and the new one is warm          |
| Reload action          | 30 s   | Restart until the resumed chat can take a message     |
| Teardown wait          | 30 s   | In-flight startups before shutdown                    |
| Cucumber step          | 60 s   | `setDefaultTimeout`, above the harness bounds         |
| CI job                 | 10 min | `timeout-minutes` on the runtime job                  |

A scenario is bounded by its steps, and each step by the harness wait it makes,
at most 30 s.

Measured durations, with the pinned binary already cached:

| Where                                      | Scenario    | `test:runtime`                             | Whole job |
| ------------------------------------------ | ----------- | ------------------------------------------ | --------- |
| Apple M-series Mac, darwin-arm64, Node 26  | 1.6 – 5.9 s | 73 s                                       | —         |
| GitHub `ubuntu-latest`, linux-x64, Node 22 | 4.5 s mean  | 111 s, after a 5 s install on a cache miss | 147 s     |

Locally, startup through a ready session takes about 1.2 s and a turn about
1 s; the longest scenarios are the Stop during a retry (5.6 – 6.0 s), the
broken stream (4.7 – 4.9 s), which both wait out opencode's 2.1 – 2.5 s retry
delay, and the Reload action (4.7 – 4.9 s). A file-edit scenario takes 2.4 –
2.9 s. A stopped answer adds Copilot's one-second wait before the next prompt.
Under a CPU load of 12 busy processes on a 10-core machine, the suite passed in
138 s with the longest scenario at 9.7 s. In CI, `npm ci` takes 14-20 s of
the job, and the report of a passing run is not uploaded, so the CI scenario
time is the suite's time over its twenty-five scenarios. On a cache miss the CI install step downloads the release
in 5 s, against 1-2 s after a 1-3 s cache restore on a hit. The startup and
turn bounds are over fifteen times their local durations; the job bound is
over four times the CI job.

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
directory as the `runtime-report` artifact when the job fails. In CI the run
also lists each scenario's feature, name, and result, `passed`, `failed`, or
`known gap, unverified: <issue>`, in the job summary, with a note that a
scripted provider shows nothing about a real model's choices.

## The harness

`harness/` carries no test-runner vocabulary, so any test format can drive it.
`Runtime` owns the temp dirs, the scripted provider, the egress proxy, and the
session manager, and restarts opencode the way the product does;
`Conversation` wraps one chat's `AgentChatUIState` and records every distinct
state of the latest answer as the chat view draws it. The scripted provider
serves each configured provider row at its own base path, records the
endpoint, model, `reasoning_effort`, question, and conversation of every
request, and streams each word
only after the previous one is visible in the conversation that sent the
request, so a scenario can assert the order text arrives in without timing
assumptions, and a word that reaches another chat stalls the answer and fails
the scenario by name.

`ScriptedProvider.hold` queues an answer that stops after its first words and
resolves once the conversation shows them; the answer stays open until the
scenario releases it with the rest or breaks the connection, or opencode closes
the request. `ScriptedProvider.refuse` queues an HTTP error that refuses every
retry of the question it refused, as a failing provider does, and resolves once
the first refusal is sent. Scenarios wait on both as barriers, and each wait
reports what the provider has received and held, so an answer held on purpose
reads differently from a request that never arrived.
