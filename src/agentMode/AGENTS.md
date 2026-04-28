# Agent Mode — layer rules

Four layers, strict imports. Enforced by `eslint-plugin-boundaries` (see root `.eslintrc`).

1. **`acp/`** — generic ACP runtime (subprocess, connection, vault client).
   Imports: `obsidian` + `@agentclientprotocol/sdk`. Never imports from
   `session/`, `backends/`, or `ui/`.
2. **`session/`** — backend-agnostic session, store, UI-state bridge.
   Imports: `acp/` only. Receives the `AcpBackend` instance via DI from a
   `BackendDescriptor`.
3. **`backends/<id>/`** — one backend per folder. Implements `AcpBackend`
   and exports a `BackendDescriptor`. May import from `acp/` and
   `session/`. **Must not** import from sibling backends or from `ui/`.
4. **`ui/`** — backend-agnostic React UI. Imports: `session/` +
   `backends/registry.ts` (never deep-imports a specific backend).
   Strings like display names and versions come from `BackendDescriptor`,
   never hardcoded.

Outside `agentMode/`: only `@/agentMode` (the barrel) is importable. Deep
imports fail lint.

## Adding a new backend

1. Create `backends/<id>/` with:
   - `Backend.ts` — `class implements AcpBackend`
   - `descriptor.ts` — `export const <Id>BackendDescriptor: BackendDescriptor = {…}`
   - `index.ts` — re-exports the descriptor
   - any backend-specific UI (install modal, settings panel) co-located here
2. Add the entry to `backends/registry.ts`.
3. Settings: store backend-specific config under `agentMode.backends.<id>`
   (extend `CopilotSettings.agentMode.backends` in `src/settings/model.ts`).
4. Done. **No edits to `acp/`, `session/`, or `ui/` should be required.**
   If you need one, the boundary is leaking — fix the descriptor surface
   instead.

## Adding a new layer

1. Create `src/agentMode/<layer>/`.
2. Add an entry under `boundaries/elements` in root `.eslintrc` and a
   corresponding rule in `boundaries/element-types`.
3. Re-export from `src/agentMode/index.ts` if it should be visible to
   plugin host code.

## What lives where (cheatsheet)

- "ACP types or process spawning" → `acp/`
- "Manages the conversation, session lifecycle, message store" → `session/`
- "Knows about a specific binary, install path, BYOK keys" → `backends/<id>/`
- "React component or modal" → `ui/` (generic) or `backends/<id>/`
  (backend-specific)
- "Plugin-level wiring" → `index.ts` only

## BackendDescriptor surface

```ts
interface BackendDescriptor {
  id: BackendId;
  displayName: string;
  getInstallState(settings): InstallState;
  subscribeInstallState(plugin, cb): () => void;
  openInstallUI(plugin): void;
  createBackend(plugin): AcpBackend;
  SettingsPanel?: React.FC<{ plugin; app }>;
  onPluginLoad?(plugin): Promise<void>;
}
```

Each method is the contract `session/` and `ui/` rely on. If a UI component
needs something the descriptor doesn't expose, **add it to the descriptor**;
don't reach into a specific backend.

## Debugging tips

### Inspect full ACP JSON-RPC frames

The default ACP debug log truncates each frame's payload to 400 chars. For full
payloads — large tool results, MCP responses, attachments — turn on
**Settings → Advanced → Log Full ACP Frames**.

When enabled, every parsed frame is appended as one NDJSON line to:

```
<vault>/copilot/acp-frames.ndjson
```

Each line is a `FrameRecord` (`src/agentMode/acp/frameSink.ts`):

```ts
{ ts, dir: "→" | "←", tag, kind: "request" | "notif" | "result" | "error" | "raw",
  method, id, payload }
```

`dir` is from the plugin's perspective: `→` = sent to the agent,
`←` = received from the agent. `tag` is the backend id (e.g. `claude-code`,
`opencode`).

Useful queries:

```bash
# count frames by method
jq -r .method copilot/acp-frames.ndjson | sort | uniq -c | sort -rn

# inspect every session/update payload
jq -c 'select(.method=="session/update") | .payload' copilot/acp-frames.ndjson

# only frames for one backend
jq -c 'select(.tag=="claude-code")' copilot/acp-frames.ndjson
```

The file is append-only and bounded — at 50 MB it rotates to
`copilot/acp-frames.old.ndjson` (overwriting any prior `.old`). Use the
**Open** / **Clear** buttons in the same settings section, or delete the
files directly. Disable the toggle when not actively debugging — the writes
are cheap but the file grows fast under heavy tool use.
