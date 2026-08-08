# Subscription-based models via agent backends (GitHub Copilot through opencode)

> Status: **Design / not yet implemented.** Captured as a forward-looking design doc.
> Scope decisions confirmed with the team (see "Decisions" below).

## Context

Today obsidian-copilot's model management is **API-key-centric** (BYOK): a user pastes a key, we
store it in the keychain, and our LangChain stack calls the provider directly. That covers "simple
chat" well. It does **not** cover **subscription-based models** — e.g. GitHub Copilot, where the
credential is an OAuth token tied to a paid subscription rather than a long-lived API key.

The opportunity: our **agent backends** (`opencode`, `claude-code`, `codex`) are external CLIs we
spawn and talk to over ACP (Agent Client Protocol). **opencode already natively supports GitHub
Copilot** (and other OAuth/subscription providers) via its built-in `github-copilot` plugin. So we
do not need to re-implement Copilot's device flow + token exchange in-process (the old
`src/LLMProviders/githubCopilot/*` runtime, whose UI was already deleted and which the cleanup TODO
marks for removal). Instead we **let the external CLI own the credential** and surface a thin auth UI.

## Decisions

- **Delegate auth to opencode** (the CLI owns and persists the token). We only trigger/surface login.
- **Build a general per-backend "subscription" framework**, not a Copilot-only hack — one abstraction
  that also covers claude-code/codex sign-in status, with Copilot-via-opencode as the first instance.
- **Simple chat stays BYOK.** Subscription models live entirely in the agent-backend world. This also
  unblocks deleting the legacy in-process Copilot runtime.

**Intended outcome:** a user with a GitHub Copilot subscription clicks "Sign in" in a per-backend
subscription card, completes the GitHub device flow, and their Copilot models become selectable in
the opencode backend's model picker — with no API key and no changes to simple chat.

---

## Key findings that shape the design

(References to `opencode .../` are paths in the sibling opencode repo, captured during investigation.)

1. **Auth cannot be driven over ACP.** opencode's ACP `authenticate()` throws "Authentication not
   implemented" (`opencode .../src/acp/agent.ts:580`). Its `initialize` response advertises a single
   auth method that points at the CLI, and — when the client sets
   `clientCapabilities._meta["terminal-auth"] === true` — returns
   `_meta["terminal-auth"] = { command: "opencode", args: ["auth","login"], label }`
   (`agent.ts:534-577`). **The sanctioned delegation path is "run the CLI login command."**

2. **Targeted, scriptable login exists.** `opencode providers login --provider github-copilot
--method "Login with GitHub Copilot"` skips interactive provider/method selection
   (`.../cli/cmd/providers.ts:283-302`). The remaining interaction is just the device flow: it prints
   the verification URL + `Enter code: XXXX-XXXX` to stdout, polls in the background, and on success
   persists an `oauth` entry to opencode's `auth.json` (`.../auth/index.ts`, key `"github-copilot"`).
   opencode also reads `OPENCODE_AUTH_CONTENT` env as an override of `auth.json`.

3. **Models flow the _opposite_ direction from what you'd expect.** opencode reports the full
   `availableModels` (incl. `github-copilot/*` once authed) in the `session/new` ACP response; we
   curate it for the picker and push back only the single active selection via `session/set_model`
   (+ sticky `config.model` at spawn). See "Model surfacing" below.

4. **This matches our existing agent pattern.** `claude-code`/`codex` already delegate auth to their
   own CLI login state (`~/.claude`, `~/.codex/auth.json`); we inject nothing. opencode-Copilot is the
   same shape — a generalizable "subscription card" is a natural fit.

5. **Seams already exist (stubbed).** `BackendDescriptor` (`src/agentMode/session/descriptor.ts`)
   already carries optional per-backend hooks and a per-backend `SettingsPanel`. `AgentSetupApi`
   (`src/modelManagement/setup/AgentSetupApi.ts`) is the stubbed enrollment seam meant to create
   `origin:"agent"` providers + `ConfiguredModel`s + `backends[agentType].enabledModels`. The ACP
   client (`src/agentMode/acp/AcpBackendProcess.ts:181-205`) reads `agentCapabilities` at
   `initialize` but currently **ignores `authMethods`** — that's where discovery plugs in.

---

## Design

### 1. Per-backend auth capability contract (the general framework)

Add an optional auth contract to `BackendDescriptor` (`src/agentMode/session/descriptor.ts`),
following the existing optional-hook pattern (`getModeMapping?`, `applyInitialSessionConfig?`):

- `getAuthStatus(plugin): Promise<BackendAuthStatus>` — `{ kind: "connected" | "disconnected" |
"unknown", label?: string }`. opencode infers `connected` from presence of `github-copilot/*` in
  the last `availableModels` (no file coupling), optionally enriched by reading opencode's
  `auth.json`; claude/codex infer from their CLI login state (existing `ClaudeSettingsPanel` already
  surfaces this).
- `getAuthMethods(): BackendAuthMethod[]` — sourced from the ACP `initialize` `authMethods` (newly
  read & stored in `AcpBackendProcess.start()`), each carrying the delegated `{ command, args, label }`.
- `initiateAuth(method, handlers): Promise<void>` — runs the delegated login (see §2) and reports
  progress (device URL/code, success/failure) back to the UI.
- `signOut(method): Promise<void>` — opencode: `opencode providers logout --provider github-copilot`.

Default-omitting these keeps every existing backend behavior unchanged; backends opt in.

### 2. Delegation mechanism for opencode (recommended)

- Advertise `clientCapabilities._meta["terminal-auth"] = true` in `AcpBackendProcess` initialize so
  opencode returns the exact login command in `authMethods`.
