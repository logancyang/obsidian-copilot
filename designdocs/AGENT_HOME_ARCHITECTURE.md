# Agent Home Architecture (PR1)

How the Agent Mode chat surface is structured after the "Agent Home" PR1
(frontend-only) refactor. PR1 dismantled the monolithic `AgentChat` into a
persistent shell plus focused leaf components, added a centered landing homepage
for empty sessions, and introduced a landing with a **read-only Projects list**
and a **fully manageable Recent Chats list** (the latter reuses the existing
`ChatHistoryPopover`, so it gains search / rename / delete / open-source with no
new backend). No backend, persistence, or project-scope behavior changed in PR1.

## Scope: PR1 vs PR2

The full Agent Home vision (project workspaces, per-project sessions, context
indexing) is large and almost all the risk lives in the backend. So the work is
split on a single axis — **does it touch the backend?** PR1 is the pure-frontend
slice; PR2 is the project workspace plus all backend work.

| Capability                                                     | PR1                                              | PR2+                                                |
| -------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| AgentHome layout shell                                         | ✅ build (no-project state only)                 | + project state                                     |
| No-project landing (centered composer → pin to bottom)         | ✅                                               | —                                                   |
| Landing title + backend·mode subtitle                          | ✅                                               | —                                                   |
| Multi-session tabs (`AgentTabStrip`)                           | ✅ reuse, untouched                              | project-scoped                                      |
| Recent Chats section (global `getChatHistoryItems`)            | ✅ inline 3 + full `ChatHistoryPopover` View-all | per-project filter                                  |
| Dismantle AgentChat → transcript / input + hooks               | ✅                                               | —                                                   |
| Per-session drafts (replacing `key` remount)                   | ✅ queue survives switch, foreground flush       | background queue auto-flush (sink to session layer) |
| Projects section (read-only list + read-only sort)             | ✅ inline 3 + `+` → coming-soon                  | —                                                   |
| Read-only Project Picker (View-all + search + lazy paging)     | ✅                                               | —                                                   |
| Shared section primitives (`AgentHomeSection`/`Row`/`ViewAll`) | ✅ new                                           | project reuse                                       |
| Optimizations ported from existing components                  | ✅ (see below)                                   | —                                                   |
| Project click                                                  | ✅ **coming-soon `Notice` only**                 | real project entry                                  |
| Project workspace (header + per-project sessions + Context)    | ❌                                               | ✅                                                  |
| Sort-strategy switcher (writes `settings`)                     | ❌                                               | ✅                                                  |
| Create / rename / delete / duplicate / archive + `⋯` menu      | ❌                                               | ✅                                                  |
| Chat rename / delete / open-source (chat View-all popover)     | ✅ reuse `ChatHistoryPopover`                    | + project-scoped history                            |
| Chat time-group headers (Today / Yesterday / 1w ago)           | ✅ (via `ChatHistoryPopover`)                    | —                                                   |
| Mobile always-visible row actions (chat View-all)              | ✅ (via `ChatHistoryPopover`)                    | + project rows                                      |
| Drag-to-add context                                            | ❌                                               | ✅                                                  |
| Welcome onboarding card                                        | ❌                                               | ✅                                                  |
| `setCurrentProject` / `projectId` on sessions / usage touch    | ❌                                               | ✅                                                  |
| Project scope envelope / `scopeStatus` gate                    | ❌                                               | ✅                                                  |
| Switch project = switch history                                | ❌                                               | ✅                                                  |
| Indexing card / permission above composer                      | ❌                                               | ✅                                                  |
| Outputs generation / Discover URLs                             | ❌                                               | PR2+ / later                                        |

**Why project click is coming-soon in PR1, not a real entry:** a project's full
form is "project header + its own per-project sessions", which requires
`AgentSessionManager` to know each session's `projectId` — backend-only, hence
PR2. If PR1 forced a project page it would be a chimera: global multi-session
tabs on top, one project in the middle. So PR1 stops at the read-only list.

