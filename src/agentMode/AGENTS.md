# Agent Mode — layer rules

Six element types, strict imports. Enforced by `eslint-plugin-boundaries`
(see root `eslint.config.mjs`). The list below mirrors `boundaries/elements` and
`boundaries/dependencies` exactly — when in doubt, the lint config wins.

1. **`session/`** — **the contract layer.** Hosts the
   backend-agnostic session, message store, UI-state bridge,
   persistence manager.
2. **`acp/`** — the generic ACP runtime (subprocess, JSON-RPC connection,
   vault-backed ACP client, JSON-RPC stream tap) —
   the only place that touches `@agentclientprotocol/sdk`. **All ACP knowledge is confined here.**
3. **`sdk/`** — in-process SDK adapters that implement
   `BackendProcess` directly. Today
   this hosts the Claude Agent SDK driver. **Does not import `acp/` or `@agentclientprotocol/sdk`** —
   `acp/` and `sdk/` are siblings, and the SDK adapter speaks the
   session domain natively.
4. **`backends/<id>/`** — one backend per folder. Exports a
   `BackendDescriptor` whose `createBackendProcess` returns a finished
   `BackendProcess`.
5. **`backends/registry.ts`** — the only place that names every
   backend.
6. **`ui/`** — backend-agnostic React UI. — permission modals, model pickers, and
   trail rendering all read session-domain types;
7. **`skills/`** — canonical-store discovery, symlink lifecycle, reconciliation,
   and the Skills settings UI.

## Why two adapters under one session

The contract lives in `session/types.ts` (`BackendProcess`,
`BackendDescriptor`, the full session-domain type set) and
`session/errors.ts` (`MethodUnsupportedError`). `acp/AcpBackendProcess`
wraps a JSON-RPC subprocess and translates ACP wire ↔ session-domain
at its public boundary (via `acp/wireTranslate.ts`);
`sdk/ClaudeSdkBackendProcess` wraps an in-process async generator and
emits session-domain events natively. Both produce the same
`SessionEvent` stream and `BackendState`, so `AgentSession` stays
oblivious. Crucially, **neither adapter imports the other**,
`session/` doesn't import either, and `@agentclientprotocol/sdk`
imports outside `acp/` are blocked by lint
(`no-restricted-imports`).

## Adding a new backend

Pick a track based on what the agent gives you:

- **Subprocess track** (codex, opencode) — the agent speaks ACP
  over stdio. Implement `AcpBackend` in `Backend.ts` and have the
  descriptor's `createBackendProcess(args)` call
  `simpleBinaryBackendProcess(args, new <Id>Backend())` from
  `backends/shared/simpleBinaryBackend.ts`. The helper wraps the
  spawn descriptor in `AcpBackendProcess` for you.
- **In-process / SDK track** (claude) — the agent ships an
  in-process SDK. Put the `BackendProcess` implementation in `sdk/`
  if any logic is reusable (translator, debug tap) and
  have the descriptor's `createBackendProcess(args)` construct it
  directly.

Then in either case:

1. Create `backends/<id>/` with:
   - `descriptor.ts` — `export const <Id>BackendDescriptor: BackendDescriptor = {…}`
   - any backend-specific UI (install modal, settings panel,
     permission modal) co-located here
   - `Backend.ts` (subprocess track only)
2. Import the descriptor directly from `descriptor.ts` and add it to
   `backends/registry.ts`.
3. Settings: store backend-specific config under `agentMode.backends.<id>`
   (extend `CopilotSettings.agentMode.backends` in `src/settings/model.ts`).
4. Done. **No edits to `acp/`, `session/`, `sdk/`, or `ui/` should be
   required.** If you need one, the boundary is leaking — extend the
   descriptor surface instead.

## Adding a new layer

1. Create `src/agentMode/<layer>/`.
2. Add an entry under `boundaries/elements` in root `eslint.config.mjs` and a
   corresponding rule in `boundaries/dependencies`.
3. Re-export from `src/agentMode/index.ts` if it should be visible to
   plugin host code.
4. Update this doc.

## What lives where (cheatsheet)

- "Backend-agnostic contract — `BackendProcess`, `BackendDescriptor`,
  the session-domain types, `MethodUnsupportedError`, debug sink,
  `translateBackendState` helper" → `session/`
- "ACP wire types, JSON-RPC subprocess plumbing, vault-backed ACP client,
  ACP↔domain translators" → `acp/` (the **only** layer that imports
  `@agentclientprotocol/sdk`)
- "In-process driver for an SDK that produces session-domain events
  natively" → `sdk/`
- "Helper used by more than one backend" → `backends/shared/`
- "Knows about a specific binary, install path, BYOK keys, vendor models" → `backends/<id>/`
- "React component or modal" → `ui/` (generic) or `backends/<id>/`
  (backend-specific)
- "Canonical-store skill discovery, symlink lifecycle, SKILL.md
  parser/serializer, Skills settings tab (reads `backends/registry.ts`
  for the brand list)" → `skills/`
- "Plugin-level wiring" → `index.ts` only

## Modals and dialogs

**Use Obsidian's native `Modal`** (from `obsidian`). It gives us correct
popout-window behavior, native header chrome, ESC handling, and visual
consistency with the rest of the plugin.

The standard pattern is in `src/components/modals/ConfirmModal.tsx` and
`src/agentMode/skills/ui/DeleteConfirmDialog.tsx`. If a surface must live
inside an existing React tree, keep its visual content as a presentational
component and host it from an Obsidian modal instead of introducing a second
modal system.

## BackendDescriptor surface

The descriptor is the contract `session/`, `sdk/`, and `ui/` rely on.

If a UI component needs something the descriptor doesn't expose, **add
it to the descriptor** — don't reach into a specific backend. The
descriptor will keep growing; that's by design.

## Debugging tips

### Inspect full Agent Mode frames

The **Agent Mode activity log** is on by default. Find it under **Settings → Copilot → Advanced → Debugging & support**. It stores full diagnostic payloads outside the vault, under the OS temporary directory, in per-session `session-*.ndjson` files and a shared `background.ndjson` file.

Each record keeps raw request, notification, result, error, or unparsed data. `sessionId` associates frames when known; `startsConversation` marks only an outgoing user prompt. A session file begins on the first prompt, so empty chats and model-catalog refreshes do not claim a slot. Up to five most recently active prompted sessions are retained alongside startup/background evidence. No guarantee is made that middle frames or every model/mode change will survive.

Each managed file is capped at 4 MiB and compacts to 3 MiB, retaining opening and newest complete frames with omission markers. Legacy `acp-frames.ndjson` and `acp-frames.old.ndjson` files are preserved and permission-narrowed. Before any new prompted session exists, a report may include the old current log; the rotated log is available locally through Open.

Use **Open** to open the folder. To inspect a log, choose a file inside it:

```bash
LOG="<path to a file inside the folder opened by Settings → Copilot → Advanced → Debugging & support → Agent Mode activity log>"
jq -r .method "$LOG" | sort | uniq -c | sort -rn
```

**Clear** removes only managed diagnostic files and those two exact legacy files, not chats, notes, unrelated files, or the folder itself. Turning logging off stops capture and excludes the log from reports with an explanation; it does not erase existing files.