- On "Sign in", spawn `opencode providers login --provider github-copilot --method "Login with
GitHub Copilot"` (targeted form — required because Obsidian can't render opencode's interactive TUI
  provider/method prompts). Stream stdout, parse the `verification_uri` and `Enter code: …` lines,
  and render them in the subscription card. Resolve on process exit (success/failure).
- opencode persists the token to its own `auth.json`. On the next `session/new`, Copilot models
  appear. We may need to restart/refresh the opencode backend process to pick up new auth.
- **Risk:** stdout scraping is brittle to CLI output changes. _Alternative_ (documented, not chosen):
  run `opencode serve` and drive the structured HTTP endpoints `POST /provider/:id/oauth/authorize`
  - `/oauth/callback` — cleaner contract but adds a managed server process. Start with the CLI path.

### 3. Subscription card UI

Render a per-backend card showing connection status + actions (`Sign in` / `Re-authenticate` /
`Sign out`), plus the live device-code prompt during login. Home: the backend's existing
`SettingsPanel` (`src/agentMode/backends/opencode/OpencodeSettingsPanel.tsx`) and/or the redesign's
model-management backend tab (`src/modelManagement/ui/`). Recommend the model-management backend tab
to align with the redesign, reusing the planned "subscription card" from the tech spec.

**Constraint:** opencode discards the GitHub identity for Copilot (`expires:0`, no account stored),
so the card shows **Connected / Not connected**, not "Authenticated as <email>", unless we add an
extra `read:user` lookup ourselves later.

### 4. Model surfacing (how enabled models reach opencode)

The enabled list is **host-side curation**; opencode is told only the active selection.

- **Discovery:** opencode returns full `availableModels` on `session/new`
  (`AcpBackendProcess.newSession` → `wireTranslate.ts`). Subscription models (`github-copilot/*`)
  are discovered by opencode itself once authed — **we inject nothing** for them. (BYOK models, by
  contrast, are pushed _into_ opencode via `OPENCODE_CONFIG_CONTENT` `config.provider.<id>.models`.)
- **Enrollment:** implement the stubbed `AgentSetupApi.registerAgentProvider` / `syncAgentModels` to
  snapshot the reported list into `origin:"agent"` `Provider` + `ConfiguredModel` rows and
  auto-enroll into `backends["opencode"].enabledModels`.
- **Curation:** the picker shows the enabled subset (`enabledModels` / `isModelEnabledByDefault`).
- **Selection:** the chosen model is pushed to opencode at runtime via ACP `session/set_model`
  (`<provider>/<model>[/<effort>]`), with a sticky default via `config.model` at spawn. opencode
  never receives the enabled _list_.

### 5. Phasing

1. **Framework contract** — add the optional auth methods to `BackendDescriptor`; read & store ACP
   `authMethods` in `AcpBackendProcess`; advertise `terminal-auth` capability. No behavior change yet.
2. **opencode Copilot login** — implement `initiateAuth`/`getAuthStatus`/`signOut` for opencode +
   the subscription card UI + device-code surfacing. End-to-end auth works.
3. **Enrollment** — implement `AgentSetupApi` so authed Copilot models persist into the model-mgmt
   registry and surface in the opencode picker via `enabledModels`.
4. **Generalize** — wire claude-code/codex status into the same card; remove the legacy in-process
   `src/LLMProviders/githubCopilot/*` runtime per the cleanup TODO.

---

## Critical files

- `src/agentMode/session/descriptor.ts` — add optional auth contract to `BackendDescriptor`.
- `src/agentMode/acp/AcpBackendProcess.ts:181-205` — read/store `authMethods`; advertise
  `terminal-auth` client capability; surface "auth required" errors.
- `src/agentMode/backends/opencode/{descriptor.ts,OpencodeBackend.ts,OpencodeSettingsPanel.tsx}` —
  opencode auth impl + login subprocess + card.
- `src/modelManagement/setup/AgentSetupApi.ts` — implement enrollment (currently throws).
- `src/modelManagement/ui/` — subscription card surface in the backend tab.
- (Phase 4 cleanup) `src/LLMProviders/githubCopilot/*`, `src/settings/model.ts:72-75`,
  `src/constants.ts`, `src/settings/v2/utils/modelActions.ts` — remove legacy Copilot runtime.

## Verification

- **Auth, end-to-end:** with the `opencode` CLI installed, click Sign in → device URL + code render
  in the card → complete in browser → card flips to Connected → opencode's `auth.json` gains a
  `github-copilot` oauth entry.
- **Models surface:** after auth, open a new opencode session (`session/new`) → `github-copilot/*`
  appear in the picker; selecting one drives `session/set_model` and a real completion succeeds.
- **Curation:** toggling a model off in settings removes it from the picker without affecting
  opencode's own discovery.
- **Isolation:** simple chat ("chat" backend) is unchanged and shows no Copilot entries.
- **Generality:** claude-code/codex render a status card (connected/not) using the same contract.
- **Tests:** unit-test the stdout device-code parser and `AgentSetupApi` enrollment (idempotent on
  `(agentType, providerType)`); follow the "pass data, not services" rule so the parser is testable
  in isolation.

## Open considerations / risks

- **stdout parsing brittleness** (mitigation: pin to the `--provider/--method` form; consider the
  HTTP `serve` path later if it proves fragile).
- **Backend restart** likely needed for the running `opencode acp` process to pick up new auth.
- **No email identity** for Copilot from opencode → card shows Connected/Not connected.
- **opencode's auth path** (`Global.Path.data/auth.json`) is platform-dependent; prefer ACP-inferred
  status over reading the file directly to avoid path coupling.