## Why dismantle AgentChat (approach A), not parallel-isolation (B)

The design handoff laid out two ways to land the same UI:

- **A — direct refactor:** dismantle the monolithic `AgentChat` into the shell +
  leaf components + hooks described below (what PR1 did).
- **B — parallel isolation:** build `AgentHome` alongside an untouched
  `AgentChat`, switch between them with a feature flag, and delete the old path
  in a later cleanup PR.

The handoff **recommended B** for the dense-iteration period, on the grounds
that A's defining cost is _high conflict — textual merge conflicts plus silent
semantic conflicts_ — whenever someone keeps changing `AgentChat` in parallel.

The executed direction was: ship Agent Home as a standalone, frontend-only PR
(home + chat history first, project workspace on top later), accepting that it
**touches** `AgentChat`. That was implemented as **A** (dismantle), not B. The
"why A over B" was never written down at decision time; this note records it
retroactively so the tradeoff is visible.

**A's predicted cost materialized — and is by design.** While PR1 was in flight
the base gained `#2530` (inline ask-user questions), `#2531` (copy/insert
message actions, which removed message-delete), and `#2533` (no-global-app:
`app.vault`→`app`) — all of which modified the now-deleted `AgentChat`. Rebasing
PR1 onto that base surfaced **one** textual conflict (the modify/delete on
`AgentChat.tsx`, resolved by `git rm`) but required **manually porting** those
three deltas into the split files (runtime hook / composer) — git does **not**
flag those, because the new files don't textually overlap the deleted one.

**Standing consequence:** with `AgentChat` gone there is no single merge point.
Any future base change to message-stream or composer behavior must be
re-threaded into the split files by hand. That is the inherent, accepted cost of
choosing A; B would have deferred it to the cleanup PR instead. The split is
otherwise behavior-equivalent to the old monolith (see "Migration invariants").
A later rebase onto a base carrying `#2537` / `#2540` / the new-logo commit
needed **zero** re-thread — those land entirely in layers orthogonal to `ui/`
(backends / skills / plugin wiring, no `ui/` edits), so it was textually clean
with `tsc` and the agentMode test suite green. The re-thread tax only comes due
when a base change actually touches message-stream or composer behavior.

## Component tree

```
CopilotAgentView
└── AgentModeChat                preload gate · auto-spawn · no-session fallback
    └── AgentHome                persistent shell for the active session
        └── ChatInputProvider
            ├── AgentTabStrip            multi-session tabs (unchanged)
            ├── AgentModeStatus          install / boot status pill
            ├── (landing header)*        landing title + backend·mode subtitle
            │       ⟷ AgentChatMessages      (conversation state — reused base leaf)
            ├── AgentChatInput           composer: controlled by a `draft` prop; send/queue/stop
            ├── AgentChatControls        new chat / save / history (conversation state)
            └── (landing sections)*      ProjectPickerList · GlobalRecentChatsSection
```

`*` The landing header and landing sections are inlined in `AgentHome` rather
than a standalone `AgentLandingPane` file — they are static layout, and a
separate component would only add indirection. The shared section building
blocks live in `AgentHomeSection.tsx` (see "Shared section primitives").

In the conversation state `AgentHome` renders the reused `AgentChatMessages`
leaf **directly** — there is no thin transcript wrapper. An earlier
`AgentChatTranscript` pass-through was removed because it owned nothing (1:1
prop forward) and its `memo` was redundant: the real per-token boundary is
`AgentChatMessages`'s own `memo` plus the memoized `AgentChatInput`. Message
content, the scroll container, the empty state, and the plan/tool/ask-user tail
cards all stay in `AgentChatMessages` (base, reused, also rendered by the
non-agent chat) — pulling them up into an Agent-only layer would fork a
base-maintained component and re-create merge conflicts. If PR2 needs
Agent-specific transcript chrome that should _not_ live in the shared base
(timeline grouping, "load older", etc.), reintroduce a transcript layer then —
with real responsibilities, not as an empty seam.

