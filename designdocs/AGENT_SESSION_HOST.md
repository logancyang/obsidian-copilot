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
  (decisions)   │ store API      ┌────────────┐   frames             │ SessionClient           │
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
- **State changes only through operations.** `apply(state, op)` is a pure function shared by the
  host and every client. Ids, timestamps and clock readings are chosen by the host and carried in
  the operation. Replaying the same operations from the same snapshot always yields identical state.
- **Commands are intents.** A command's effects reach clients only as operations. There is no
  optimistic client state.
- **Session decisions stay in `AgentSession`.** Dropping cancelled-turn output, placeholder gating
  and multi-agent merging run before the store API is called; the reducer never contains them.
- **Reconnecting is the normal path.** iOS drops the socket about 1.3 s after every app switch
  ([spike result](https://github.com/Brevilabs/obsidian-copilot-private/issues/605#issuecomment-5886357388)),
  so resume from a sequence number is the common case and a fresh snapshot is the fallback.

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
  tabs: readonly TabSummary[]; // shared tab set, display order
  backends: Readonly<Record<BackendId, BackendCatalogEntry>>; // picker catalog + readiness
  host: {
    defaultBackendId: BackendId | null;
    startingBackendId: BackendId | null; // a create is in flight
    startFailed: boolean; // boolean only; error text stays on the desktop
  };
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

export interface BackendCatalogEntry {
  id: BackendId;
  displayName: string;
  needsSelfHostWarning: boolean;
  readiness: "ready" | "checking" | "absent" | "incompatible" | "error";
  preload: "pending" | "ready" | "error" | "absent";
  models: readonly PickerModel[]; // display fields only, see section 6.1
}

export interface PickerModel {
  baseModelId: string;
  displayName: string;
  subtitle?: string;
  provider?: string;
  capabilities?: readonly string[];
  isFree?: boolean;
  disabledReason?: string; // "Add API key", "Not offered by agent", ...
  needsSelfHostWarning?: boolean;
  needsLicense?: boolean; // locked Copilot preview row
  effortOptions: readonly EffortOption[]; // reported options, else catalog options, sorted
}
```

`tabs` holds every attached (not detached-from-tab) session across project scopes. Each tab carries
its `projectId`; a client filters by the project scope it is showing. The phone shows
`GLOBAL_SCOPE` only. Detached sessions keep running on the host and are not in `tabs`.

`AgentSessionManager.getSessionsForScope`, `getIsStarting`, `getStartingBackendId`, `getLastError`,
`getCachedModelCatalog`, `getEffortCatalog`, `getPreloadStatus`, `getDefaultSelection` and
`getActiveProjectId` are the sources.

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

Never sent to the host, never replicated: active tab id, active project scope, composer drafts and
send queue (`AgentInputDraftStore`, keyed by `chatInputId`), scroll position, expanded trail groups,
in-progress tab rename, selected text contexts, web-tab context, `loading`.

`AgentSessionManager.activeSessionId` and `activeProjectId` remain for the legacy desktop UI until
#612. The host never reads them.

### 1.4 Where each field comes from

| Field                | Source on the host                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `transcript`         | `AgentMessageStore` (store API emits ops)                                                            |
| `backendState`       | `AgentSession.getState()` via `onModelChanged`                                                       |
| `pending`            | `getPendingToolPermissions()`, `getPendingAskUserQuestions()`, `hasPendingPlanPermission()`          |
| `plan`, `todos`      | `getCurrentPlan()` via `onCurrentPlanChanged`, `getCurrentTodoList()` via `onCurrentTodoListChanged` |
| `usage`, `planUsage` | `getSessionUsage()`, `getPlanUsage()` via `onMessagesChanged`                                        |
| tab fields           | `AgentSession` getters via `onStatusChanged`, `onLabelChanged`, `onNeedsAttentionChanged`            |
| tab set and order    | `AgentSessionManager.subscribe()` plus new `getTabSessions()` (section 7.3)                          |
| `backends`, `host`   | manager preload/cache subscriptions, `descriptor.subscribeInstallState`, settings subscription       |

Non-transcript slices are projected by reference diff: `AgentSession` replaces `currentState`,
`currentPlan`, `currentUsage`, `currentPlanUsage` and `currentTodoList` rather than mutating them, so
a `SessionProjector` compares each getter's result with the last projected value on every listener
callback and emits a `slice` op only when the reference changed. `pending` compares the ordered
request objects. No `AgentSession` code changes for these slices.

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
  | { t: "msg.setFanout"; id: string; turn: FanoutTurn }
  | { t: "msg.appendText"; id: string; text: string; atMs: number }
  | { t: "msg.appendThought"; id: string; text: string; atMs: number }
  | { t: "msg.upsertPart"; id: string; part: AgentMessagePart; atMs: number }
  | { t: "msg.markError"; id: string; errorText: string; durationMs?: number; atMs: number }
  | { t: "transcript.set"; messages: MessageOf<C>[] }; // replaced whole

export function applyTranscriptOp<C>(
  messages: readonly MessageOf<C>[],
  op: TranscriptOp<C>
): readonly MessageOf<C>[]; // returns the same reference when the op changes nothing
```

`atMs` is the clock reading the store used for `finishTrailingThought` and thought spans. The
reducer never reads a clock, a random source or `formatDateTime`.

Every `AgentMessageStore` mutation and its production call sites:

| Store method (`AgentMessageStore.ts`)     | Op                   | Call sites                                                                                                                                                                       |
| ----------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addMessage`                              | `msg.add`            | `AgentSession.ts:566` (user message), `:576` (assistant placeholder)                                                                                                             |
| `markTurnComplete`                        | `msg.turnComplete`   | `AgentSession.ts:722`, `:769`, `:821`                                                                                                                                            |
| `extendTurnDuration`                      | `msg.extendDuration` | `AgentSession.ts:1274`                                                                                                                                                           |
| `setFanout`                               | `msg.setFanout`      | `AgentSession.ts:790`, `:795`                                                                                                                                                    |
| `appendAgentText`                         | `msg.appendText`     | `AgentSession.ts:809` (fanout composite), `:1270`                                                                                                                                |
| `appendAgentThought`                      | `msg.appendThought`  | `AgentSession.ts:1271`                                                                                                                                                           |
| `upsertAgentPart`                         | `msg.upsertPart`     | `AgentSession.ts:1159`, `:1297`, `:1302`, `:1321`, `:1327`                                                                                                                       |
| `markMessageError`                        | `msg.markError`      | `AgentSession.ts:718`, `:742`, `:765`                                                                                                                                            |
| `loadMessages` (and its internal `clear`) | `transcript.set`     | `AgentSession.loadDisplayMessages` (`:488`); callers `AgentSessionManager.ts:2015`, `:2106`, `:2253`, `:2746`; fanout composites are parsed on the host before the op is emitted |

Not in the vocabulary, because nothing in Agent Mode calls them: `deleteMessage`, `clear`,
`truncateAfterMessageId`, `appendDisplayText`. `AgentChatUIState.deleteMessage`/`clearMessages`
and the matching `AgentChatBackend` members have no agent-UI caller (`Chat.tsx` and `main.ts` call
the non-agent `ChatUIState`). #609 deletes them.

Clock and id sources removed from the transcript path: `AgentMessageStore.ts:171` (`generateId`),
`:184`, `:290`, `:293` (`Date.now()`), `:202` (`formatDateTime(new Date())`). They move into the
store's injected `{ now, newId }`, and the resulting values travel in the op.

### 2.2 Session-slice op

Slices that change rarely and are small are replaced whole:

```ts
export type SliceKey = "backendState" | "pending" | "plan" | "todos" | "usage" | "planUsage";
export type SliceOp = {
  [K in SliceKey]: { t: "slice"; key: K; value: SessionState[K] };
}[SliceKey];

export type SessionOp = TranscriptOp<WireMessageContext> | SliceOp;
```

Sources (all in `AgentSession.ts`): `backendState` at `:306`, `:343`, `:371`, `:385`, `:397`,
`:1236`; `pending` at `handlePlanProposalPermission :899`, `resolvePlanProposalPermission :916`,
`handleToolPermission :1085`, `resolveToolPermission :1094`, `handleAskUserQuestion :1108`,
`resolveAskUserQuestion :1125`, `flushResolvers :1167`, `flushQuestionResolvers :1177`; `plan` at
`finalizePlanDecision :1010`, `setCurrentPlan :1035`, `clearCurrentPlanIfModeLeft :1066`; `todos`
at `applyCurrentTodoList :1461`; `usage` at `:948`, `:980`, `:992`, `:1006`; `planUsage` at `:1252`.
The projector derives each slice op from these; the call sites do not change.

### 2.3 Host-scope ops

```ts
export type HostOp =
  | { t: "tab.add"; index: number; tab: TabSummary }
  | { t: "tab.remove"; id: SessionId }
  | {
      t: "tab.patch";
      id: SessionId;
      patch: Partial<
        Pick<
          TabSummary,
          | "status"
          | "label"
          | "labelSource"
          | "needsAttention"
          | "canSwitchModel"
          | "canSwitchEffort"
          | "canSwitchMode"
        >
      >;
    }
  | { t: "backend.set"; entry: BackendCatalogEntry } // one backend's catalog, replaced whole
  | { t: "host.set"; host: HostState["host"] };
```

`tab.add` covers create, replace-in-place (`index` is the old tab's position; `tab.remove` for the
old id follows) and re-attach after a detach. Immutable fields (`backendId`, `projectId`,
`chatInputId`) are set only by `tab.add`.

### 2.4 Reducer rules

- Pure and total: unknown ids are ignored, and an op that changes nothing returns the input
  reference.
- Structural sharing: only touched objects are re-created, so `React.memo` and selectors keep
  working. This replaces the store's `version`/`displayCache` bookkeeping.
- No `Date`, `performance`, `Math.random`, `crypto`, `formatDateTime`, logger, or `obsidian` value
  import (enforced in section 7.4).
- The host store applies each op through the same reducer before emitting it, and emits only when
  the reducer returned a new reference. That keeps the store's boolean-returning methods
  (`upsertAgentPart` no-op detection via `partsEqual`) unchanged and guarantees host and replicas
  cannot disagree about whether an op did anything.

## 3. Commands

A command is `{ name, ...args }`. The host validates, runs it through existing manager/session code,
and answers with a `CommandResult`. Effects arrive as ops (the "Ops" column is what a client
should expect, not something the handler constructs).

```ts
export type CommandResult<V = void> =
  { ok: true; value: V } | { ok: false; code: CommandErrorCode; message: string };

export type CommandErrorCode =
  | "unknown_session"
  | "session_starting"
  | "session_busy"
  | "session_closed"
  | "stale" // prompt/plan already resolved, first device to answer wins
  | "invalid"
  | "unsupported"
  | "too_large"
  | "failed";
```

Commands never touch `activeSessionId` and carry an explicit `sessionId`. `manager.applySelection`
and `manager.applyMode` infer "the active session" today; #609 splits each into a session-addressed
form (`applySelectionTo(session, ...)`, `applyModeTo(session, ...)`) and keeps the existing method as
a one-line wrapper over the active session, so the legacy UI is untouched.

| Command                                                                                                                            | Replaces                                                                                               | Validation                                                                                                                                                                                                                                                                                                                                               | Host call                                                                                                                                                                                                                                      | Ops                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `send { sessionId, text, context?: SendContext, images?: ImageBlock[], mentionedAgents? }` → `{ userMessageId, droppedNotePaths }` | `AgentChatInput.tsx:249` (`backend.sendMessage`)                                                       | session exists; status is `idle` or `error` (`session_starting`, `session_busy`, `session_closed` otherwise); `text.trim()` or an image present; note paths resolved with `vault.getFileByPath`, unresolved paths dropped and reported; `mentionedAgents` all known backend ids; image mime in `image/{png,jpeg,gif,webp}` and size limits (section 6.3) | `getChatUIState(id).sendMessage(text, context, promptContent, mentionedAgents)`; resolves when the turn starts, not when it ends                                                                                                               | `msg.add` x2, `tab.patch{status}`, then the turn stream                                                              |
| `cancel { sessionId }`                                                                                                             | `AgentChatInput.tsx:239`                                                                               | session exists; idempotent when nothing runs                                                                                                                                                                                                                                                                                                             | `getChatUIState(id).cancel()`                                                                                                                                                                                                                  | `slice pending`, `msg.turnComplete`, `tab.patch{status}`                                                             |
| `resolvePermission { sessionId, toolCallId, optionId }`                                                                            | `AgentChatMessages.tsx:248`                                                                            | `toolCallId` in `pending.permissions` else `stale`; `optionId` among its options else `invalid`                                                                                                                                                                                                                                                          | `getChatUIState(id).resolveToolPermission`                                                                                                                                                                                                     | `slice pending`, `tab.patch{status}`, tool-call parts from the resumed turn                                          |
| `answerQuestion { sessionId, requestId, answers }`                                                                                 | `AgentChatMessages.tsx:242`                                                                            | `requestId` pending else `stale`; answer keys are a subset of the request's `answerKey ?? question`; values are strings                                                                                                                                                                                                                                  | `getChatUIState(id).resolveAskUserQuestion`                                                                                                                                                                                                    | `slice pending`, `msg.upsertPart` (recorded answer), `tab.patch{status}`                                             |
| `resolvePlan { sessionId, proposalId, decision, feedbackText? }`                                                                   | `PlanProposalCard.tsx:52`, `PlanPreviewView.tsx:135`                                                   | `plan.id === proposalId`, `decision === "pending"`, plan-gated permission pending, else `stale`; `feedbackText` present only for `decision === "feedback"`                                                                                                                                                                                               | `getChatUIState(id).resolvePlanProposal` (keeps the next-turn feedback delivery and its `currentTurn` wait)                                                                                                                                    | `slice plan`, `slice pending`, `msg.upsertPart`, `tab.patch{status}`; for `next_turn` delivery a later `send` stream |
| `createSession { backendId?, projectId?, seedSelection? }` → `{ sessionId }`                                                       | `AgentTabStrip.tsx:145`; picker path `agentModelPickerHelpers.ts:356`                                  | backend id known and `readiness === "ready"` (`unsupported` otherwise); `projectId` defaults to `GLOBAL_SCOPE` and must exist                                                                                                                                                                                                                            | `manager.createSession(backendId, projectId, seedSelection)`                                                                                                                                                                                   | `host.set{startingBackendId}`, `tab.add`, `tab.patch{status}`                                                        |
| `replaceSession { sessionId, backendId?, preserveChatInput?, seedSelection? }` → `{ sessionId }`                                   | `AgentHome.tsx:139`, `:307`; `agentModelPickerHelpers.ts:351`                                          | session exists; backend id known                                                                                                                                                                                                                                                                                                                         | `manager.replaceSessionInPlace`                                                                                                                                                                                                                | `tab.add` (old index), `tab.remove` (old id)                                                                         |
| `openTab { sessionId }`                                                                                                            | `AgentTabStrip.tsx:171`, `:186` (`setActiveSession`, minus the active-tab write)                       | session exists and not `closed`                                                                                                                                                                                                                                                                                                                          | new `manager.openTab(id)`: un-detach and `clearNeedsAttention`; the client sets its own active tab                                                                                                                                             | `tab.add` if it was detached, `tab.patch{needsAttention:false}`                                                      |
| `closeTab { sessionId }`                                                                                                           | `AgentTabStrip.tsx:152` (`detachSessionFromTab`)                                                       | session exists                                                                                                                                                                                                                                                                                                                                           | `manager.detachSessionFromTab` (the agent keeps running)                                                                                                                                                                                       | `tab.remove`                                                                                                         |
| `renameSession { sessionId, label }`                                                                                               | `AgentTabStrip.tsx:175`                                                                                | `label` is `null` or a string of at most 200 characters after trim                                                                                                                                                                                                                                                                                       | `manager.renameSession`                                                                                                                                                                                                                        | `tab.patch{label, labelSource}`                                                                                      |
| `applySelection { sessionId \| null, backendId, baseModelId?, effort? }` → `{ sessionId }`                                         | `agentModelPickerHelpers.ts:331` (effort), `:351`/`:356`/`:358` (cross-backend), `:403`/`:408`, `:478` | the model exists in the backend's catalog and has no `disabledReason` (`invalid` or `unsupported`); same-backend switches require `canSwitchModel !== false` / `canSwitchEffort !== false`; at least one of `baseModelId`, `effort` present                                                                                                              | if `sessionId` is null or its backend differs: cross-backend replace/create with the persisted default effort when `effort` is omitted, then `setDefaultBackend`; otherwise `manager.applySelectionTo(session, ...)` and `repairDefaultEffort` | `slice backendState`, `tab.patch`, and for cross-backend the `replaceSession`/`createSession` ops                    |
| `applyMode { sessionId, mode }`                                                                                                    | `agentModePickerHelpers.ts:40`                                                                         | session's `backendState.mode.apply[mode]` exists; `canSwitchMode !== false`                                                                                                                                                                                                                                                                              | `manager.applyModeTo(session, mode)` using the session's own spec                                                                                                                                                                              | `slice backendState`, `slice plan` (plan cleared when leaving plan mode)                                             |

Session decisions stay where they are. For example a `send` during a cancelled turn's drain is
still queued by `AgentSession.runTurn`; a `send` that races a permission answer from another
device sees `session_busy`; two devices answering the same permission produce one `ok` and one
`stale`.

Not commands (desktop-only surfaces that keep calling the manager directly): history, projects
(`enterProject`, `exitProject`, `rematerializeContext`), `saveActiveSession`, `closeChatSession`,
install/sign-in/held-config flows (`AgentModeStatus`, `AgentSelectPanel`, `useAgentSelect`),
`getOrCreateActiveSession` auto-start (`AgentModeChat.tsx:53`), and `main.ts:982`.

## 4. Frame protocol

One JSON object per frame; `type` discriminates.

```ts
export const PROTOCOL_VERSION = 1;

export type ClientFrame =
  | { type: "hello"; v: number; app: string } // app = plugin version, for error text only
  | { type: "subscribe"; scope: Scope; fromSeq?: number }
  | { type: "unsubscribe"; scope: Scope }
  | { type: "command"; id: string; command: Command };

export type ServerFrame =
  | { type: "hello"; v: number; app: string; hostId: string; ok: boolean }
  | { type: "snapshot"; scope: Scope; seq: number; state: HostState | SessionState | null }
  | { type: "ops"; scope: Scope; from: number; ops: readonly (HostOp | SessionOp)[] }
  | { type: "result"; id: string; result: CommandResult<unknown> };
```

**Sequencing.** Each scope has its own counter. A scope starts at `seq 0` (empty log) and every op
increments it. `ops.from` is the sequence number of the first op in the frame; the frame covers
`from .. from + ops.length - 1`. `hostId` is a random id created when the host starts.

**Handshake.** The client sends `hello`. The host answers `hello` with `ok: false` and closes when
`v` differs from its `PROTOCOL_VERSION`. Versions must be equal; there is no negotiation. A client
that receives `ok: false` enters connection state `version_mismatch` and shows "update Copilot on
both devices" with both `app` strings. An `ok: true` reply carries `hostId`; the client discards
every stored cursor when `hostId` differs from the one it last saw.

**Subscribe.**

1. The host flushes its pending op buffer, so the log head reflects every applied op.
2. If `fromSeq` is a number the log still covers (`oldest - 1 <= fromSeq <= head`), the host replies
   `ops` with `from = fromSeq + 1` and everything after it; the array is empty when the client is
   current. Otherwise it replies `snapshot` at `seq = head`.
3. The connection is then subscribed: later frames for the scope go out on each flush.
4. Unknown scope, or a session that later disposes, yields `snapshot` with `state: null`.

**Client apply rule** per scope, with cursor `c`:

| Incoming `ops.from` | Action                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `c + 1`             | apply all, `c += ops.length`                                                                                             |
| `<= c`              | apply only the suffix beyond `c` (overlap after a resume)                                                                |
| `> c + 1`           | gap: drop the frame, send `subscribe(scope)` without `fromSeq`, ignore `ops` for that scope until the `snapshot` arrives |

`snapshot` replaces the scope state and sets `c = seq`.

**Reconnect (normal path).** On every open the client sends `hello`, then `subscribe(scope,
cursor)` for each wanted scope. A reconnect within the log window costs one small `ops` frame per
scope; an evicted cursor or a new `hostId` costs a snapshot. In-flight commands are rejected with
`code: "failed"` and message `disconnected`; a command is never re-sent automatically because
`send` is not idempotent. The transport layer (#613) owns backoff, the connect timeout and the
visibility-change reconnect; the client core only reports `connecting | live | reconnecting |
offline | version_mismatch`.

**Ordering.** Within a connection, frames for one scope arrive in sequence order. A command's ops
that were emitted synchronously reach the client before its `result`. Ordering across scopes is not
defined.

**Op buffer and log.** The host appends an op to the scope log when it is emitted and sends buffered
ops in one `ops` frame on flush. Streaming ops (`msg.appendText`, `msg.appendThought`,
`msg.upsertPart`, `msg.setFanout`, `msg.extendDuration`) flush on a 16 ms `setTimeout`;
every other op flushes synchronously and carries earlier buffered ops with it, preserving order.
This matches today's split between `scheduleNotifyMessages` and `notifyMessages`. The flush uses
`setTimeout`, not `requestAnimationFrame`, because rAF stops in a hidden Obsidian window and the
phone would stall. The log is an in-memory ring per scope, bounded by op count (2000) and a byte
budget (8 MiB by `JSON.stringify` length at append); it is never persisted (#607 owns persistence).

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

The host side is `SessionHost.connect(send: (f: ServerFrame) => void): HostConnection` with
`connection.receive(frame)` and `connection.close()`. A transport is a pair of pumps between the
two; it adds no protocol logic.

### 5.2 In-process transport, behaviourally identical to a serializing one

`createInProcessTransport(host, { isolate })` differs from a socket only in what happens to a frame
between `send` and delivery:

| `isolate`        | Used in                                                                          | Effect                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"json"`         | protocol conformance tests                                                       | `JSON.parse(JSON.stringify(frame))`: exactly what the WebSocket does, including dropped `undefined`                                                                                                    |
| `"clone-freeze"` | development builds and all other tests (`process.env.NODE_ENV !== "production"`) | `structuredClone` then deep freeze: throws on functions, `TFile`, `AbortSignal`, and any mutation of a delivered frame; a host that mutates an object after emitting it shows up as replica divergence |
| `"none"`         | production desktop                                                               | frames pass by reference                                                                                                                                                                               |

All three deliver asynchronously (`queueMicrotask`), so a client callback never runs inside a host
emit and the timing model matches a network. The reducer is immutable, which is what makes `"none"`
safe. Whether production should also clone is decided by the benchmark in section 8.

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
  command<N extends Command["name"]>(
    command: Extract<Command, { name: N }>
  ): Promise<CommandResult<CommandValue<N>>>;
}
```

The client owns cursors, the gap rule, ref-counted scope subscriptions and pending-command
bookkeeping. It performs no I/O and reads no clock, so it runs unchanged under Node, jsdom and
JavaScriptCore. Diagnostics go through the injected callback, never `@/logger`.

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
`selectors.ts` provides the memoized ones (`selectVisibleMessages`, `selectChatRuntime`).
`selectChatRuntime(host, session)` returns the same shape as today's `AgentChatRuntimeState`
(`messages`, `isStarting`, `isTurnInFlight`, `hasPendingPlanPermission`, `currentPlan`,
`currentTodoList`, `pendingToolPermissions`, `pendingAskUserQuestions`) so #611 swaps
`useAgentChatRuntimeState` mechanically.

## 6. Data boundaries

### 6.1 Credentials never enter the picker catalog

The only code that produces `PickerModel` is `toPickerModel(entry)` in `session/pickerCatalog.ts`. It
copies named fields one by one; it never spreads its input. `PickerModel` has no index signature,
so an added field is a compile error at the object literal. The catalog builder starts from
`descriptor.getEnabledModelEntries(settings)` (`EnabledModelEntry` already carries only
`credentialState`) and the locked-Copilot preview entry, and reduces `credentialState` to
`disabledReason`. `CustomModel` fields `apiKey`, `baseUrl`, `openAIOrgId` and every other
non-display field are unreachable from the wire type. Backend environment overrides
(`agentMode.backends.<id>.env`) and provider settings are not part of host state at all.

`host.startFailed` is a boolean rather than the manager's `lastError` text, which can echo spawn
arguments or stderr.

Test: build a catalog from settings whose models and providers contain a sentinel `apiKey`, then
assert the serialized snapshot of both scopes contains neither the sentinel nor any key from
`CREDENTIAL_FIELD_NAMES`.

Everything else in `SessionState` (tool inputs and outputs, note excerpts) is user content by
design and travels to authenticated clients only.

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

The host store emits `msg.add` and `transcript.set` with contexts projected to `NoteRef`. On `send`
the host resolves `notePaths` with `vault.getFileByPath(normalizePath(path))`; a path that does not
resolve is dropped and returned in `droppedNotePaths`, and a path outside the vault cannot resolve.
Components that render context need only `path` and `basename`, which both `TFile` and `NoteRef`
provide (#611 narrows their prop types).

### 6.3 Images travel inside the send command

`ImageBlock` is `{ mimeType: string; data: string /* base64 */ }`, the same shape as the existing
`PromptContent` image block. The host builds the user message `content` data URLs
(`buildUserDisplayContent`) exactly as today, so the image reaches every client through `msg.add`.
Limits live in `protocol/limits.ts` and are enforced by the host and mirrored client-side:
8 MiB per image decoded, 4 images and 24 MiB per command. Over-limit input returns `too_large`.

## 7. File layout and the mobile boundary

### 7.1 Layout

```
src/agentMode/protocol/          NEW. Environment-free. The only agent code the phone loads.
  domain.ts                      JSON data model moved out of session/types.ts (re-exported there), incl. MessageOf<C>
  state.ts                       HostState, SessionState, TabSummary, PickerModel, Wire* types
  ops.ts                         HostOp, SessionOp, TranscriptOp, SliceOp
  applyTranscript.ts             applyTranscriptOp
  apply.ts                       applyHostOp, applySessionOp
  commands.ts                    Command, CommandResult, error codes
  limits.ts                      image and frame limits
  frames.ts                      ClientFrame, ServerFrame, PROTOCOL_VERSION
  transport.ts                   ClientTransport
  SessionClient.ts               replica, cursors, command sender
  selectors.ts                   memoized derived selectors
  react.ts                       useHostSelector, useSessionSelector
  index.ts                       the mobile-safe surface

src/agentMode/session/host/      NEW. Desktop only. Depends on AgentSession and the manager.
  SessionHost.ts                 scopes, op log, subscriptions, frame handling
  OpLog.ts                       per-scope ring buffer
  SessionProjector.ts            listener/reference diff -> slice and tab ops
  TabProjector.ts                manager notify -> tab.add / remove / patch
  commandHandlers.ts             one function per command
  inProcessTransport.ts          createInProcessTransport

src/agentMode/session/pickerCatalog.ts   pure catalog builder moved out of ui/agentModelPickerHelpers.ts
```

Existing files change as follows.

- `session/AgentMessageStore.ts`: holds `readonly MessageOf<MessageContext>[]`, applies each
  mutation through `applyTranscriptOp`, and emits the op through an injected sink. Constructor takes
  `{ now, newId, emit }` (defaults: `Date.now`, the current id scheme, no-op). `version` and
  `displayCache` are deleted. `getDisplayMessages()` memoizes on the array reference. The four dead
  methods are deleted.
- `session/types.ts`, `types/message.ts`, `session/AgentSession.ts`, `session/plan.ts`,
  `session/planUsage.ts`, `session/fanout/fanoutTypes.ts`: re-export the moved types
  (`AgentSessionStatus`, `SessionUsage`, `PlanUsage`, `CurrentPlan`, `FanoutTurn`,
  `SelectedTextContext`, `WebTabContext`, `FormattedDateTime`, and the rest of `domain.ts`). No import
  in the rest of the codebase changes.
- `ui/agentModelPickerHelpers.ts`: imports `appendBackendSection`, `synthesizeAgentEntry`,
  `backendReadinessReason` and friends from `session/pickerCatalog.ts`; behavior unchanged.
- `session/AgentSessionManager.ts`: additions only. `getTabSessions()` (attached sessions in map
  order), `openTab(id)` (un-detach plus `clearNeedsAttention`), `applySelectionTo(session, ...)` and
  `applyModeTo(session, ...)` (the existing `applySelection`/`applyMode` delegate to them with the
  active session). The host subscribes to `descriptor.subscribeInstallState`, the model preloader
  and settings directly, so no catalog hook is added.
- `agentMode/index.ts`: constructs `SessionHost` beside the manager and disposes it before
  `manager.shutdown()`.

Boundary rules (`eslint.config.mjs`): add element `{ type: "protocol", pattern:
"src/agentMode/protocol" }` before the catch-all `host`; allow `session -> protocol`,
`ui -> protocol`, `barrel -> protocol`, `protocol -> protocol`. `session/host` is part of `session`.
Update `src/agentMode/AGENTS.md` with the new layer.

### 7.2 What the phone may load

`protocol/` is the whole mobile agent surface plus the UI that #613 adds. It must not reach
`session/` values, `acp/`, `sdk/`, `backends/`, Node built-ins, `electron`, `@/logger`,
`@/settings/model`, `@/utils`, or `obsidian` values. `AgentSessionManager` already throws on
`Platform.isMobile`; `src/main.ts` keeps loading `@/agentMode` only behind `isDesktopRuntime()`
and #613 adds a second, statically importable entry that resolves to `protocol/index.ts`.

### 7.3 `emulateMobile` is not evidence

Obsidian on iOS is a WebKit app with no Node. `app.emulateMobile(true)` flips `Platform.isMobile`
inside Electron's Chromium with `require` still working (`Platform.isDesktopApp` stays `true`), so
a Node-only import would load and run under it. It cannot show that the phone bundle loads, and
nothing in this design relies on it. The checks below stand in for it, and a real iPhone remains
the final gate for #613.

### 7.4 Enforcement

1. **Lint fence** for `src/agentMode/protocol/**`, modeled on the `src/components/ui` purity fence
   (`@typescript-eslint/no-restricted-imports`, `allowTypeImports: true`): value imports only from
   `@/agentMode/protocol/*` and relative paths; `no-restricted-imports` for `fs`, `path`, `os`,
   `crypto`, `child_process`, `electron`, `node:*`, `obsidian` (values). `no-restricted-properties`
   for `Date.now`, `performance.now`, `Math.random`, `crypto.*` and `structuredClone` in
   `apply*.ts`, `SessionClient.ts` and `selectors.ts`; `new Date` via `no-restricted-syntax`.
2. **Type closure**: `tsconfig.protocol.json` with `lib: ["ES2020", "DOM"]`, `types: []`, and
   `include: ["src/agentMode/protocol/**/*.ts"]`. Node globals (`Buffer`, `process`, `NodeJS.*`) and
   ES2021+ APIs (`replaceAll`, `Array.prototype.at`, `Object.hasOwn`, `findLast`) fail to compile.
   `npm run typecheck:protocol` also asserts `tsc --listFilesOnly` stays inside
   `src/agentMode/protocol/` and `node_modules`. This works because `domain.ts` moves the JSON
   types out of `session/types.ts`, which drags the whole plugin into any program that imports it.
3. **Bundle closure**: `scripts/mobile-load-smoke.cjs` gains `checkProtocolBundle()`. It runs
   `esbuild.buildSync` on `src/agentMode/protocol/index.ts` with `platform: "browser"`, `metafile`,
   and `external: ["react", "obsidian"]`; Node built-ins fail to resolve, and the check also
   fails when any input file is outside `src/agentMode/protocol/`. It then evaluates the bundle in a
   `vm` context with the existing poison modules for Node built-ins. The script's
   `checkAgentModeImportBoundaries` regex is extended to allow value imports of
   `@/agentMode/protocol` and nothing else under `@/agentMode`. CI already runs this script after
   `npm run build`.
4. **Engine check on WebKit's JavaScript engine**: `npm run test:core-jsc` (macOS only, not
   CI-gated) bundles `protocol/index.ts` plus a small runner with esbuild (`format: "iife"`,
   `target: "es2020"`) and runs it in the system `jsc` binary
   (`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`). The runner
   replays the golden op logs (section 8.2) through `SessionClient` over the `"json"` transport
   model and prints pass or fail. This is the same engine family the phone runs.
   Real-iPhone verification of load and streaming is part of #613's manual checklist.

