# Agent Session Host

Contract for the Agent Mode session host, its operation log, and the client every UI reads through.
Delivered by [#609](https://github.com/Brevilabs/obsidian-copilot-private/issues/609) for epic
[#605](https://github.com/Brevilabs/obsidian-copilot-private/issues/605). Later lanes build on this
document: #611 (message pane on the client), #612 (composer, pickers, tabs on the client), #613
(WebSocket transport and phone UI).

## 0. Model in one page

```
                       desktop plugin process                                phone WebView
  AgentSession ─┐                                                     ┌─────────────────────────┐
  (decisions)   │ store ops      ┌────────────┐   frames             │ SessionClient           │
                ├──────────────► │ SessionHost│ ───────────────────► │  replica = apply(ops)   │
  AgentSession- │ listeners      │  op log    │  hello / subscribe   │  view state (client)    │
  Manager       ├──────────────► │  commands  │  snapshot / ops      └─────────────────────────┘
                │                └─────┬──────┘  command / result       same code, same React UI
                │                      │ in-process transport (#609) or WebSocket (#613)
                └──────────────────────┴───────────────► desktop SessionClient (#611, #612)
```

- **Host** owns authoritative state and runs commands. It lives on the desktop next to
  `AgentSessionManager` and never runs on the phone.
- **Client** keeps a replica of host state and its own view state. Every UI, the desktop panel
  included, reads the replica and sends commands.
- **State changes only through operations.** `applyHostOp` and `applySessionOp` are pure functions
  shared by the host and every client. Ids, timestamps and clock readings are chosen by the host and
  carried in the operation. Replaying the same operations from the same snapshot always yields
  identical state.
- **Commands are intents.** A command's effects reach clients only as operations. There is no
  optimistic client state.
- **Session decisions stay in `AgentSession`.** Dropping cancelled-turn output, placeholder gating
  and multi-agent merging run before the store is called; the reducer never contains them.
- **Reconnecting is the normal path.** iOS drops the socket shortly after every app switch, so
  resume from a sequence number is the common case and a fresh snapshot is the fallback.

Terms: a **scope** is an independently sequenced slice of host state (`host`, or `session:<id>`).
A **snapshot** is the full state of one scope at a sequence number. An **op** is one reducer input.
A **frame** is one protocol message.

## 1. Host state

Two scopes keep the always-needed data small and let a client subscribe to a transcript only while
it is on screen.

### 1.1 Scope `host`

```ts
export type Scope = "host" | `session:${string}`;

export interface HostState {
  tabs: readonly TabSummary[]; // attached sessions across all project scopes, display order
  backends: readonly BackendSummary[]; // picker catalog and readiness, one entry per agent
  host: HostFlags; // host-wide facts a composer needs
}

export interface HostFlags {
  defaultBackendId: BackendId | null; // the agent a new session starts on
  startingBackendId: BackendId | null; // set while a session is being created
  startFailed: boolean; // the last start failed; the error text never leaves the desktop
}

export interface TabSummary {
  id: SessionId; // AgentSession.internalId
  chatInputId: string; // key for client-side drafts; survives replace-in-place
  backendId: BackendId;
  projectId: ProjectScopeId;
  status: AgentSessionStatus; // starting | idle | running | awaiting_permission | error | closed
  label: string | null;
  labelSource: "user" | "agent" | null;
  needsAttention: boolean;
  canSwitchModel: boolean | null;
  canSwitchEffort: boolean | null;
  canSwitchMode: boolean | null;
}
```

`tabs` holds every attached (not detached-from-tab) session across project scopes. Each tab carries
its `projectId`; a client filters by the project scope it is showing. The phone shows
`GLOBAL_SCOPE` only. Detached sessions keep running on the host and are not in `tabs`, but their
`session:<id>` scope stays available.

`backends` is the picker catalog (section 6.1). Each `BackendSummary` carries the agent's display
name, a readiness label (`checking | ready | not_set_up | update_required | setup_error`), the
model preload state (`absent | pending | ready | error`), whether the agent is self-hostable, the
enabled models, the models the agent reports for them, the effort levels per model, the saved
default selection and the license preview rows. Readiness is the install state reduced to its
kind, so paths, versions and messages stay on the desktop. A client assembles the picker from the
catalog and its own active session (`protocol/pickerEntries.ts`), because which agents and which
model rows appear depends on that session.

### 1.2 Scope `session:<id>`

```ts
export interface SessionState {
  transcript: readonly WireMessage[];
  backendState: BackendState | null; // model + mode + apply specs, as the backend reports them
  pending: PendingState;
  plan: CurrentPlan | null;
  todos: readonly AgentTodoListEntry[] | null;
  usage: SessionUsage | null;
  planUsage: PlanUsage | null;
}

export interface PendingState {
  permissions: readonly PermissionPrompt[]; // tool permissions
  questions: readonly WireQuestionPrompt[]; // AskUserQuestionPrompt without `signal`
  planPermission: boolean; // a plan-gated permission is waiting
}
```

A client always subscribes to `host`, and to `session:<id>` for each session it displays. Status
lives only in `TabSummary`, so a client combines the two scopes; the two are sequenced separately
and a client can briefly see `running` a frame before the placeholder message. Every consumer
derives from both scopes and nothing depends on their relative arrival order.

### 1.3 Client-only view state

Never replicated: active tab id, active project scope, composer drafts and send queue
(`AgentInputDraftStore`, keyed by `chatInputId`), scroll position, expanded trail groups,
in-progress tab rename, selected text contexts, web-tab context, `loading`.

The active tab and project scope live in a `ClientView` (`protocol/ClientView.ts`), one per client.
A command never changes it: the client that asked for a session chooses to show it when the result
names it, so a session that one client creates, replaces or closes cannot move another client's
visible tab. The view follows the shared tab set: the first tab set selects the last tab of the
current scope, and when the shown tab leaves the set the view moves to its replacement (the tab
with the same `chatInputId`), else to the neighbor in the same scope, else to none. A view reports
the tab it shows with the `focus` frame, and the host tracks the tab each connection focused.
`AgentSessionManager` reads the desktop panel's view for the flows only the desktop has (history,
projects, saving the shown chat) and writes it only from those flows.

### 1.4 Where each field comes from

| Field                | Source on the host                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `transcript`         | `AgentMessageStore` (its emitted transcript ops)                                                     |
| `backendState`       | `AgentSession.getState()` via `onModelChanged`                                                       |
| `pending`            | `getPendingToolPermissions()`, `getPendingAskUserQuestions()`, `hasPendingPlanPermission()`          |
| `plan`, `todos`      | `getCurrentPlan()` via `onCurrentPlanChanged`, `getCurrentTodoList()` via `onCurrentTodoListChanged` |
| `usage`, `planUsage` | `getSessionUsage()`, `getPlanUsage()` via `onMessagesChanged`                                        |
| tab fields           | `AgentSession` getters via `onStatusChanged`, `onLabelChanged`, `onNeedsAttentionChanged`            |
| tab set and order    | `AgentSessionManager.subscribe()` plus `getTabSessions()`                                            |
| `backends`, `host`   | `CatalogSource` (`session/host/catalogSource.ts`): settings, model cache, install states, manager    |

Non-transcript slices are projected by reference diff: `AgentSession` replaces `currentState`,
`currentPlan`, `currentUsage`, `currentPlanUsage` and `currentTodoList` rather than mutating them, so
a `SessionProjector` compares each getter's result with the last projected value on every listener
callback and emits a `slice` op only when the reference changed. `pending` compares the ordered
request objects. No `AgentSession` code changes for these slices.

The host keeps no second copy of the transcript. A session snapshot reads `AgentMessageStore` (which
already holds the reduced transcript) and the projector's last projected slice values, so a snapshot
always equals the log head.

## 2. Operations

Every op is JSON. No `undefined` carrying meaning (a cleared value is `null`), no `Map`/`Set`, no
`Date`, no functions.

### 2.1 Transcript ops

The message shape is generic over its context type so one reducer serves the host store (context
holds `TFile`) and replicas (context holds note paths):

```ts
export interface MessageOf<C> {
  id: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  isErrorMessage?: boolean;
  message: string;
  parts?: AgentMessagePart[];
  context?: C;
  content?: unknown[];
  turnStopReason?: StopReason;
  turnDurationMs?: number;
  fanout?: FanoutTurn;
}
// session/types.ts: export type AgentChatMessage = MessageOf<MessageContext>;
// protocol/state.ts: export type WireMessage = MessageOf<WireMessageContext>;

export type TranscriptOp<C> =
  | { t: "msg.add"; message: MessageOf<C> } // id, timestamp chosen by the host
  | { t: "msg.turnComplete"; id: string; stopReason: StopReason; durationMs: number; atMs: number }
  | { t: "msg.extendDuration"; id: string; durationMs: number }
  | { t: "msg.setFanout"; id: string; turn: FanoutTurn } // a snapshot the store cloned
  | { t: "msg.appendText"; id: string; text: string; atMs: number }
  | { t: "msg.appendThought"; id: string; text: string; atMs: number }
  | { t: "msg.upsertPart"; id: string; part: AgentMessagePart; atMs: number }
  | { t: "msg.markError"; id: string; errorText: string; durationMs?: number; atMs: number }
  | { t: "transcript.set"; messages: readonly MessageOf<C>[] }; // replaced whole

export function applyTranscriptOp<C>(
  messages: readonly MessageOf<C>[],
  op: TranscriptOp<C>
): readonly MessageOf<C>[]; // returns the same reference when the op changes nothing
```

`atMs` is the clock reading the store used for thought spans and `finishTrailingThought`. The
reducer never reads a clock, a random source or `formatDateTime`.

Every `AgentMessageStore` mutation and the op it emits:

| Store method                              | Op                   |
| ----------------------------------------- | -------------------- |
| `addMessage`                              | `msg.add`            |
| `markTurnComplete`                        | `msg.turnComplete`   |
| `extendTurnDuration`                      | `msg.extendDuration` |
| `setFanout`                               | `msg.setFanout`      |
| `appendAgentText`                         | `msg.appendText`     |
| `appendAgentThought`                      | `msg.appendThought`  |
| `upsertAgentPart`                         | `msg.upsertPart`     |
| `markMessageError`                        | `msg.markError`      |
| `loadMessages` (fanout composites parsed) | `transcript.set`     |

Agent Mode has no message deletion, truncation or clearing, so the vocabulary has no such ops.

The store applies each mutation through `applyTranscriptOp`, so host and replicas share one
implementation, and it emits the op to `onOp` listeners only when the reducer returned a new
reference. Its clock and id sources are injected as `{ now, newId }` (defaults `Date.now` and the
existing id scheme), which is what puts them in the op.

### 2.2 Session-slice op

Slices that change rarely and are small are replaced whole:

```ts
export type SliceKey = "backendState" | "pending" | "plan" | "todos" | "usage" | "planUsage";
export type SliceOp = {
  [K in SliceKey]: { t: "slice"; key: K; value: SessionState[K] };
}[SliceKey];

export type SessionOp = TranscriptOp<WireMessageContext> | SliceOp;
```

### 2.3 Host-scope ops

```ts
export type HostOp =
  | { t: "tab.add"; index: number; tab: TabSummary }
  | { t: "tab.remove"; id: SessionId }
  | { t: "tab.patch"; id: SessionId; patch: TabPatch }
  | { t: "backend.set"; index: number; backend: BackendSummary } // replaces the backend with that id
  | { t: "host.patch"; patch: Partial<HostFlags> };
```

`tab.add` covers create, replace-in-place (`index` is the old tab's position; `tab.remove` for the
old id follows) and re-attach after a detach; adding an id that is already present moves it. Immutable
fields (`backendId`, `projectId`, `chatInputId`) are set only by `tab.add`.

### 2.4 Reducer rules

- Pure and total: unknown ids are ignored, and an op that changes nothing returns the input
  reference.
- Structural sharing: only touched objects are re-created, so `React.memo` and selectors keep
  working.
- No `Date`, `performance`, `Math.random`, `crypto`, `formatDateTime`, logger, or `obsidian` value
  import (enforced in section 7.3).

## 3. Commands

A command is `{ name, ...args }`. The host validates, runs it through existing session code, and
answers with a `CommandResult`. Effects arrive as ops (the "Ops" column is what a client should
expect, not something the handler constructs).

```ts
export type CommandResult<V = void> =
  | { ok: true; value: V }
  | { ok: false; code: CommandErrorCode; message: string };

export type CommandErrorCode =
  | "unknown_session"
  | "session_starting"
  | "session_busy"
  | "session_closed"
  | "stale" // prompt/plan already resolved, first device to answer wins
  | "invalid"
  | "too_large"
  | "failed";
```

Commands never touch a client's view state and carry an explicit `sessionId` where they act on one.

| Command                                                                                                                            | Replaces                                      | Validation                                                                                                                                                                                                                                                                                                                                                       | Host call                                                                                                                        | Ops                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `send { sessionId, text, context?: SendContext, images?: ImageBlock[], mentionedAgents? }` → `{ userMessageId, droppedNotePaths }` | `AgentChatInput.tsx` (`backend.sendMessage`)  | session exists; status is `idle` or `error` (`session_starting`, `session_busy`, `session_closed` otherwise); `text.trim()` or an image present; note paths resolved with `vault.getAbstractFileByPath`, unresolved paths dropped and reported; `mentionedAgents` all known backend ids; image mime in `image/{png,jpeg,gif,webp}` and size limits (section 6.3) | `getChatUIState(id).sendMessage(text, context, promptContent, mentionedAgents)`; resolves when the turn starts, not when it ends | `msg.add` x2, `tab.patch{status}`, then the turn stream                                                              |
| `cancel { sessionId }`                                                                                                             | `AgentChatInput.tsx` (`backend.cancel`)       | session exists; idempotent when nothing runs                                                                                                                                                                                                                                                                                                                     | `getChatUIState(id).cancel()`                                                                                                    | `slice pending`, `msg.turnComplete`, `tab.patch{status}`                                                             |
| `resolvePermission { sessionId, toolCallId, optionId }`                                                                            | `AgentChatMessages.tsx`                       | `toolCallId` in `pending.permissions` else `stale`; `optionId` among its options else `invalid`                                                                                                                                                                                                                                                                  | `getChatUIState(id).resolveToolPermission`                                                                                       | `slice pending`, `tab.patch{status}`, tool-call parts from the resumed turn                                          |
| `answerQuestion { sessionId, requestId, answers }`                                                                                 | `AgentChatMessages.tsx`                       | `requestId` pending else `stale`; `answers` is an object whose keys are a subset of the request's `answerKey ?? question` and whose values are strings                                                                                                                                                                                                           | `getChatUIState(id).resolveAskUserQuestion`                                                                                      | `slice pending`, `msg.upsertPart` (recorded answer), `tab.patch{status}`                                             |
| `resolvePlan { sessionId, proposalId, decision, feedbackText? }`                                                                   | `PlanProposalCard.tsx`, `PlanPreviewView.tsx` | `plan.id === proposalId`, `plan.decision === "pending"`, plan-gated permission pending, else `stale`; `feedbackText` present only for `decision === "feedback"`                                                                                                                                                                                                  | `getChatUIState(id).resolvePlanProposal` (keeps the next-turn feedback delivery and its `currentTurn` wait)                      | `slice plan`, `slice pending`, `msg.upsertPart`, `tab.patch{status}`; for `next_turn` delivery a later `send` stream |

Session decisions stay where they are. For example a `send` during a cancelled turn's drain is
still queued by `AgentSession.runTurn`; a `send` that races a permission answer from another
device sees `session_busy`; two devices answering the same permission produce one `ok` and one
`stale`.

Tab and picker commands:

| Command                                                                        | Validation                                                                                                                                               | Host call                                                                                                                                                                                                                                    | Value                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `createSession { backendId?, projectId?, seedSelection? }`                     | `backendId` is a known agent; `seedSelection` is `{ baseModelId, effort }`; `projectId` is the global scope (the default) or a project the desktop knows | `manager.createSession`                                                                                                                                                                                                                      | `{ sessionId }`                                               |
| `replaceSession { sessionId, backendId?, preserveChatInput?, seedSelection? }` | session exists; same checks as `createSession`                                                                                                           | `manager.replaceSessionInPlace`                                                                                                                                                                                                              | `{ sessionId }` of the replacement                            |
| `openTab { sessionId }`                                                        | session exists                                                                                                                                           | `manager.openTab` (puts a closed tab back in the set)                                                                                                                                                                                        | none                                                          |
| `closeTab { sessionId }`                                                       | session exists                                                                                                                                           | `manager.detachSessionFromTab` (the session keeps running)                                                                                                                                                                                   | none                                                          |
| `renameSession { sessionId, label }`                                           | `label` is text or null                                                                                                                                  | `manager.renameSession`                                                                                                                                                                                                                      | none                                                          |
| `applySelection { sessionId, backendId, baseModelId?, effort? }`               | a model or an effort is present; `backendId` is a known agent                                                                                            | same agent: `manager.applySelectionTo`; another agent with a model: `manager.replaceSessionInPlace` seeded with the pick, keeping the composer draft; another agent with only an effort, or for a session that already has messages: `stale` | `{ sessionId }` of the session that now carries the selection |
| `applyMode { sessionId, mode }`                                                | the session's agent reported a way to apply `mode`                                                                                                       | `manager.applyModeTo`                                                                                                                                                                                                                        | none                                                          |

`unsupported` is the code for an agent that cannot switch model, effort or mode while running. No
command persists a default: a desktop client remembers a picked agent or mode as its default
after the host accepts the command, through a desktop capability (section 9.2.1). Desktop-only
surfaces keep calling the manager directly: history, projects (`enterProject`, `exitProject`,
`rematerializeContext`), `saveActiveSession`, `closeChatSession`, install/sign-in/held-config
flows, `getOrCreateActiveSession` auto-start, and `main.ts`.

## 4. Frame protocol

One JSON object per frame; `type` discriminates.

```ts
export const PROTOCOL_VERSION = 1;

export type ClientFrame =
  | { type: "hello"; v: number; app: string } // app = plugin version, for error text only
  | { type: "subscribe"; scope: Scope; fromSeq?: number; epoch?: string }
  | { type: "unsubscribe"; scope: Scope }
  | { type: "focus"; sessionId: SessionId | null } // the tab this client shows, or null
  | { type: "command"; id: string; command: Command };

export type ServerFrame =
  | { type: "hello"; v: number; app: string; hostId: string; ok: boolean }
  | {
      type: "snapshot";
      scope: Scope;
      epoch: string;
      seq: number;
      state: HostState | SessionState | null;
    }
  | { type: "ops"; scope: Scope; epoch: string; from: number; ops: readonly (HostOp | SessionOp)[] }
  | { type: "result"; id: string; result: CommandResult<unknown> };
```

**Sequencing.** Each scope has its own counter. A scope starts at `seq 0` (empty log) and every op
increments it. A log also has an `epoch`, a random id created with the log: a host that restarts, or a
session swapped in behind an existing id, starts a new log whose sequence numbers overlap the old one.
A cursor is the pair `(epoch, seq)`, and `snapshot` and `ops` frames carry the `epoch` of the log they
describe. `ops.from` is the sequence number of the first op in the frame; the frame covers
`from .. from + ops.length - 1`. `hostId` is a random id created when the host starts.

**Handshake.** The client sends `hello`. The host answers `hello` with `ok: false` when `v` differs
from its `PROTOCOL_VERSION`. Versions must be equal; there is no negotiation. A client that
receives `ok: false` enters connection state `version_mismatch` and exposes the host's `app` string
for an "update Copilot on both devices" message. An `ok: true` reply carries `hostId`; the client
discards every stored cursor when `hostId` differs from the one it last saw.

**Subscribe.**

1. The host flushes, so the log head reflects every applied op.
2. If `fromSeq` is a number the log still covers (`oldest - 1 <= fromSeq <= head`) and `epoch` names
   that log, the host replies `ops` with `from = fromSeq + 1` and everything after it; the array is
   empty when the client is current. Otherwise (no epoch, another log's epoch, an evicted position) it
   replies `snapshot` at `seq = head`.
3. The connection is then subscribed: later frames for the scope go out on each flush.
4. Unknown scope, or a session that later disposes, yields `snapshot` with `state: null`.

**Client apply rule** per scope, with cursor `c`:

| Incoming `ops.from` | Action                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `c + 1`             | apply all, `c += ops.length`                                                                                             |
| `<= c`              | apply only the suffix beyond `c` (overlap after a resume)                                                                |
| `> c + 1`           | gap: drop the frame, send `subscribe(scope)` without `fromSeq`, ignore `ops` for that scope until the `snapshot` arrives |
| another `epoch`     | treated as a gap: the frame belongs to a different log than the cursor                                                   |

`snapshot` replaces the scope state and sets the cursor to `(epoch, seq)`.

**Reconnect (normal path).** On every open the client sends `hello`, then `subscribe(scope,
fromSeq, epoch)` for each wanted scope. A reconnect within the log window costs one small `ops` frame per
scope; an evicted cursor, a new `hostId` or another log's `epoch` costs a snapshot. In-flight commands resolve with
`code: "failed"` and message `disconnected`; a command is never re-sent automatically because
`send` is not idempotent. The network transport (section 5.2.1) owns backoff, the connect timeout and
the visibility-change reconnect; the client core only reports `connecting | live | reconnecting |
offline | version_mismatch`.

**Focus.** A client sends `focus` when the tab it shows changes and again after every reconnect,
because the host forgets a connection's focus with the connection. The host clears the
`needsAttention` mark of a focused session and does not set it on a session some connection
focuses (`SessionHost.isSessionFocused`, which the manager consults when a turn finishes).

**Ordering.** Within a connection, frames for one scope arrive in sequence order. A command's ops
that were emitted synchronously reach the client before its `result`. Ordering across scopes is not
defined.

**Op log and flush.** The host appends every op to its scope's log when it is emitted. Each
connection tracks the last sequence it was sent per scope, and a flush sends everything after it as
one `ops` frame. Streaming ops (`msg.appendText`, `msg.appendThought`, `msg.upsertPart`,
`msg.setFanout`, `msg.extendDuration`) flush on a 16 ms `setTimeout`; every other op flushes
synchronously and carries earlier unsent ops with it, preserving order. The flush uses `setTimeout`,
not `requestAnimationFrame`, because rAF stops in a hidden Obsidian window and the phone would
stall. The log is an in-memory ring per scope, bounded by op count (2000) and a byte budget (8 MiB,
estimated per op at append); it is never persisted (#607 owns persistence). A flush for a
connection whose last-sent sequence the log has already evicted sends a snapshot instead of ops.

## 5. Transports and client

### 5.1 Transport interface

```ts
export interface ClientTransport {
  send(frame: ClientFrame): void;
  onFrame(cb: (frame: ServerFrame) => void): () => void;
  onOpenChange(cb: (open: boolean) => void): () => void;
  close(): void;
}
```

The host side is `SessionHost.connect(send, onClose?): HostConnection` with
`connection.receive(frame)` and `connection.close()`; `SessionHost.dispose()` calls every
connection's `onClose`, so a transport reports closed and its client leaves `live`. A transport is a pair of pumps between the
two; it adds no protocol logic.

### 5.2 In-process transport

`createInProcessTransport(host, { serialize })` differs from a socket only in what happens to a
frame between `send` and delivery:

| `serialize` | Used in                         | Effect                                                                                                                             |
| ----------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `true`      | tests and non-production builds | `JSON.parse(JSON.stringify(frame))`: exactly what a WebSocket delivers, including dropped `undefined` and rejected non-JSON values |
| `false`     | production desktop              | frames pass by reference                                                                                                           |

Delivery is always asynchronous (`queueMicrotask`), so a client callback never runs inside a host
emit and the timing model matches a network. The reducers are immutable, which is what makes
by-reference delivery safe. Whether production should also serialize is decided by the benchmark in
section 8.3.

### 5.2.1 WebSocket transport

A paired phone reaches the host over the authenticated channel of [`REMOTE_PAIRING.md`](./REMOTE_PAIRING.md).

- **Desktop.** `serveRemoteConnection(host, connection)` (`session/host/serveRemoteConnection.ts`)
  connects one `RemoteConnection` to `SessionHost.connect`. Frames leave as JSON text; text from the
  phone is parsed by `parseClientFrame` (`protocol/frameCodec.ts`), and anything that is not a
  well-formed client frame closes the connection with `1003`. A frame over 32 MiB is sent again with every
  inline image of its transcript replaced by a placeholder (a user message carries its images as data
  URLs), and one still over the limit closes the connection with `1009`. Inbound messages are capped at
  16 MiB by the listener, and the listener destroys a connection whose unsent backlog passes 64 MiB, which
  is a phone that stopped reading while the desktop kept streaming.
- **Phone.** `RemoteSessionTransport` (`mobile/RemoteSessionTransport.ts`) implements `ClientTransport`
  over `RemoteClient.connect`. It replaces the channel every time the app returns to the foreground,
  because iOS closes the socket about a second after backgrounding and keeps reporting it open until
  the app returns. After a failed attempt or an unexpected close it redials with backoff (1, 2, 4, 8,
  then 15 seconds), resetting the backoff once a connection has stayed open for 5 seconds. A refused
  connection is `offline` (Obsidian closed on a machine that is up); an attempt that hits the 8 second
  connect timeout is `unreachable` ("Can't reach your desktop. Is Tailscale on?"). A channel that
  carries no protocol frame within 8 seconds of opening is dropped and reported as an unexpected reply
  ("Update Copilot on both devices"), because a desktop on a Copilot without the session protocol
  admits the phone and never answers hello. Close codes `4401` and `4403` end the retries because the
  desktop rejected the phone.
- **Commands are never re-sent.** The client fails an in-flight command with `disconnected`. A
  composer whose `send` failed returns the message, and the follow-ups queued behind it, to the
  composer. After a lost connection it asks the user to check the chat before sending again, because
  the host may have run the command and lost only its answer.

The same recorded sessions run over this transport in `SessionHost.remote.parity.test.ts`, with the
real listener on loopback and `ws` as the phone's WebSocket.

### 5.3 Client core

```ts
export class SessionClient {
  constructor(
    transport: ClientTransport,
    opts: { app: string; onDiagnostic?: (d: Diagnostic) => void }
  );
  getConnection(): ConnectionState;
  getHost(): HostState | null;
  getSession(id: SessionId): SessionState | null; // null until its snapshot arrives
  subscribe(listener: () => void): () => void; // one notification per applied frame
  watchSession(id: SessionId): () => void; // ref-counted subscribe(session:<id>)
  setFocus(id: SessionId | null): void; // reported to the host, re-sent after a reconnect
  command<N extends CommandName>(
    command: Extract<Command, { name: N }>
  ): Promise<CommandResult<CommandValue<N>>>;
}
```

The client owns cursors, the gap rule, ref-counted scope subscriptions and pending-command
bookkeeping. It performs no I/O and reads no clock, so it runs unchanged under Node, jsdom and a
phone WebView. Diagnostics go through the injected callback, never `@/logger`.

### 5.4 React selectors

`useSyncExternalStore` with selectors, in `protocol/react.ts`:

```ts
export function useHostSelector<T>(
  client: SessionClient,
  select: (s: HostState) => T,
  eq?: (a: T, b: T) => boolean
): T | null;
export function useSessionSelector<T>(
  client: SessionClient,
  id: SessionId,
  select: (s: SessionState, host: HostState) => T,
  eq?: (a: T, b: T) => boolean
): T | null;
```

Each hook memoizes the last `(state reference) -> selected value` pair and returns the previous
value when `eq` (default `Object.is`) says it is unchanged, so a component re-renders only when
its selection changes. Selectors must return values that are stable while their inputs are stable;
`useClientView(client, view)` returns the tabs in the view's project scope and the tab the view
shows. `selectors.ts` provides the memoized ones (`selectVisibleMessages`, `selectChatRuntime`).
`selectChatRuntime(host, session, id)` returns the chat's runtime state (`messages`,
`isStarting`, `isTurnInFlight`, `hasPendingPlanPermission`, `currentPlan`, `currentTodoList`,
`pendingToolPermissions`, `pendingAskUserQuestions`); the message pane reads it through
`useChatRuntime(client, sessionId)`.

## 6. Data boundaries

### 6.1 Host state carries no credentials

`HostState` and `SessionState` are built from named fields only; nothing spreads a settings object
into them. The picker catalog reduces `credentialState` to a `missingKey` flag and builds every row with
named fields (`toPickerModel` for anything that arrives shaped like a `CustomModel`), so `apiKey`,
`baseUrl`, `openAIOrgId` and backend environment overrides are unreachable from the wire types. A
test serializes both scopes from settings seeded with sentinel credentials and asserts that no
credential field or value appears. `host.startFailed` is a boolean; the manager's `lastError` text
can echo spawn arguments or stderr and never enters host state.

Everything in `SessionState` (tool inputs and outputs, note excerpts) is user content by design and
travels to authenticated clients only.

### 6.2 Notes travel as vault paths

`MessageContext.notes` is `TFile[]` and cannot cross the wire.

```ts
export interface NoteRef {
  path: string;
  basename: string;
}
export interface WireMessageContext extends Omit<MessageContext, "notes"> {
  notes: NoteRef[];
}
export interface SendContext extends Omit<WireMessageContext, "notes"> {
  notePaths: string[];
}
```

The host emits `msg.add` and `transcript.set` with contexts projected to `NoteRef`. On `send` the
host resolves `notePaths` with `vault.getAbstractFileByPath(normalizePath(path))`; a path that does not
resolve is dropped and returned in `droppedNotePaths`, and a path outside the vault cannot resolve.
Components that render context need only `path` and `basename`, which both `TFile` and `NoteRef`
provide (#611 narrows their prop types).

### 6.3 Images travel inside the send command

`ImageBlock` is `{ mimeType: string; data: string /* base64 */ }`, the same shape as the existing
`PromptContent` image block. The host builds the user message `content` data URLs
(`buildUserDisplayContent`) exactly as today, so the image reaches every client through `msg.add`.
Limits live in `protocol/limits.ts`, so a client can check them before sending, and the host
enforces them: 8 MiB per image decoded, 4 images and 24 MiB per command. Over-limit input returns
`too_large`.

## 7. File layout and the mobile boundary

### 7.1 Layout

```
src/agentMode/protocol/          Environment-free. The only agent code the phone loads.
  state.ts                       HostState, SessionState, TabSummary, BackendSummary, MessageOf, Wire* types
  ops.ts                         HostOp, SessionOp, TranscriptOp, SliceOp
  applyTranscript.ts             applyTranscriptOp
  apply.ts                       applyHostOp, applySessionOp
  commands.ts                    Command, CommandResult, error codes
  limits.ts                      image limits
  frames.ts                      ClientFrame, ServerFrame, PROTOCOL_VERSION
  transport.ts                   ClientTransport
  SessionClient.ts               replica, cursors, command sender
  selectors.ts                   memoized derived selectors
  pickerEntries.ts               assembles the model picker from the catalog and the active session
  ClientView.ts                  one client's active tab and project scope
  react.ts                       useHostSelector, useSessionSelector, useClientView
  index.ts                       the mobile-safe surface

src/agentMode/session/host/      Desktop only. Depends on AgentSession and the manager.
  SessionHost.ts                 scopes, subscriptions, frame handling, command dispatch
  OpLog.ts                       per-scope ring buffer
  SessionProjector.ts            listener/reference diff -> slice and tab ops
  TabProjector.ts                manager notify -> tab.add / remove / patch
  CatalogProjector.ts            catalog and flag changes -> backend.set / host.patch
  catalogSource.ts               builds the catalog source from settings, model cache and the manager
  commandHandlers.ts             one function per command
  inProcessTransport.ts          createInProcessTransport
```

Existing files change as follows.

- `session/AgentMessageStore.ts`: holds `readonly AgentChatMessage[]`, applies each mutation through
  `applyTranscriptOp`, and emits the op to `onOp` listeners. The constructor takes `{ now, newId }`.
  The per-message `version` and display cache are gone; `getDisplayMessages()` memoizes on the array
  reference. `getMessages()` returns the full transcript. Unused mutation methods are deleted
  (`deleteMessage`, `clear`, `truncateAfterMessageId`, `appendDisplayText`), as are
  `AgentChatUIState.deleteMessage`/`clearMessages` and the matching `AgentChatBackend` members.
- `session/types.ts`: `AgentChatMessage` is `MessageOf<MessageContext>`.
- `session/AgentSessionManager.ts`: one addition, `getTabSessions()` (attached sessions in map
  order).
- `agentMode/index.ts`: constructs `SessionHost` beside the manager and disposes it before
  `manager.shutdown()`.

Boundary rules (`eslint.config.mjs`): element `{ type: "protocol", pattern: "src/agentMode/protocol"
}` before the catch-all `host`; `session`, `ui` and `barrel` may import `protocol`; `protocol` may
import `protocol`, `session` and `host` (type-only, by the fence below). `session/host` is part of
`session`. `src/agentMode/AGENTS.md` documents the layer.

### 7.2 What the phone may load

`protocol/` is the whole mobile agent surface plus the UI that #613 adds. Its value imports come
only from itself and `react`. Everything else it names is a type import, which the bundler erases,
so the protocol layer describes `session/` types without loading `session/` values, `acp/`, `sdk/`,
`backends/`, Node built-ins, `electron`, `@/logger`, `@/settings/model`, `@/utils`, or `obsidian`
values. `AgentSessionManager` already throws on `Platform.isMobile`; `src/main.ts` keeps loading
`@/agentMode` only behind `isDesktopRuntime()`. The phone loads `@/agentMode/mobile` instead
(section 9.5).

`app.emulateMobile(true)` flips `Platform.isMobile` inside Electron's Chromium with `require` still
working (`Platform.isDesktopApp` stays `true`), so a Node-only import would load and run under it.
It cannot show that the phone bundle loads; the checks below stand in for it, and a real iPhone
remains the final gate for #613.

### 7.3 Enforcement

1. **Lint fence** for `src/agentMode/protocol/**`
   (`@typescript-eslint/no-restricted-imports`, `allowTypeImports: true`): value imports only from
   `@/agentMode/protocol/*`; `electron` and `obsidian` values, and Node built-ins (the repo-wide
   `copilot/no-direct-node-imports`), are banned. `no-restricted-properties` bans `Date.now`,
   `performance.now`, `Math.random` and `crypto` in `apply.ts`, `applyTranscript.ts`,
   `SessionClient.ts` and `selectors.ts`, and `no-restricted-syntax` bans `new Date` there.
2. **Bundle closure**: `scripts/mobile-load-smoke.cjs` bundles `src/agentMode/protocol/index.ts`
   with esbuild (`platform: "browser"`, `metafile`, `external: ["react", "obsidian"]`). Node
   built-ins fail to resolve, and the check fails when any input file is outside
   `src/agentMode/protocol/` or `node_modules`. It then evaluates the bundle in a `vm` context whose
   Node and `obsidian` modules throw on access. The script's `checkAgentModeImportBoundaries`
   allows value imports of `@/agentMode/protocol` and nothing else under `@/agentMode`. CI runs this
   script after `npm run build`.

## 8. Test plan

Follows `AGENTS.md`: one top-level `describe` per module, one nested `describe` per callable,
`it` names that state condition and outcome.

### 8.1 Success criteria mapping

| #609 criterion                                                                                              | Test                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host state equals a replica after replaying the host's ops for recorded Claude, Codex and opencode sessions | `SessionHost.parity.test.ts`: for each session script, drive a real `AgentSession` and manager through a scripted `BackendProcess`, connect a client over the serializing transport, and after the script and after every 50th op assert `client.getSession(id)` deep-equals the host's projection of the live session and `client.getHost()` equals the tab projection. Also cut a snapshot mid-stream, continue, and assert the same end state. |
| Sequence gap triggers resnapshot                                                                            | `SessionClient.test.ts` (fake transport) and `SessionHost.test.ts` (real host): a dropped frame makes the client send `subscribe` without `fromSeq`, ignore later ops for that scope, apply the snapshot, and end equal to the host.                                                                                                                                                                                                              |
| Reconnect from cursor is the normal path                                                                    | `SessionHost.test.ts`: disconnect at seq n, reconnect, assert one `ops` frame from `n + 1` and no `snapshot`; evicted cursor and changed `hostId` each produce a `snapshot`; version mismatch yields `hello ok:false` and `version_mismatch`.                                                                                                                                                                                                     |
| Each command produces its expected ops                                                                      | `commandHandlers.test.ts`, table-driven from section 3: valid input yields the listed ops in order; each validation branch yields its error code and no ops; two devices answering one permission yield one `ok` and one `stale`.                                                                                                                                                                                                                 |
| Reducer never calls `Date.now()` or a random source                                                         | `applyTranscript.test.ts` replays ops with `Date.now`, `performance.now` and `Math.random` replaced by throwing stubs and inputs deep-frozen. Static: the lint rule in section 7.3.                                                                                                                                                                                                                                                               |
| `npm run test`, `lint`, `build` pass                                                                        | Existing `AgentSession.test.ts` and the UI tests run against the rewritten store and are the behavior-preservation net. New: each store method emits exactly one op or none, and replaying the emitted ops from an empty transcript reproduces `getMessages()`.                                                                                                                                                                                   |
| `selectChatRuntime` equals the live session's getters                                                       | `selectors.test.ts` compares both after each script step, which de-risks #611.                                                                                                                                                                                                                                                                                                                                                                    |

### 8.2 Recorded sessions as fixtures

Fixtures are `SessionScript` JSON files (`session/host/sessionScript.ts`) under
`src/agentMode/session/host/__fixtures__/`, recorded from real Claude, Codex and opencode sessions.
A script is an ordered list of steps: user send, backend `SessionUpdate`, permission request and
answer, question and answer, cancel, and the prompt's stop reason. `scriptRunner.ts` plays a script
into a real `AgentSession` through a scripted `BackendProcess`, and sends, answers and cancels
through the host's commands.

Capture uses the existing frame log, not new production code:

1. Turn on Settings, Advanced, Log Full Agent Mode Frames in a test vault and run one scenario per
   session: a streamed answer with a thought, a tool call with a permission prompt, an ask-user
   question, a plan proposal (plan mode) where the backend supports it, a cancel mid-stream, and a
   long tool output.
2. `node scripts/agent-fixtures/frames-to-script.js <acp-frames.ndjson> <claude|codex|opencode>
--list` prints one line per recorded prompt; `--segment <n> --name <name> --out <file>` writes one
   script. Codex and opencode notifications go through `acpNotificationToEvents` and permission
   requests through `acpPermissionRequestToPrompt`; Claude SDK messages go through
   `translateSdkMessage` and tool and question prompts through `PermissionBridge`.
3. The converter sanitizes before writing: every string becomes deterministic pseudo-text of the
   same length (so chunk sizes survive), except enum-shaped values under structural keys
   (`sessionUpdate`, `type`, `kind`, `status`, `stopReason` and similar) outside tool input and
   answers; ids become `id-<n>`, `_meta` and backend state updates (which carry model ids) are
   dropped. It refuses logs with overlapping prompts, an error as the prompt's final frame, or a
   cancelled permission outcome, none of which a script can represent. `fixtures.test.ts` scans
   every committed fixture for home and vault paths, keys, email addresses and model ids, because
   the repository is public.

`SessionHost.parity.test.ts` plays every fixture and, after every step, asserts that the replica
equals the host projection and that `selectChatRuntime` equals the live session's getters.
A second client that subscribes halfway through each script must finish equal to the first.

### 8.3 Streaming overhead

`host.bench.test.ts` is skipped unless `BENCH=1`. It replays every recorded event of all fixtures
repeated into one long turn and compares three modes: no host, a host with `serialize: false`, and
a host with `serialize: true` (the WebSocket proxy). The PR reports added microseconds per streamed
chunk (p50, p99) and the total added CPU for the turn. Targets to report against: median added cost
under 50 microseconds per chunk and p99 under 1 ms. If the in-process replica misses them, the
fallback is to let the desktop client read the host store's state directly instead of a second
replica; that decision needs the measurement.

## 9. Scope of #609 and what is deferred

### 9.1 Ships in #609

`protocol/` complete (state, ops, reducers, frames, commands, client, selectors, hooks), the
in-process transport, `SessionHost` (scopes, op log, projectors, the commands in section 3),
the `AgentMessageStore` rewrite onto the shared reducer, `getTabSessions()`, the lint fence and
bundle-closure check, fixtures, benchmark, and tests. The host runs on desktop at startup; no UI
reads from it.

Delivered as stacked PRs: (1) `protocol/`, the store rewrite and the boundary fence; (2) the host,
projectors, op log, transport and commands; (3) recorded fixtures, parity tests and the benchmark.

### 9.2 Deferred

| Lane | Deferred work                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #613 | Delivered, see sections 5.2.1 and 9.5. Not done: outbound backpressure (the listener exposes no buffered-byte count) and command `origin`, which nothing reads because no command changes a default. |
| #610 | Pairing and tokens, see [`REMOTE_PAIRING.md`](./REMOTE_PAIRING.md).                                                                                                                                  |
| #607 | Persisting or replaying the op log across restarts.                                                                                                                                                  |

### 9.2.1 What the client UI needs from its environment

The message pane (message list, activity trail, and the permission, question and plan cards), the
composer, the pickers and the tab strip read only the client replica and the client's
`ClientView`, and send commands. Everything else reaches them through `AgentPaneCapabilities`
(`ui/AgentPaneContext.tsx`); a capability the environment omits hides the control that would call
it. Web-tab context, history, projects, the home screen, install and sign-in flows and settings
are desktop-only: their components are not mounted by a client that lacks the desktop.

| Capability         | Used by                                  | Desktop implementation                             |
| ------------------ | ---------------------------------------- | -------------------------------------------------- |
| `vaultBase`        | tool summaries shorten absolute paths    | the vault folder on disk (the host's, on a phone)  |
| `openPath`         | a completed tool call's target link      | open the note, or the file with the system default |
| `insertAtCursor`   | the insert action on a finished response | write into the active editor                       |
| `openPlanPreview`  | the plan card's Open control             | a workspace leaf that reads the same client        |
| `closePlanPreview` | after a plan is approved                 | detach that leaf                                   |
| `backendIcon`      | tab icons and the `@` agent menu         | the icon the backend registry holds for the agent  |
| `persistDefaults`  | remembering a picked agent or mode       | `manager.setDefaultBackend`, `persistDefaultMode`  |

The composer sends and cancels through `useSessionCommands` (`ui/hooks/useSessionCommands.ts`),
which turns a composed message into a `send` command and reports when the turn it started has
ended. It reads whether a turn is running, starting or waiting for a plan decision from the
replica, the agents it can mention from `backends`, and its model and mode pickers from
`useAgentModelPicker` and `useAgentModePicker`. The tab strip acts through `useTabCommands`.
Custom commands, `@` mentions of notes (sent as vault paths) and agents, images and the queue of
follow-ups are composer features that need only the vault the client runs beside and its own
draft store. A client chooses whether to keep every attached tab's session watched
(`watchAttachedTabs`, which the desktop does) or only the session it shows.

### 9.3 Cut as speculative

Op-log persistence; per-connection project filtering; binary or compressed frames; protocol
version negotiation (equal versions only); optimistic client updates; multiple hosts per client;
chunked snapshots; command idempotency keys; a middleware pipeline for commands; op coalescing
until the benchmark shows it is needed; ops for message deletion; a client-side default-selection
mirror; error text in host state; a JavaScriptCore engine runner and a separate type-closure
program for `protocol/`.

### 9.4 Rules for concurrent lanes

- All transcript mutation goes through `AgentMessageStore` methods. A new mutation (for example an
  interrupted-turn marker from #607) adds an op and reducer case in the same change.
- New state a client needs goes into `HostState` or `SessionState` with an op or slice key; it is
  never read from `AgentSessionManager` by client code.
- `AgentSessionManager` startup and shutdown are untouched by #609. The host observes the manager
  through `subscribe`, `getSessions`, `getTabSessions` and session listeners, so sessions restored
  at startup appear as ordinary `tab.add` ops.

### 9.5 The phone client

`src/agentMode/mobile/` is the phone's agent entry. `main.ts` loads it behind `!isDesktopRuntime()` and
registers `RemoteAgentView` for the agent view type; the ribbon icon and the "Open Copilot Agent Chat"
command open it once the open vault has a paired desktop. Its module closure holds the protocol layer,
the shared UI (message pane, composer, pickers, tab strip) and a few leaf modules; it never reaches
`acp/`, `sdk/`, `backends/`, `skills/`, the session manager or the host, and adds no Node or electron
import beyond what the legacy phone chat already loads. `scripts/mobile-load-smoke.cjs` bundles the entry
and fails on any of those, or on a dynamic import of a desktop-only module that is not gated by
`isDesktopRuntime()`, then evaluates the bundle with Node built-ins and electron poisoned.

- `RemoteAgentApp` picks the paired desktop (asking only when several are paired), and `RemoteSession`
  shows either a full-screen state (`connecting`, `syncing`, `offline`, `unreachable`, `denied`,
  version mismatch with both versions) or the chat. Once the phone holds a replica, a lost connection
  shows a banner over it instead. `deriveRemoteStatus` maps the transport's link state and the client's
  connection state onto that choice.
- `createRemoteSessionRuntime` builds one client for one desktop: transport, `SessionClient`, a
  `ClientView` attached to it, and a draft store keyed by the tab set. It never calls
  `watchAttachedTabs`; the tab pane watches the session it shows. It sends `focus` null while the app
  is in the background.
- `createPhonePaneCapabilities` supplies `backendIcon`, `backendName`, `multiAgentAllowed` and
  `imageBytesBudget` and omits `persistDefaults`, `openPath`, `openPlanPreview` and `insertAtCursor`, so a
  pick on the phone never changes a desktop default and the plan card has no Open control.
- Notes travel as paths from the phone's own vault. A path the desktop cannot resolve is reported in the
  `send` result's `droppedNotePaths` and shown to the user. Images are limited to
  `REMOTE_IMAGE_BYTES_PER_COMMAND` (5 MiB decoded) because a command is one frame and the listener
  refuses frames over 16 MiB.
- Access is Copilot Plus, checked on the desktop only: the listener does not authenticate a phone
  while the desktop's Plus check fails.
- Events (`remote_pair_completed`, `remote_pair_failed`, `remote_session_opened`, `remote_command`)
  carry only a name from a fixed set (`remote/remoteEvents.ts`). The repository has no client event
  pipeline, so the default sink writes them to the log.