### Why `AgentHome` is persistent (no `key` remount)

Previously `AgentModeChat` rendered `<AgentChat key={session.internalId} />`, so
switching tabs remounted the whole surface and discarded any unsent input. PR1
removes that key: `AgentHome` persists and the tab strip swaps the `sessionId` /
`backend` props instead. Per-session input state lives in a draft store owned by
`AgentHome` (below) and passed down to the composer, so switching tabs swaps the
active draft rather than throwing it away.

## State ownership

| State                                                         | Owner                                                                                | Notes                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages`, `isStarting`, plan/permission, ask-user-questions | `useAgentChatRuntimeState(backend)`                                                  | Single backend subscription; one `sync()` keeps all fields consistent (incl. `pendingAskUserQuestions`). `messages` flow only to `AgentChatMessages`, which (with the memoized composer) is the per-token re-render boundary. |
| chat history items + handlers                                 | `useAgentHistoryControls(manager, plugin)`                                           | load / open / rename / delete / open-source.                                                                                                                                                                                  |
| per-session compose drafts                                    | `useAgentInputDrafts({ activeSessionId, liveSessionIds, defaultIncludeActiveNote })` | input / images / contextNotes / include-flags / `loading` / `queue`, keyed by session id. **Owned by `AgentHome`**, which passes the (referentially stable) controls object down to `AgentChatInput` as a `draft` prop.       |
| active turn `loading`, drag overlay                           | `AgentHome` (owns `useAgentInputDrafts` + `useChatFileDrop` directly)                | Reads `draft.loading` (transcript spinner) and `isDragActive` (whole-area overlay) straight from the hooks it owns — **not** mirrored up from the composer via effect callbacks.                                              |

### Migration invariants (must survive dismantling AgentChat)

Splitting the monolithic `AgentChat` into shell + leaves must NOT drop these
behaviors; each was load-bearing in the original and is easy to lose in a
refactor:

- **Plan/permission gating** — while a plan permission is pending the composer
  is inert: `hasPendingPlanPermission` wraps `AgentChatInput`'s output in
  `pointer-events-none` (+ dimmed), and the permission card still resolves.
- **`onSaveChat` registration** — the global autosave path
  (`CopilotAgentView.saveChat` → `manager.saveActiveSession()`) must always be
  registered against the **current active session**, never a stale one.
- **Whole-area file drop** — `AgentHome` runs `useChatFileDrop` bound to the
  chat container (`chatContainerRef`), not just the composer, so files dropped
  anywhere in the chat area attach to the active draft (the drop hook writes the
  draft's `contextNotes`/`images` that `AgentHome` owns), and `isDragActive`
  drives the whole-area overlay.

### Two-state derivation

`AgentModeChat` owns the no-session fallback (binary missing / booting / boot
error). Within an active session, `AgentHome` derives `isGlobalLanding`
(exposed as `data-agent-landing="global" | "conversation"`):

- **global landing** — active session has no user-visible messages
  (`!session.hasUserVisibleMessages()`): centered title + composer + landing
  sections. "Global" distinguishes this no-project landing from the per-project
  landing PR2 adds (`data-agent-landing="project"`).
- **conversation** — the session has messages: transcript fills, composer
  pinned bottom.

Because the runtime subscription re-renders `AgentHome` as the stream updates,
this re-derives the instant the first user message lands.

### Composer placement (center ⟷ bottom)

`AgentChatInput` is a **position-stable node at a fixed sibling index**. The
slots around it toggle (`landing header | transcript`, `null | controls`,
composer, `landing sections | null`); on the landing the column scrolls as one
unit (`overflow-y-auto` + a shared `tw-px-2`) with flex spacers above/below the
composer keeping it centered (biased lower), while in conversation the
transcript (`flex-1`) pushes the composer to the bottom. The composer never
remounts across the flip, so the draft and focus survive. (The flip is currently
instant; a smooth transition is a future polish.)

### Per-session draft lifecycle

- **switch session** → load that session's draft (or a fresh default seeded from
  `autoAddActiveContentToContext`); global `selectedTextContexts` are cleared so
  a selection can't drift between sessions.
- **send** → snapshot context into the queued item, then `resetCompose()` clears
  the compose box (input / images / notes / flags); `loading` + `queue` are
  per-session so a backgrounded turn never bleeds into the foregrounded session.
- **turn resolves after a tab switch** → the send-time `setLoading` closure is
  bound to the originating session, and a live-session guard prevents a late
  update from resurrecting a closed/replaced session's draft.
- **close / `replaceSessionInPlace`** → the session id leaves `liveSessionIds`;
  the draft (and its `File[]`) is pruned. `replaceSessionInPlace` mints a new id,
  so "new chat" naturally lands on a fresh empty draft.
- `selectedTextContexts` is intentionally **not** in the draft — it is a global
  ephemeral atom, snapshotted into the queued message at send time.

### Backend restart (how the UI absorbs it)

A backend can be restarted at runtime so its next spawn picks up new config:
binary path / install changes, system-prompt changes, provider config (filtered
by `restartOnProviderConfigChange`), and — added by `#2537` — a Copilot Plus
sign-in/out or license rotation, which restarts **every** backend (unfiltered),
because the decrypted license is injected into each backend's spawn env. All of
these funnel through `AgentSessionManager.restartBackend → restartBackendNow`.

