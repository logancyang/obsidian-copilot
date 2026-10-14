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
  own sessions, chat history, and project context, while the global
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
| Recent Chats section                                      | ✅ searchable scrolling list               | per-scope                               |
| Per-session compose drafts                                | ✅ queue survives switch, foreground flush | session-layer auto-flush still deferred |
| Projects section                                          | ✅ read-only list + picker                 | real entry + CRUD                       |
| Enter a project (header + per-project sessions + Context) | ❌ coming-soon `Notice`                    | ✅                                      |
| `projectId` on sessions, scoped history, scope cwd        | ❌                                         | ✅                                      |
| Project context manifest (paths and links)                | ❌                                         | ✅ first prompt, nothing prefetched     |
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

- **switch session** → load that session's draft (or a fresh default that includes
  the active note and active web tab); global `selectedTextContexts` are cleared.
- **send** → snapshot context into the queued item, then `resetCompose()`, which
  keeps the session's Active Note and Active Web Tab choices;
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

The Projects and Recent Chats shelves support inline search and scrolling. Both
mount rows in batches of 50 through an `IntersectionObserver` sentinel; filtering
runs over the full collection. Projects retain most-recently-used ordering and
inline row actions. The shared row and scroll-region building blocks live in
`AgentHomeSection.tsx`.

The reuse rule of thumb: **a pure function, read-only selector, or side-effect-free
hook is reused; a controller component or a hook that writes global state is
rebuilt.** `ChatInput` is a shared hotspot (Agent + legacy Chat both render it),
so it stays a black box — centering vs pinning is solved by the outer layout's
CSS, never by editing `ChatInput`.

---

# Part II — Project workspaces (PR2, backend)

Entering a project gives it its own sessions, chat history, and project
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

## Project context

Before a project session opens, `buildProjectContext`
(`context/manifestBuilder.ts`) reads the project's saved sources and builds a
`<project_context>` block that is inlined into the session's first user prompt.
It runs synchronously against Obsidian's in-memory vault index: nothing is
fetched, converted, or cached, so session start never waits on it and there is
no load state to report.

The block lists:

- **Folders** by absolute path. Folders outside the session cwd are also
  returned as `additionalDirectories`, widening the agent's readable roots.
- **Notes** (`[[Title]]` inclusions) resolved to the absolute path of every file
  with that basename.
- **Properties** as labels, and expanded into the notes whose frontmatter
  matches, because a frontmatter value is not something an agent can grep its
  way to reliably.
- **Document files** (PDFs, Office docs, e-books, images — the extensions in
  `DOCUMENT_EXTENSIONS`) by the absolute path of the original vault file.
  The preamble tells the agent they are not converted and to open them with its
  own tools. Claude Code reads PDFs and images natively; with Miyo document
  processing on, the `miyo-parse` Skill parses PDFs and EPUBs for any agent.
- **Tags and file-type patterns** as labels for the agent to search.
- **Web and YouTube links** as plain links. The agent fetches one when a
  question needs it, with its own web tool or the `copilot-web-fetch` /
  `copilot-youtube-transcript` Skill.

Resolving notes, properties, and documents to paths instead of passing them as
labels costs nothing at session start and saves the agent a vault search per
question; it also keeps agents from reading same-named or similarly tagged notes
that are not part of the project
(https://github.com/Brevilabs/obsidian-copilot-private/issues/711). The block is
capped at `MAX_MANIFEST_ENTRIES`, with declared sources listed before the
property and document expansions so a large expansion cannot crowd them out.

A `contextSignature` over the source fields drives reactivity: a re-entered
project replaces its empty landing session only when its sources or
instructions changed.

`Clear Copilot cache` also deletes `~/.obsidian-copilot/vaults/<vaultId>/context-cache/`,
a folder no current code reads or writes, and leaves the sibling
`agent-chat-index.json` intact. The command reaches `context/conversionsLocation.ts`
through a desktop-gated dynamic `import`, and `scripts/mobile-load-smoke.cjs`
checks that boundary.

## Project instructions (`project.md` + `AGENTS.md`)

`project.md` remains the project metadata/config record. `AGENTS.md` is the
canonical user-and-agent-editable instruction file and is never regenerated by
Copilot. The project info popover opens that file directly.

For an older project with no `AGENTS.md`, `moveProjectPromptToAgentsFile` writes
the legacy `project.md` body into a new `AGENTS.md` and clears that body from
`project.md`. It runs from the open action and at session start, so a project
that predates the file layout still delivers its instructions without a manual
click. A marker-owned generated mirror is converted to that raw body; unmarked
user files are preserved. `ensureAgentsFileForDiscovery` runs at session start
and only adds the `CLAUDE.md` import beside an `AGENTS.md` that already exists.
Nothing is created for a scope with no instructions to carry over, so a fresh
project folder stays empty. No bulk migration rewrites existing projects.
Codex and OpenCode discover `AGENTS.md` from the session cwd; a sibling
`CLAUDE.md` imports `@AGENTS.md` so Claude reads the same file. Vault-root files
provide the broader layer and project files provide the more-specific layer.

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

- **Hard-disabled composer** — when the active project is orphaned (deleted out
  from under the user), the composer blocks both keyboard sends and the
  queued-message flush, not just pointer events, so a turn can't drain into a dead
  project.
- **Unified todo / plan** — backend todo lists across claude / codex / opencode
  are normalized into one plan model feeding the project info popover, with
  per-session todo-id tracking and symmetric plan-clear on empty.

## Verification

Project context resolution is covered by `manifestBuilder.test.ts`, and its
hand-off into new and resumed sessions by the `AgentSession` and
`AgentSessionManager` suites.
