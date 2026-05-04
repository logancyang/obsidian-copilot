# Agent Mode — layer rules

Six element types, strict imports. Enforced by `eslint-plugin-boundaries`
(see root `.eslintrc`). The list below mirrors `boundaries/elements` and
`boundaries/dependencies` exactly — when in doubt, the lint config wins.

1. **`session/`** — **the contract layer.** Owns `BackendProcess`,
   `BackendDescriptor`, `BackendId` (`session/types.ts`),
   `MethodUnsupportedError`, `JSONRPC_METHOD_NOT_FOUND`
   (`session/errors.ts`), and the shared debug NDJSON sink + payload
   formatter (`session/debugSink.ts`). Also hosts the backend-agnostic
   session, message store, UI-state bridge, and persistence manager.
   Receives a `BackendProcess` (not a concrete class) by DI from a
   `BackendDescriptor`. May import: `obsidian` + host only.
2. **`acp/`** — generic ACP runtime (subprocess, JSON-RPC connection,
   vault MCP client, JSON-RPC stream tap). Implements `BackendProcess`
   via `AcpBackendProcess`. May import: `session/` + host.
3. **`sdk/`** — in-process SDK adapters that implement
   `BackendProcess` directly, without a JSON-RPC subprocess. Today
   this hosts the Claude Agent SDK driver. May import: `session/` +
   host. **Does not import `acp/`** — `acp/` and `sdk/` are siblings.
4. **`backends/<id>/`** — one backend per folder. Exports a
   `BackendDescriptor` whose `createBackendProcess` returns a finished
   `BackendProcess`. May import: `acp/`, `sdk/`, `session/`, host,
   its own folder, and `backends/shared/` (a peer in this group, not
   a separate element type — any backend may import from it). May not
   import sibling backends, `ui/`, or `registry`.
5. **`backends/registry.ts`** — the only place that names every
   backend. May import: `backend`, `session`, host. Carved out as its
   own element so `ui/` can deep-import the registry without unlocking
   deep imports into individual backends.
6. **`ui/`** — backend-agnostic React UI. May import: `ui/`,
   `session/`, `registry`, host. **Does not import `acp/`** — strings
   like display names and model lists come from `BackendDescriptor`,
   never hardcoded; the registry is the only `backends/` path it
   touches.

Outside `agentMode/`: only `@/agentMode` (the `barrel`) is importable.
Deep imports fail lint.

## Why two adapters under one session

The contract lives in `session/types.ts` (`BackendProcess`,
`BackendDescriptor`) and `session/errors.ts`
(`MethodUnsupportedError`). `acp/AcpBackendProcess` wraps a JSON-RPC
subprocess; `sdk/ClaudeSdkBackendProcess` wraps an in-process async
generator. Both produce the same `SessionNotification` stream and
satisfy the same `BackendProcess` interface, so `AgentSession` stays
oblivious. Crucially, **neither adapter imports the other**, and
`session/` doesn't import either — it consumes the
`BackendProcess` interface only and lets the descriptor's
`createBackendProcess` factory hand it a finished process.

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
2. Add an entry under `boundaries/elements` in root `.eslintrc` and a
   corresponding rule in `boundaries/dependencies`.
3. Re-export from `src/agentMode/index.ts` if it should be visible to
   plugin host code.
4. Update this doc.

## What lives where (cheatsheet)

- "Backend-agnostic contract — `BackendProcess`, `BackendDescriptor`,
  `MethodUnsupportedError`, debug sink" → `session/`
- "ACP types or process spawning, JSON-RPC, vault MCP client" → `acp/`
- "In-process driver for an SDK that mimics ACP semantics" → `sdk/`
- "Helper used by more than one backend" → `backends/shared/`
- "Knows about a specific binary, install path, BYOK keys, vendor models" → `backends/<id>/`
- "React component or modal" → `ui/` (generic) or `backends/<id>/`
  (backend-specific)
- "Plugin-level wiring" → `index.ts` only

## BackendDescriptor surface

The descriptor is the contract `session/`, `sdk/`, and `ui/` rely on.
Authoritative definition: **`src/agentMode/session/types.ts`**
(`interface BackendDescriptor`). It groups roughly into:

- **identity** — `id`, `displayName`, `meta` (vendor `_meta` parser)
- **install** — `getInstallState`, `subscribeInstallState`,
  `openInstallUI`, `onPluginLoad`
- **process construction** — required `createBackendProcess(args)`
  returning a `BackendProcess`. Both tracks use the same factory:
  subprocess backends typically delegate to
  `simpleBinaryBackendProcess` from `backends/shared/`; in-process
  adapters construct their `BackendProcess` directly.
- **models** — `getStaticInitialState`, `probeInitialState`,
  `filterCopilotModels`, `getPreferredModelId`,
  `persistModelSelection`, `copilotModelKeyToAgentModelId`,
  `agentModelIdToCopilotProvider`, `isModelEnabledByDefault`
- **modes** — `getModeMapping`, `persistModeSelection`,
  `applyInitialSessionConfig`
- **effort** — `parseEffortFromModelId`, `composeModelId`,
  `findEffortConfigOption`, `persistEffortSelection`
- **plan** — `isPlanModePlanFilePath`, `bodylessPlanExitToolNames`
- **probe sessions** — `getProbeSessionId`, `persistProbeSessionId`
- **UI** — `SettingsPanel`

If a UI component needs something the descriptor doesn't expose, **add
it to the descriptor** — don't reach into a specific backend. The
descriptor will keep growing; that's by design.

## Debugging tips

### Inspect full Agent Mode frames

The default debug log truncates each frame's payload to 400 chars. For full
payloads — large tool results, MCP responses, attachments — turn on
**Settings → Advanced → Log Full ACP Frames**.

When enabled, every parsed frame is appended as one NDJSON line to:

```text
<vault>/copilot/acp-frames.ndjson
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
# count frames by method
jq -r .method copilot/acp-frames.ndjson | sort | uniq -c | sort -rn

# inspect every session/update payload
jq -c 'select(.method=="session/update") | .payload' copilot/acp-frames.ndjson

# only frames for one backend
jq -c 'select(.tag=="claude-sdk")' copilot/acp-frames.ndjson
```

The file is append-only and bounded — at 50 MB it rotates to
`copilot/acp-frames.old.ndjson` (overwriting any prior `.old`). Use the
**Open** / **Clear** buttons in the same settings section, or delete the
files directly. Disable the toggle when not actively debugging — the writes
are cheap but the file grows fast under heavy tool use.