The UI needs **no special restart listener**: a restart rides the same seam
every session change uses — `manager.subscribe()` → `AgentModeChat` re-reads
`getActiveSession()` / `getActiveChatUIState()` → feeds fresh `sessionId` /
`backend` to `AgentHome`. `restartBackendNow` closes every session on that
backend (`closeSession`, which first drains a pending auto-save), so their ids
leave `liveSessionIds` and their drafts are pruned by `useAgentInputDrafts`;
only when the _active_ session was on that backend is one fresh replacement
session created. An in-flight turn is **not** interrupted — the restart defers
until the busy session goes idle.

Consequences worth knowing (session-layer behavior, **not** PR1-introduced — the
legacy `AgentChat` took the same path and additionally discarded drafts on its
`key` remount):

- A Plus-license change restarts all backends, so **every open tab closes at
  once**: the active backend keeps one fresh empty session (which re-derives
  `isGlobalLanding` → the landing reappears), the rest just vanish. Unsent
  drafts / queued follow-ups in every closed tab are lost.
- A closed conversation survives on disk **only if `autosaveChat` is on**
  (`closeSession` drains the debounced auto-save, which is gated on that
  setting); with it off, an in-progress chat that was never manually saved is
  gone. This is the sharp edge — a Plus sign-in resets whatever you were doing.

**PR2 caution.** When sessions gain a `projectId` and history becomes
project-scoped, keep project / scope state **derived from the manager through
this same subscribe seam** — don't cache it independently in `AgentHome`, or a
restart strands it. And `restartBackendNow`'s replacement session has no
`projectId` today; PR2 must decide which project it belongs to (and whether to
auto-replace inside a project at all, versus falling back to the project
landing). The deferred "background-session queue auto-flush" seam must likewise
survive — or explicitly accept losing — a restart that closes background
sessions.

## Landing sections (Projects + Recent Chats)

Visible only in the global-landing state. The two sections sit at **different
capability levels on purpose**: Projects is read-only because real project
management (CRUD, entering a project) is PR2 backend work, while Recent Chats is
fully manageable because chat management already exists in PR1 — the conversation
control bar uses the same `ChatHistoryPopover`, every handler already lives in
`useAgentHistoryControls`, so the landing **reuses** it rather than shipping a
weaker read-only twin.

- `ProjectPickerList` — **read-only.** `projects` from `useProjects()` (read-only
  `sortByStrategy("recent")` inside), inline list capped at `INLINE_LIMIT` (3)
  with an in-pane `AgentHomeViewAll` popover + search. A header `+` button and row
  clicks both fire a coming-soon `Notice` only — **no** `setCurrentProject`, no
  `touch`, no session creation, no history-scope change.
