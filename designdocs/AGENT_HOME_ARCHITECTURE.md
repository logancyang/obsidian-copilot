# Agent Home & Project Workspace Architecture

How the Agent Mode chat surface is structured, from the "Agent Home" landing
shell through project-scoped workspaces. The work landed in two increments on a
single axis — **does it touch the backend?**

- **PR1 (frontend-only)** dismantled the monolithic `AgentChat` into a persistent
  shell plus focused leaf components, added a centered landing homepage for empty
  sessions, and introduced a landing with a read-only Projects list and a fully
  manageable Recent Chats list. No backend, persistence, or project-scope
  behavior changed.
- **PR2 (project workspaces + backend)** turned Agent Mode "projects" into Claude
  Projects-style workspaces: entering a project gives a scoped workspace with its
  own sessions, chat history, and materialized context, while the global
  workspace becomes one special scope sharing the same code path.

This doc describes the **current** architecture (PR1 + PR2). Two follow-on areas —
a built-in Obsidian MCP tool surface, and Outputs / Discover-URLs — are **PR3**
and are not covered here.

## Increments at a glance

| Capability                                                | PR1                                        | PR2                                     |
| --------------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| AgentHome layout shell, persistent (no `key` remount)     | ✅ build (no-project state)                | + project state                         |
| No-project landing (centered composer → pin to bottom)    | ✅                                         | —                                       |
| Multi-session tabs (`AgentTabStrip`)                      | ✅ reuse, global                           | project-scoped                          |
| Recent Chats section                                      | ✅ inline 3 + `ChatHistoryPopover`         | per-scope                               |
| Per-session compose drafts                                | ✅ queue survives switch, foreground flush | session-layer auto-flush still deferred |
| Projects section                                          | ✅ read-only list + picker                 | real entry + CRUD                       |
| Enter a project (header + per-project sessions + Context) | ❌ coming-soon `Notice`                    | ✅                                      |
| `projectId` on sessions, scoped history, scope cwd        | ❌                                         | ✅                                      |
| Project context materialization (URL/YouTube/PDF)         | ❌                                         | ✅ off-vault shared cache               |
| Project instructions (`project.md` + `AGENTS.md` mirror)  | ❌                                         | ✅                                      |
| Drag-to-add context, Welcome onboarding card              | ❌                                         | ✅                                      |
| Built-in MCP tool surface, Outputs / Discover URLs        | ❌                                         | PR3                                     |

---

# Part I — Agent Home shell (PR1, frontend)

## Component tree

```
CopilotAgentView
└── AgentModeChat                preload gate · auto-spawn · no-session fallback
    └── AgentHome                persistent shell for the active session
        └── ChatInputProvider
            ├── AgentTabStrip            multi-session tabs
            ├── AgentModeStatus          install / boot status pill
            ├── (landing header)*        landing title + backend·mode subtitle
            │       ⟷ AgentChatMessages      (conversation state — reused base leaf)
            ├── AgentChatInput           composer: controlled by a `draft` prop; send/queue/stop
            ├── AgentChatControls        new chat / save / history
            └── (landing sections)*      project/recent-chat shelves
```

`*` The landing header and sections are inlined in `AgentHome` (static layout; a
separate component would only add indirection). The shared section building
blocks live in `AgentHomeSection.tsx`.

In the conversation state `AgentHome` renders the reused `AgentChatMessages` leaf
**directly** — no thin transcript wrapper. An earlier `AgentChatTranscript`
pass-through was removed because it owned nothing (1:1 prop forward) and its
`memo` was redundant: the real per-token boundary is `AgentChatMessages`'s own
`memo` plus the memoized `AgentChatInput`. Message content, the scroll container,
the empty state, and the plan/tool/ask-user tail cards stay in
`AgentChatMessages` (base, reused, also rendered by the non-agent chat) — pulling
them into an Agent-only layer would fork a base-maintained component and
re-create merge conflicts.

### Why `AgentHome` is persistent (no `key` remount)

Previously `AgentModeChat` rendered `<AgentChat key={session.internalId} />`, so
switching tabs remounted the whole surface and discarded unsent input. The shell
is now persistent: the tab strip swaps the `sessionId` / `backend` props instead.
Per-session input state lives in a draft store owned by `AgentHome` and passed to
the composer, so switching tabs swaps the active draft rather than throwing it
away.

