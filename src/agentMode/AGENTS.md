# Agent Mode — layer rules

Six element types, strict imports. Enforced by `eslint-plugin-boundaries`
(see root `eslint.config.mjs`). The list below mirrors `boundaries/elements` and
`boundaries/dependencies` exactly — when in doubt, the lint config wins.

1. **`session/`** — **the contract layer.** Hosts the
   backend-agnostic session, message store, UI-state bridge,
   persistence manager.
2. **`acp/`** — the generic ACP runtime (subprocess, JSON-RPC connection,
   vault MCP client, JSON-RPC stream tap) —
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
  if any logic is reusable (translator, debug tap, MCP shim) and
  have the descriptor's `createBackendProcess(args)` construct it
  directly.

Then in either case:

1. Create `backends/<id>/` with:
   - `descriptor.ts` — `export const <Id>BackendDescriptor: BackendDescriptor = {…}`
   - `index.ts` — re-exports the descriptor
   - any backend-specific UI (install modal, settings panel,
     permission modal) co-located here
   - `Backend.ts` (subprocess track only)
2. Add the entry to `backends/registry.ts`.
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
- "ACP wire types, JSON-RPC subprocess plumbing, vault MCP client,
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

**Always prefer Obsidian's native `Modal`** (from `obsidian`) over the
Radix-based `Dialog` primitive in `@/components/ui/dialog`. The native
modal gives us correct popout-window behavior, native header chrome,
ESC handling, and visual consistency with the rest of the plugin.

The standard pattern (see `src/components/modals/ConfirmModal.tsx` and
`src/agentMode/skills/ui/DeleteConfirmDialog.tsx`):

Only reach for the Radix `Dialog` when the surface needs to live
_inside_ an existing React tree (e.g. nested inside another modal)
and spawning a separate Obsidian `Modal` would break the focus or
layout flow.

## BackendDescriptor surface

The descriptor is the contract `session/`, `sdk/`, and `ui/` rely on.

If a UI component needs something the descriptor doesn't expose, **add
it to the descriptor** — don't reach into a specific backend. The
descriptor will keep growing; that's by design.

## Debugging tips

### Inspect full Agent Mode frames

The default debug log truncates each frame's payload to 400 chars. For
diagnostic frame logs with larger payload summaries, turn on
**Settings → Advanced → Log Full Agent Mode Frames**.

When enabled, every parsed frame is appended as one NDJSON line outside the
vault, under the OS temp directory:

```text
<tmp>/obsidian-copilot/acp-frames/<vault-hash>/acp-frames.ndjson
```

Each line is a `FrameRecord` (`src/agentMode/session/debugSink.ts`):

```ts
{ ts, dir: "→" | "←", tag, kind: "request" | "notif" | "result" | "error" | "raw",
  method, id, payload }
```

`dir` is from the plugin's perspective: `→` = sent to the agent,
`←` = received from the agent. `tag` is the backend id (e.g. `claude-sdk`,
`opencode`, `codex`). The ACP runtime (`acp/debugTap`) and the Claude SDK
adapter (`sdk/sdkDebugTap`) both feed the shared sink, so JSON-RPC and
SDK turns appear in the same file.

Useful queries:

```bash
LOG="<path shown in Settings → Advanced → Agent Mode Frame Log>"

# count frames by method
jq -r .method "$LOG" | sort | uniq -c | sort -rn

# inspect every session/update payload
jq -c 'select(.method=="session/update") | .payload' "$LOG"

# only frames for one backend
jq -c 'select(.tag=="claude-sdk")' "$LOG"
```

The file is append-only and bounded. Oversized individual frames are replaced
with a `__truncated` summary, and at 50 MB the file rotates to
`acp-frames.old.ndjson` (overwriting any prior `.old`) in the same temp
folder. Use the **Open** / **Clear** buttons in the same settings section, or
delete the files directly. Disable the toggle when not actively debugging.