- `GlobalRecentChatsSection` — **inline preview read-only, View-all fully
  manageable.** The inline 3 rows open-on-click and are pinned to
  `sortByStrategy("recent")` (the section is literally "Recent Chats"). The "View
  all chats" trigger opens the full `ChatHistoryPopover` — search, time grouping,
  rename, delete, open-source, backend icon — which follows the user's configured
  `chatHistorySortStrategy`. So the inline order (always recent) and the popover
  order (user setting) can differ by design. Every mutation routes through the
  same `useAgentHistoryControls` handlers the conversation control bar uses; no
  new backend.

## Shared section primitives

`AgentHomeSection.tsx` holds the building blocks the landing lists render
through. Both sections share the header + inline-rows shape; they diverge at
"View all" — Projects opens `AgentHomeViewAll`, Recent Chats opens the full
`ChatHistoryPopover` (so `AgentHomeViewAll` currently has a **single consumer**,
kept generic for the project-scoped section PR2 adds rather than specialized now):

- `AgentHomeSection` — section header (icon + title + bracketed count + optional
  trailing action) over its rows.
- `AgentHomeListRow` — generic row: optional leading icon, truncated label
  (with full-text `title` tooltip), relative time (with absolute-time tooltip).
  No icon by default (the header carries the type icon); an icon is passed only
  when it's _informational_ — see the backend icon below.
- `AgentHomeViewAll<TItem>` — generic "View all" trigger + in-pane search
  popover, generic over the item type so the domain doesn't leak into the
  primitive. Pages the full list with `VIEW_ALL_PAGE_SIZE` (50) via an
  `IntersectionObserver` sentinel. **Used by the Projects "View all" only**; kept
  generic for PR2's project-scoped section (Recent Chats reuses the richer
  `ChatHistoryPopover` instead).

### Optimizations ported from existing components

PR1 (zero backend), lifted from mature components so the landing matches their
proven behavior. These apply to what PR1 actually built — the inline rows and the
Projects `AgentHomeViewAll`; the Recent Chats View-all gets the same behaviors
natively because it _is_ the reused `ChatHistoryPopover`:

- **Lazy pagination** (`IntersectionObserver` + sentinel, callback-ref for
  Radix's deferred mount) — copied from `ChatHistoryPopover` into
  `AgentHomeViewAll` (the Projects View-all) so a long list renders incrementally.
  The Recent Chats View-all is `ChatHistoryPopover` itself, so it paginates
  natively without this port.
- **`sortByStrategy("recent")`** — from `ChatHistoryPopover` / the project list.
  The Projects list and the Recent Chats **inline preview** sort by it (last-used
  desc → created → name). The Recent Chats View-all is the real
  `ChatHistoryPopover`, which follows the user's `chatHistorySortStrategy`
  instead. The inline preview owns its sort because the PR1-frozen
  `getChatHistoryItems()` returns vault-scan order.
- **Row tooltips** (full label + absolute time) — the glanceable compact labels
  stay; hover reveals the full value.
- **Backend brand icon on Recent Chats rows** — reuses `backendRegistry[id].Icon`
  (same resolver as `AgentChatControls`), falling back to `MessageCircle` — the
  same fallback `ChatHistoryPopover` rows use, so the inline preview and the
  View-all match for legacy chats with no `backendId`. Projects rows stay
  icon-less; the chat icon is informational (which backend ran it), not a repeat
  of the section type.

## Asset reuse decisions

PR1 reused existing code only where it was safe to, and rebuilt where the old
asset carried legacy-Chat semantics. The rule of thumb: **a pure function,
read-only selector, or side-effect-free hook is reused; a controller component
or a hook that writes global state is not** — anything that depends on
legacy-Chat concepts (`useChatInput` / `showChatUI` / `setCurrentProject` /
chain type) cannot enter Agent Home directly. `ChatInput` is a shared hotspot
(Agent + legacy Chat both render it), so it stays a black box — centering vs
pinning is solved by the outer layout's CSS, never by editing `ChatInput`.

| Asset                                     | Decision                          | Why                                                                                                                          |
| ----------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `useProjects()`                           | reuse                             | Reactive read-only, stable ref; store is populated at `onLayoutReady`, so it has data even when only the Agent view is open. |
| `sortByStrategy()`                        | reuse                             | Pure sort (reads `UsageTimestamps`, never touches it).                                                                       |
| `filterProjects()`                        | reuse (search)                    | Pure filter.                                                                                                                 |
| `ProjectConfig`                           | reuse                             | Plain type.                                                                                                                  |
| `ChatInput`                               | reuse, black box (no edits)       | Controlled component; center/pin handled by outer CSS.                                                                       |
| `AgentTabStrip`                           | reuse, untouched                  | Takes only `manager`; already global-scoped in the no-project world.                                                         |
| `ChatHistoryPopover` / `ChatHistoryItem`  | reuse                             | Agent already uses them.                                                                                                     |
| `ProjectList.tsx`                         | **rebuild** (`ProjectPickerList`) | Legacy-Chat controller (`useChatInput` / `showChatUI` / `setCurrentProject`); read-only picker is a clean rewrite.           |
| `setCurrentProject` / `getCurrentProject` | **do not touch**                  | Generic name but carries legacy project-mode global semantics.                                                               |
| `touchProjectLastUsed` / usage `touch`    | **do not touch**                  | Write semantics; PR1 is read-only.                                                                                           |
| `AddProjectModal`                         | PR2 reuse                         | Callbacks are clean (no legacy semantics), but project creation is PR2.                                                      |

## PR2 seam (not implemented in PR1)

Structural seams already in place:

- The `AgentHome` shell is in place; PR2 adds a project-workspace state as a new
  branch without disturbing the no-project skeleton.
- The landing display components take only `items` / `projects` + callbacks, so
  PR2 can swap in project-scoped history without touching them.
- `ProjectPickerList.onSelect` / `onCreate` flip from coming-soon `Notice`s to
  real project entry + creation; `GlobalRecentChatsSection` (global) sits beside
  a future project-scoped "Project Chats" without a naming clash.

Deferred to PR2 (write operations / backend — must NOT leak into the **Projects**
read-only list; chat management already shipped via the reused
`ChatHistoryPopover`):

- **Project CRUD**: create / rename / delete / duplicate / archive, the per-row
  `⋯` management menu, and the "name only" quick-create modal.
- **`setCurrentProject` + project usage touch** — entering a project switches
  context and records recency; PR1 writes neither.
- **`projectId` on sessions, scope envelope / `scopeStatus` gating,
  switch-project = switch-history, indexing card, drag-to-add context, Outputs.**
- **Project-scoped chat history** — the chat management surface (rename / delete /
  open-source / time-group headers / mobile always-visible actions) already ships
  in PR1 for the global list via `ChatHistoryPopover`; PR2 only re-points it at a
  project-filtered list.
- **Sort-strategy switcher** writing `settings` (PR1's Projects list and the
  Recent Chats inline preview pin `recent`; the chat View-all already follows the
  read-only `chatHistorySortStrategy`).
- **Background-session queue auto-flush** — sink the per-session compose queue
  from the foreground composer down into the session layer
  (`AgentSession` / `AgentChatUIState`) so a background turn drains its own
  queued follow-ups when it finishes, instead of waiting for the user to return
  to that tab. PR1's queue lives in `AgentChatInput` (UI), which by design only
  observes the foreground session — see the DESIGN NOTE on the flush effect in
  `AgentChatInput.tsx`. PR1 is already strictly better than legacy here (legacy
  kept the queue in component `useState` and discarded it on tab-switch
  remount); this is an additive enhancement, not a regression fix, and belongs
  with the session-layer/backend work, not the read-only frontend.