## State ownership

| State                                                         | Owner                                      | Notes                                                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages`, `isStarting`, plan/permission, ask-user-questions | `useAgentChatRuntimeState(backend)`        | Single backend subscription; one `sync()` keeps all fields consistent. `messages` flow only to `AgentChatMessages`, the per-token re-render boundary.                              |
| chat history items + handlers                                 | `useAgentHistoryControls(manager, plugin)` | load / open / rename / delete / open-source.                                                                                                                                       |
| per-session compose drafts                                    | `useAgentInputDrafts(...)`                 | input / images / contextNotes / include-flags / `loading` / `queue`, keyed by session id. Owned by `AgentHome`, passed to `AgentChatInput` as a referentially-stable `draft` prop. |
| active turn `loading`, drag overlay                           | `AgentHome`                                | Reads `draft.loading` and `isDragActive` straight from the hooks it owns — not mirrored up from the composer via effect callbacks.                                                 |

### Migration invariants (must survive dismantling AgentChat)

Splitting the monolith into shell + leaves must NOT drop these load-bearing
behaviors:

- **Plan/permission gating** — while a plan permission is pending the composer is
  inert (`pointer-events-none` + dimmed) and the permission card still resolves.
- **`onSaveChat` registration** — the global autosave path must always be
  registered against the **current active session**, never a stale one.
- **Whole-area file drop** — `useChatFileDrop` is bound to the chat container, so
  files dropped anywhere in the chat area attach to the active draft, and
  `isDragActive` drives the whole-area overlay.

### Two-state derivation & composer placement

Within an active session, `AgentHome` derives `isGlobalLanding` (exposed as
`data-agent-landing`):

- **global landing** — active session has no user-visible messages: centered
  title + composer + landing sections.
- **conversation** — the session has messages: transcript fills, composer pinned
  to bottom.

The composer (`composerNode`) is the same element in both branches, but it sits
at a different tree position in each, so it **remounts** on the
landing→conversation flip. That is safe because the flip only fires right after a
send (which already reset the draft) or on a chat load (which changes `sessionId`
and remounts anyway), and the per-session draft lives in `AgentHome` — not in the
composer — so it survives the remount.

### Per-session draft lifecycle

- **switch session** → load that session's draft (or a fresh default seeded from
  `autoAddActiveContentToContext`); global `selectedTextContexts` are cleared.
- **send** → snapshot context into the queued item, then `resetCompose()`;
  `loading` + `queue` are per-session so a backgrounded turn never bleeds into the
  foregrounded session.
- **turn resolves after a tab switch** → the send-time `setLoading` closure is
  bound to the originating session; a live-session guard prevents a late update
  from resurrecting a closed/replaced session's draft.
- **close / `replaceSessionInPlace`** → the session id leaves `liveSessionIds`;
  the draft (and its `File[]`) is pruned.

### Backend restart (how the UI absorbs it)

A backend can be restarted at runtime (binary/install change, system-prompt
change, filtered provider config, or a Copilot Plus sign-in/out that restarts
every backend). All funnel through `AgentSessionManager.restartBackend →
restartBackendNow`. The UI needs **no special restart listener**: a restart rides
the same seam every session change uses — `manager.subscribe()` → `AgentModeChat`
re-reads `getActiveSession()` and feeds fresh props to `AgentHome`.
`restartBackendNow` closes every session on that backend (draining a pending
auto-save first), so their drafts are pruned; only when the _active_ session was
on that backend is one fresh replacement created. An in-flight turn is not
interrupted — the restart defers until the busy session goes idle.

PR2 keeps project / scope state **derived from the manager through this same
subscribe seam** (never cached independently in `AgentHome`), so a restart can't
strand it; the replacement session inherits the replaced session's `projectId`
(see Part II).

## Landing sections, shared primitives & asset reuse

The landing's two shelves sit at different capability levels on purpose: in PR1
Projects was read-only (a coming-soon `Notice`) because real project management
is backend work, while Recent Chats was fully manageable by reusing the existing
`ChatHistoryPopover` (search / rename / delete / open-source). The shared shelf
building blocks live in `AgentHomeSection.tsx` (`AgentHomeSection` /
`AgentHomeListRow` / generic `AgentHomeViewAll<TItem>` with lazy
`IntersectionObserver` paging), kept generic so PR2's project-scoped shelves
reuse them.

The reuse rule of thumb: **a pure function, read-only selector, or side-effect-free
hook is reused; a controller component or a hook that writes global state is
rebuilt.** `ChatInput` is a shared hotspot (Agent + legacy Chat both render it),
so it stays a black box — centering vs pinning is solved by the outer layout's
CSS, never by editing `ChatInput`.

---

# Part II — Project workspaces (PR2, backend)

Entering a project gives it its own sessions, chat history, and materialized
context. The global workspace is modeled as one special scope (the
`GLOBAL_SCOPE` sentinel) running the same code path, so there is no separate
"no-project" branch to keep in sync.

## Session scope

`AgentSessionManager` stores sessions in a `Map<string, AgentSession>` keyed by an
internal session id, but **binds each session to an immutable `projectId`**. All
scope behavior keys off that `projectId`, not off the map key:

- **per-scope MRU** and `getSessionsForScope(projectId)` — the tab strip and
  history filter to the active scope.
- `resolveSessionCwd` / `resolveScopeCwd` — a project's working directory is its
  own folder (the directory holding its `project.md`); the global scope falls
  back to the vault root.
- `enterProject` / `exitProject` — switch the active scope.
- **Active-session invariant**: `getActiveSession().projectId === activeProjectId`.
  Existing UI helpers that read the active session stay correct without knowing
  about scopes.

Two behaviors preserve the invariant across the rough edges:

- **Backend restart / in-place replacement inherits the replaced session's
  `projectId`** — a project scope reuses its warm process instead of adopting the
  vault-root probe session.
- **Re-entering a project opens as a fresh visit**: in-progress conversational
  chats detach from the tab strip (kept live in the pool, listed in chat history
  with a running indicator) instead of dragging every prior tab back, while an
  unused empty landing is reused rather than stacked. The global workspace keeps
  its restore-the-last-tab behavior.

## Context materialization

A project can attach **URL / YouTube** links and **in-vault binary files** (PDFs,
Office docs, e-books, images — all materialized under the single `file` kind).
Before a session
opens, `projectContextMaterializer` captures them once per session
(single-flight per project), converts each via brevilabs into a text snapshot,
and builds a `<project_context>` block that is inlined into the session's first
user prompt. The block lists absolute paths to the snapshots so the agent can
read them directly; the composer shows a context status icon and queues sends
while context is still materializing.

Folders, notes, tags, and extensions are listed in the same block by path/pattern
(they need no conversion); folders that live outside the session cwd are also
reported as `additionalDirectories` to widen the agent's searchable roots.

**Contract (relied on by the session manager):** materialization **never
rejects** — any failure degrades to a best-effort partial / empty result so
session start is never blocked. It is cheap on unchanged context (snapshots
cheap-skip by fingerprint, known-bad sources cheap-skip by failure marker), and a
`contextSignature` over the source fields drives reactivity: a re-entered project
re-materializes only when its sources changed, and the active project warms its
cache in the background.

### The shared off-vault conversion cache

Snapshots are the supporting subsystem behind context materialization. Each
source is converted **once per vault** and shared across every project that
references it, instead of once per project.

**Off-vault, per-vault layout.** The cache lives outside the vault — single copy,
not synced by Obsidian Sync / git, never indexed as note content — under the
existing per-vault namespace that already hosts the recent-chats index:

```
~/.obsidian-copilot/vaults/<vaultId>/context-cache/
  remotes/   web-<md5(url)>.md · youtube-<md5(url)>.md          # shared by all projects
  files/     file-<md5(vaultPath)>.md                           # shared by all projects
  markers/   <md5(projectId)>/failed-<type>-<md5(source)>.json  # failure markers, per project