## 8. Test plan

Follows `AGENTS.md`: one top-level `describe` per module, one nested `describe` per callable,
`it` names that state condition and outcome.

### 8.1 Success criteria mapping

| #609 criterion                                                                                              | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host state equals a replica after replaying the host's ops for recorded Claude, Codex and opencode sessions | `SessionHost.parity.test.ts`: for each session script, drive a real `AgentSession` and manager through a scripted `BackendProcess`, connect a client over the `"json"` transport, and after the script and after every 50th op assert `client.getSession(id)` deep-equals the host's projection of the live session and `client.getHost()` equals the host's projection of the manager. Also cut a snapshot mid-stream, continue, and assert the same end state. |
| Sequence gap triggers resnapshot                                                                            | `SessionClient.test.ts`: a lossy transport drops frame k; assert the client sends `subscribe` without `fromSeq`, ignores later ops for that scope, applies the snapshot, and ends equal to the host.                                                                                                                                                                                                                                                             |
| Reconnect from cursor is the normal path                                                                    | `SessionHost.test.ts` and `SessionClient.test.ts`: disconnect at seq n, reconnect, assert one `ops` frame from `n + 1` and no `snapshot`; evicted cursor and changed `hostId` each produce a `snapshot`; version mismatch yields `hello ok:false` and `version_mismatch`.                                                                                                                                                                                        |
| Each command produces its expected ops                                                                      | `commandHandlers.test.ts`, table-driven from section 3: for each command, valid input yields the listed ops in order; each validation branch yields its error code and no ops; two devices answering one permission yield one `ok` and one `stale`.                                                                                                                                                                                                              |
| Reducer never calls `Date.now()` or a random source                                                         | `applyTranscript.test.ts` and `apply.test.ts` replay every fixture with `Date.now`, `performance.now`, `Math.random` and `crypto.getRandomValues` replaced by throwing stubs; inputs are deep-frozen so in-place mutation throws. Static: the lint rule in section 7.4.                                                                                                                                                                                          |
| No credential in serialized picker entries (#612 criterion, seeded here)                                    | `pickerCatalog.test.ts`, section 6.1 sentinel test.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run test`, `lint`, `build` pass                                                                        | Existing `AgentMessageStore.test.ts` and `AgentSession.test.ts` run unchanged and are the behavior-preservation net for the store rewrite. New: each store method emits exactly one op or none, and replaying the emitted ops from an empty transcript reproduces `getDisplayMessages()`.                                                                                                                                                                        |
| `selectChatRuntime` equals today's `AgentChatUIState` getters                                               | `selectors.test.ts` compares both after each script step, which de-risks #611.                                                                                                                                                                                                                                                                                                                                                                                   |

### 8.2 Recorded sessions as fixtures

Fixtures are `SessionScript` JSON files under `src/agentMode/session/host/__fixtures__/`, one set
each for `claude`, `codex` and `opencode`. A script is an ordered list of steps: user send, backend
`SessionEvent`, permission request and answer, question and answer, `state_changed`, prompt result,
cancel. A scripted `BackendProcess` (extending the mock in `AgentSession.test.ts`) plays it under
fake timers.

Capture uses the existing frame log, not new production code:

1. Turn on Settings, Advanced, Log Full Agent Mode Frames in a test vault and run the capture
   scenario per backend: a streamed answer with a thought, a read and an edit tool call with a
   permission prompt, an ask-user question, a plan proposal (plan mode), a cancel mid-stream, and a
   long tool output.
2. `scripts/agent-fixtures/frames-to-script.ts`, bundled and run with esbuild, reads the NDJSON at
   `<tmp>/obsidian-copilot/acp-frames/<vault-hash>/acp-frames.ndjson`. Codex and opencode `←`
   notifications go through `acpNotificationToEvents`; Claude SDK messages go through
   `translateSdkMessage`; `→` prompts and permission replies become user and answer steps. Where a
   step is not in the frames (Claude `canUseTool` prompts), the script author writes it from the
   triggering SDK message. This follows the precedent of
   `sdk/__fixtures__/claude-notification-only-subagents.ndjson`.
3. The converter sanitizes before anything is written: text content is replaced by deterministic
   pseudo-text of the same length so chunk sizes survive; vault paths become `/vault/...`; home
   directories, emails and token-shaped strings are removed; model ids are replaced with generic
   names, since the preview repository is public and a Copilot Plus alias must not reveal its
   backing model. `fixtures.test.ts` scans every committed fixture for `/Users/`, `sk-`, `@`
   addresses and `copilot-plus`.
4. Golden op logs (`*.golden.json`: initial snapshot, op list, final state) are written by the host
   parity test with `UPDATE_GOLDEN=1` and consumed by the `jsc` runner. Each is trimmed to under
   300 KB.

### 8.3 Streaming overhead

`host.bench.test.ts` is skipped unless `BENCH=1`. It replays the long-turn fixture scaled to 50,000
text chunks, 1,000 thought chunks and 2,000 tool updates with 100 KB outputs, in four modes:
baseline (host absent), host with `"none"`, host with `"clone-freeze"`, host with `"json"` (the
WebSocket proxy). Reported in the PR: added microseconds per streamed chunk (p50, p99), total added
CPU for the turn, frames per second, mean and p99 bytes per frame, peak heap delta including the
op log, and client apply p99 at a 5,000-message transcript. Targets to report against: median added
cost under 50 microseconds per chunk, p99 under 1 ms, and a 100,000-chunk turn adding under 5 s of
CPU. If two reducer applications per op (host store plus in-process replica) miss the targets, the
fallback is to let the desktop client read the host store's state directly instead of a second
replica; that decision needs the measurement and is not made in advance.

## 9. Scope of #609 and what is deferred

### 9.1 Ships in #609

`protocol/` complete (state, ops, reducers, frames, commands, client, selectors, hooks), the
in-process transport with all three isolation modes, `SessionHost` (scopes, op log, projectors,
catalog builder, all commands in section 3), the `AgentMessageStore` rewrite onto the shared
reducer, the type moves, the three manager additions, the lint fence, `tsconfig.protocol.json`,
the bundle-closure and `jsc` checks, fixtures, benchmark, and tests. The host runs on desktop at
startup; no UI reads from it. A development-only parity monitor (behind `getSettings().debug`)
creates one in-process client and compares its replica with the host projection after each flush,
so dogfooding exercises the path the phone depends on.

Delivered as three stacked PRs to stay reviewable: (1) `protocol/` plus type moves, reducers,
client, transports, selectors and their tests, with no host; (2) store rewrite, `SessionHost`,
projectors, op log, fixtures and parity tests; (3) commands, catalog builder, benchmark, the
mobile-boundary checks, and the debug parity monitor.

### 9.2 Deferred

| Lane | Deferred work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #611 | Message pane on `selectChatRuntime`; delete `AgentChatUIState` and `AgentChatBackend`; `PlanPreviewView` on the client; narrow context-chip props to `NoteRef`; file-opening through an injected capability.                                                                                                                                                                                                                                                                                                                                       |
| #612 | Composer, pickers and tabs on the client; client-side derivation of picker entries from the catalog (hide other backends once a chat has history, keep-current-model row, preload placeholders, `valueKey`); active tab and project scope as client state; delete the `activeSessionId` writes in `createSession`, `closeSession`, `setActiveSession`; attention rule per focused client; catalog additions the composer needs (mentionable agents, multi-agent entitlement); readiness states beyond the enum above.                              |
| #613 | Must not ship before #612: `createSession` and `replaceSession` still write `activeSessionId` (legacy), so a phone-created session would move the desktop's visible tab until #612 deletes those writes. WebSocket transport, backoff, connect timeout, `visibilitychange` reconnect, backpressure, frame size limit; connection identity and authorization; command `origin` and the policy for whether phone-originated picks persist desktop defaults; mobile entry point and UI; version-mismatch screen; analytics; real-iPhone verification. |
| #610 | Pairing and tokens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| #607 | Persisting or replaying the op log across restarts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### 9.3 Cut as speculative

Op-log persistence; per-connection project filtering; binary or compressed frames; protocol
version negotiation (equal versions only); optimistic client updates; multiple hosts per client;
chunked snapshots; command idempotency keys; a middleware pipeline for commands; op coalescing
(`msg.setFanout` last-wins) until the benchmark shows it is needed; ops for `deleteMessage`,
`clear`, `truncateAfterMessageId`, `appendDisplayText`; a client-side default-selection mirror
(defaults are baked into the catalog and into command handling); error text in host state.

### 9.4 Rules for concurrent lanes

- All transcript mutation goes through `AgentMessageStore` methods. A new mutation (for example an
  interrupted-turn marker from #607) adds an op and reducer case in the same change.
- New state a client needs goes into `HostState` or `SessionState` with an op or slice key; it is
  never read from `AgentSessionManager` by client code.
- `AgentSessionManager` startup and shutdown are untouched by #609. The host observes the manager
  through `subscribe`, `getSessions`, `getTabSessions` and session listeners, so sessions restored
  at startup appear as ordinary `tab.add` ops.