```

`vaultId = md5(adapter.getBasePath()).slice(0, 8)` (extracted as `getVaultId` in
`utils/appPaths.ts`). Per-vault bucketing means the current vault's project
registry is the cache's complete reference set, so garbage collection needs no
cross-vault refs subsystem — at the cost of the same URL being converted once in
each of two different vaults (rare). **All paths derive from one source of truth,
`context/conversionsLocation.ts`** (`cacheRoot` / `remotesDir` / `filesDir` /
`markersDir(projectId)`), shared by the writer and every reader.

**Identity keys + internal freshness.** Snapshot filenames hash the **source
identity** (`md5(url)` / `md5(vaultPath)`) — never content, never `projectId`.
Freshness is a `fingerprint` stored in the snapshot's own metadata header, and it
differs by kind: a **file** uses `mtime:size` (an edit changes the fingerprint, so
the cheap-skip misses and the **same file is overwritten** — no orphans), while a
**remote** uses its identity (`type:url`), so a successfully fetched URL is kept
until its configured string changes. A URL's identity is the exact trimmed string
the user configured — there is no semantic canonicalization (`x.com` ≠ `x.com/`).

**Per-artifact lock.** A module-level lock (keyed by the snapshot filename, via
`async-mutex`) wraps each source's whole read-decide-write. Because the key is
identity-derived, the **same source across two projects maps to the same lock**:
the first project to cold-convert acquires it, reads metadata (miss), fetches,
atomically writes, releases; a second project waiting on the same source then
acquires the lock, re-reads the now-present metadata, and **cheap-skips without
re-fetching or overwriting**. Two projects cold-converting one URL converge to a
single brevilabs call.

**Failure markers (CAG-style negative cache).** A source that fails to
fetch/parse with no usable snapshot writes a `failed-…json` marker in _its own
project's_ marker bucket, carrying the error and (for files) the `mtime:size`
fingerprint. A later automatic run cheap-skips that known-bad source — re-surfacing
the stored error instead of re-hitting brevilabs every session — until the file
changes or the user forces a retry (`forceRetryFailed`, the status popover's
"Retry"). Markers are bucketed per project because a failure is meaningful only to
the project that hit it; snapshots are shared, so they are **never reconciled
against a single project's sources** (that would delete files other projects
still use). Cross-project convergence is handled instead: when project B writes a
shared snapshot for a source project A previously failed, A's next run cheap-skips
the snapshot and best-effort clears its now-stale marker. A successful snapshot is
kept indefinitely (no TTL) — the plugin can't observe an agent reading an absolute
path, so a time-based or touch-on-read policy would either over-retain or delete
context that is still in use.

**Delivery to the three backends.** The shared cache lives outside every project
cwd, so the only pointer all three backends can reach is an **absolute path**: the
manifest lists each snapshot's absolute path (keyed by `type:source` so the same
URL used as both a web and a YouTube source resolves to distinct snapshots), and
agents read it with their native file tool. claude additionally accepts the cache
root as an `additionalDirectories` entry; codex reads the whole disk; **opencode
blocks reads outside the vault by default, so it is granted an
`external_directory: { "<cacheRoot>/**": "allow" }`\*\* on its spawn agents.

### The root-confined node:fs backend

`ContextCacheFs` is a small injectable filesystem interface kept **node-free** (a
pure type), so mobile-reachable code can import the type without pulling
`node:fs` into the bundle. The single production implementation,
`createNodeContextCacheFs`, is rooted at the absolute cache directory and loads
`node:fs` / `node:path` **lazily via `require` inside the factory** — never at
module top level — so the builtins are evaluated only behind the desktop Agent
boundary. Three hard rules:

- **Root-confined.** Internal paths are cache-root-relative (absolute paths are
  resolved only in `conversionsLocation`); `resolveWithin` rejects `..` segments,
  absolute inputs, and anything that resolves outside the root, and `clear` never
  ascends to the parent `vaults/<id>/` (which holds `agent-chat-index.json`).
  Symlink escape is documented as intentionally out of scope: every path is
  plugin-derived md5 filenames, so no caller can inject one, and following a
  pre-seeded symlink would require a local actor who already has write access to
  this directory.
- **Split best-effort policy.** `writeText` / `mkdirRecursive` **throw** — a
  swallowed write would let the store report success while the snapshot is
  missing (a manifest pointing at nothing). The store turns a write throw into a
  per-source failure and a mkdir throw into a whole-run degradation. `list` /
  `remove` / `clear` **tolerate** a missing target (`[]` / idempotent). `readText`
  **passes the error through** — the store's `readMeta` / `readFailureMarker` and
  the UI's tolerant helpers each `try/catch → null`, so read-as-miss tolerance
  lives at the call sites, not the fs layer.
- **Atomic writes.** `writeText` stages into a same-dir temp file then renames
  over the target (with a short retry for transient Windows watcher/AV locks);
  `list` ignores temp files. The cache is regenerable, so there is no `fsync`.

### Mobile boundary

The Agent-Mode context readers (status icon, content-conversion preview, the
Clear command) are reachable from a shared modal that mobile also renders. They
must never evaluate `node:fs` on mobile, so each reaches the node-touching modules
(`conversionsLocation`, `contextCacheFs`) through a desktop-gated **dynamic
`import`**, never a static top-level import. (Desktop-only paths that mobile can
never reach — the materializer, the opencode descriptor — import the same modules
statically, which is fine; only the mobile-reachable readers need the dynamic
boundary.) On mobile the readers degrade to an empty state (there is no Agent Mode
there anyway). A static-import smoke check (`scripts/mobile-load-smoke.cjs`) guards
this boundary over the cache consumers.

### Cleanup

There is **no automatic garbage collection** in this version — the existing
`Clear Copilot cache` command additionally wipes `context-cache/` (all three
subdirectories) while leaving the sibling `agent-chat-index.json` intact. Marker
cleanup happens incrementally (a stale marker is cleared when its source later
succeeds, as above). The released CAG caches (`.copilot/*`) are a separate system
and are left untouched. Source kinds are a single source of truth,
`MATERIALIZED_SOURCE_TYPES` (`web` / `youtube` / `file`), so adding a kind updates
the filename patterns and marker-pruning regex together.

## Project instructions (`project.md` + `AGENTS.md` mirror)

`project.md` is the single source of truth for a project's config and
instructions. A **marker-gated `AGENTS.md` mirror** is generated alongside it by
`ensureAgentsMirror`: codex and opencode auto-discover `AGENTS.md` from the
session cwd, and claude receives the same composed instructions via
`getProjectProfile`. A built-in project policy is layered into each project's
instructions — for claude always; for codex/opencode through the generated
mirror, which **yields to a user-authored, unmarked `AGENTS.md`** (the mirror only
manages the file it owns, so it never clobbers a hand-written one).

## History scope

Agent chat history is scope-keyed: a project view lists only that project's
chats, while `GLOBAL_SCOPE` is the flat all-chats view. A chat's scope is its
frontmatter `projectId`; a legacy chat with no `projectId` resolves to
`GLOBAL_SCOPE` (the hard contract is "absent/blank `projectId` → `GLOBAL_SCOPE`",
never a filename-prefix guess). Native session history is scoped to projects too,
and a resumed transcript hydrates from the session's scope cwd.

Opening a saved chat from a different scope switches `activeProjectId` before
resuming/creating its session. If the resume returns no session and the create
then throws (e.g. a missing backend binary fails to spawn), the load would leave
`activeProjectId` pointing at the new scope while `activeSessionId` still
references the old one — breaking the active-session invariant.
`rollbackHistoryLoadScope` restores the replaced scope on that failure, but only
while still parked in the scope the load switched to (a concurrent switch during
the awaited spawn means the user has moved on).

## Hardening & cross-cutting

- **`contextCacheFs` path guards** — `..`, absolute, and root-escaping paths are
  rejected; symlink escape is a documented out-of-scope design note (above).
- **Hard-disabled composer** — when the active project is orphaned (deleted out
  from under the user), the composer blocks both keyboard sends and the
  queued-message flush, not just pointer events, so a turn can't drain into a dead
  project.
- **Unified todo / plan** — backend todo lists across claude / codex / opencode
  are normalized into one plan model feeding the project info popover, with
  per-session todo-id tracking and symmetric plan-clear on empty.

## Verification

The cache and scope behavior are covered by unit + integration suites, including
a real-filesystem dedup integration test that drives the production
`createNodeContextCacheFs` and the real per-artifact lock against a temp
directory (two projects sharing a URL → one snapshot on disk, one fetch; the same
for a shared PDF; a failed project's marker cleared once another project
materializes the source). The opencode `external_directory` allow injection, the
mobile static-import boundary, and the three-backend snapshot read were validated
against a real vault.
