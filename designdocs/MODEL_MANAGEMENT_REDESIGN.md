# Model Management Redesign — Design Spec

**Status:** Aligned to Claude Design bundle (May 2026)
**Source of truth:** `copilot-model-settings/project/index.html` exported from Claude Design — specifically the **★ Final flow** in `screens/final.jsx`, which consolidates the picked variants and fills two gap screens (unified Configure Provider, Add Custom Model).
**Scope:** Provider keys, model catalog, model selection, model visibility, agent backend configuration. Everything a user does to answer the question "what LLM is this plugin going to call?"
**Out of scope:** Embedding model configuration (separate panel, untouched), chat UI redesign, command palette redesign, Plus/license management.

---

## 0. What this product is, in one paragraph

Copilot for Obsidian is a plugin that adds AI capabilities (chat, autocomplete, semantic search, custom commands, agent workflows) to the Obsidian note-taking app. It supports many LLM providers — OpenAI, Anthropic, Google, Groq, Mistral, xAI, DeepSeek, OpenRouter, Azure, AWS Bedrock, GitHub Copilot, Ollama, plus arbitrary OpenAI-compatible endpoints. Users configure provider API keys and select which models they want the plugin to use. The plugin runs in both Obsidian desktop and Obsidian mobile, but the redesigned settings UI is desktop-shaped (mobile gets a stripped-down view of the same surfaces — see §10.1).

The plugin has **two execution modes** that share the same model pool:

- **Chain mode** (chat / commands) — single-turn LLM calls via LangChain. Used for chat, custom command execution, quick prompts. **Works on mobile.** Always available.
- **Agent mode** — multi-turn agent sessions with tool use, file ops, sessions. Runs by spawning an external binary (OpenCode, Claude Code, or Codex). **Desktop-only.**

Today, model configuration is split across three duplicated UI surfaces (Basic Settings provider key panel, Models Settings table, Agent Mode model curation). This redesign consolidates them into a single **BYOK** tab plus a dedicated **Agent** tab.

---

## 1. Goals & Non-Goals

### Goals

1. **One canonical place to configure providers, keys, and models.** Currently three places; one BYOK tab now.
2. **A user can complete first-run setup in under 60 seconds.** Welcome modal → pick provider → enter key + pick models in one screen → done.
3. **OpenRouter and similar large-catalog providers don't drown the UI.** Hundreds of models compress into one searchable, filterable list with sticky group headers per upstream provider.
4. **Visibility curation exists** — the row checkbox in the BYOK table hides a model from the chat input picker without removing it from the registry.
5. **Local providers (Ollama, custom OpenAI-compatible endpoints) are first-class** — they appear as top-level providers in the same list, not nested under a "Custom" wrapper.
6. **Non-BYOK models (OpenCode-provided free models like "Big Pickle", and Copilot Plus paid models like "Copilot Plus Flash") appear naturally in the same table** as ordinary rows; the row's "provider" column carries the OpenCode / Copilot Plus origin.
7. **Offline-capable.** The plugin ships with a bundled model catalog so users without internet can still see providers and configure keys.
8. **The Configure Provider modal is one component for three jobs** — adding a BYOK provider, adding a custom endpoint, and editing an existing provider. Same fields, same layout; only the footer + subhead adapt.

### Non-Goals

- Embedding model management (separate, unchanged).
- Per-model temperature / max_tokens / system prompt overrides. **Removed entirely.** All chains use sensible defaults.
- A user-managed "Default chat model" pointer. The BYOK panel no longer surfaces this — chain-mode chat uses whatever the user last selected in the chat input picker.
- Reordering models in a custom order (drag-to-reorder is out). Sort defaults are provider order then alphabetical.
- Adding any new agent backends beyond OpenCode / Claude Code / Codex.
- Visual restyling of the surrounding Obsidian settings shell.

---

## 2. Conceptual model

### Two execution modes, one model pool

```
                   ┌──────────────────────────────┐
                   │   ONE BYOK registry          │
                   │   (the unified BYOK tab)     │
                   └──────────┬───────────────────┘
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
        Chain mode                       Agent mode
        (LangChain)                      (External backend)
              │                                │
              │                          ┌─────┴─────┬─────────┐
              ▼                          ▼           ▼         ▼
       Chat, Custom               OpenCode    Claude Code   Codex
       Commands, Quick            (BYOK)      (sub-only)    (sub-only)
       Prompts (mobile +
       desktop)
```

### What lives in the BYOK registry

Models the user has explicitly enabled. Each model in the registry has one of four origins:

- **BYOK** — User entered a provider API key, then picked which of that provider's models they want enabled. Most common.
- **Local/Custom** — User defined a custom OpenAI-compatible endpoint (e.g. Ollama at `http://localhost:11434`) and added one or more models running there. Appears as a top-level provider, **not** nested under a "Custom" wrapper.
- **OpenCode-provided** — Free models bundled with OpenCode (e.g. **Big Pickle**). No key required. Only available when OpenCode is installed. Only usable in agent mode.
- **Copilot-provided** — Paid models served by Copilot for **Plus subscribers** (e.g. **Copilot Plus Flash**). No BYOK key required — gated by the user's Copilot Plus license. Routed through OpenCode at runtime. Only usable in agent mode.

OpenCode-provided and Copilot-provided models appear as ordinary rows in the BYOK table (provider column reads "OpenCode" or "Copilot Plus"). They are **not** rendered as special pinned sections — the table treats them like any other row, just sorted to the top.

### Capability badges

Every model carries up to two capability badges:

- **💬 chat** — can be called via LangChain. Works in chat, custom commands, mobile.
- **🤖 agent** — can be selected as the model an agent backend runs.

Examples:

| Model              | Provider       | 💬 chat | 🤖 agent |
| ------------------ | -------------- | :-----: | :------: |
| Claude Sonnet 4.5  | Anthropic      |    ✓    |    ✓     |
| GPT-5              | OpenAI         |    ✓    |    ✓     |
| llama3.2           | Ollama (local) |    ✓    |    ✓     |
| Big Pickle         | OpenCode       |    ✗    |    ✓     |
| Copilot Plus Flash | Copilot Plus   |    ✗    |    ✓     |

In the chat input model picker, models are grouped by agent backend; selecting a model auto-selects the backend. This redesign does not change the chat input picker.

### Agent backend special case (Claude Code / Codex)

OpenCode is BYOK — it uses the models in the BYOK registry, augmented by the OpenCode-provided free models and (for Plus subscribers) the Copilot Plus paid models.

**Claude Code and Codex are different.** They are subscription-based binaries with their own bundled model lists, authenticated by the user's Anthropic/OpenAI subscription (not the BYOK keys). They cannot accept arbitrary models. So:

- The BYOK registry does **not** include Claude Code's or Codex's models.
- Each of those backends has its own **visibility checklist** inside its Agent sub-tab to hide models from that backend's picker (e.g. "I never want Claude Haiku to appear").
- Switching the active agent backend changes which catalog the agent model picker reads from.

### Catalog source priority (one source at a time, never merged)

When the BYOK panel loads, it picks ONE source for "available models per provider":

1. **OpenCode binary present and reachable** → ask OpenCode for its catalog. Includes OpenCode-provided free models (Big Pickle, etc.), Copilot Plus paid models when the user has a Plus license, any custom providers previously registered, and the bundled `models.dev` snapshot OpenCode ships with.
2. **OpenCode not installed** → use the plugin-bundled `models.dev` snapshot. No 🤖 badges shown on cloud BYOK models (because no agent is available). OpenCode-provided and Copilot Plus rows are absent (they require OpenCode).

**No live refresh from `models.dev/api.json`.** The catalog is whatever ships with the plugin (bundled snapshot) or whatever OpenCode provides (when installed). New models become available on plugin update or OpenCode update. No "Refresh catalog" button, no daily background fetch, no network dependency for the catalog.

The bundled snapshot is tree-shaken to ~20 supported providers (Anthropic, OpenAI, Google, Groq, Mistral, xAI, DeepSeek, OpenRouter, Cohere, Azure, AWS Bedrock, GitHub Copilot, Together, Fireworks, Perplexity, plus a few more). For providers outside that set, the user can add them as a custom provider with manual model entry (via Add Custom Model).

---

## 3. User requirements (jobs to be done)

The redesigned UI must let a user accomplish every one of these:

### First-run setup

- **JTBD-1.** As a new user on desktop, get to a working agent in under 60 seconds via one of three paths: use an existing Claude Code / Codex subscription, bring my own provider key, or subscribe to Copilot Plus.
- **JTBD-2.** As a new user, understand that Copilot is **agent-first** — the welcome modal surfaces three primary paths; there is no secondary "skip agent" link.

### Provider key management

- **JTBD-4.** Enter, edit, paste, and remove a provider API key.
- **JTBD-5.** Verify that a key works (a `[Test]` affordance, or implicit on `[Verify & save]`).
- **JTBD-6.** See which providers have keys configured at a glance (via the BYOK table's provider column, and via `[Manage providers]`).
- **JTBD-7.** Get a clear error when a key is invalid, expired, or has insufficient permissions.

### Model selection (enabling models)

- **JTBD-8.** After entering a provider key, browse the models that provider offers and choose which to enable — **in the same screen as the key entry** (Configure Provider).
- **JTBD-9.** Add a model from a provider that has many models (like OpenRouter, with hundreds) without the UI becoming unscannable.
- **JTBD-10.** Quickly hide a model I no longer want, without removing my provider key (uncheck the row's visibility checkbox).
- **JTBD-11.** Remove a model entirely from the registry (kebab → Remove from list).
- **JTBD-12.** See, for each enabled model, where it works (chat, agent, both).
- **JTBD-13.** Add a model that isn't in the catalog (preview, fine-tune, private deployment) via Add Custom Model — works for **any** provider.

### Custom / local providers

- **JTBD-14.** Add a local Ollama instance with one or more models, in a single flow.
- **JTBD-15.** Add a custom OpenAI-compatible endpoint (e.g. self-hosted vLLM, a colleague's Tailscale-hosted server).
- **JTBD-16.** Edit a custom provider's base URL after adding it (via the row kebab → Configure provider → edit state).
- **JTBD-17.** Have local models work in both chat and (when desktop + OpenCode installed) agent.

### Defaults

- **JTBD-18.** Pick a **Default Agent Model per agent backend** — one each for OpenCode, Claude Code, Codex. Filtered to 🤖-capable models for that backend. Used when starting an agent session in that backend.
- **JTBD-19.** Pick a **Default Reasoning Effort per agent backend** (Min / Low / Med / High) for reasoning-capable models.

(There is **no** "Default Chat Model" picker. Chain-mode chat uses the model the user last selected in the chat input.)

### Agent backend configuration

- **JTBD-20.** Pick which agent backend is **active**: OpenCode (recommended), Claude Code, or Codex. The active backend is set via `[Use this backend]` in the viewed sub-tab's Status card — not via sub-tab selection.
- **JTBD-21.** Install the OpenCode binary from inside the plugin if I don't have it yet.
- **JTBD-22.** Point the plugin at an existing binary location, or detect one automatically.
- **JTBD-23.** When using Claude Code or Codex, curate which of that backend's bundled models show up in the agent model picker dropdown.
- **JTBD-24.** Switch the viewed backend (sub-tab) without changing the active backend, so I can re-authenticate or pre-configure another backend without disruption.

### Visibility & cleanup

- **JTBD-25.** Hide models I don't want cluttering the chat input's model picker dropdown, without removing them from the registry (uncheck the row checkbox).
- **JTBD-26.** Bulk-remove a provider's models by removing the provider from Configure Provider's edit footer.

### Offline

- **JTBD-27.** Configure providers and add models when my machine has no internet, using the bundled catalog that ships with the plugin.

### Mobile

- **JTBD-28.** On mobile, see the BYOK table without 🤖 badges and without OpenCode / Copilot Plus rows. Agent tab and Welcome modal are hidden. Mobile reuses the desktop BYOK panel with agent surfaces hidden.

---

## 4. Information architecture

Settings is rendered inside Copilot's settings modal — a horizontal tab strip at the top of the modal, with the content area scrolling beneath. Modal width is ~1320px (see §10.3).

The Model Management redesign occupies **two tabs** in the settings modal, plus **one standalone modal** for first-run welcome.

### Tab: **BYOK** (renamed from "Models")

The unified registry. A flat table of every model the user has enabled, sorted across all providers (OpenCode-provided, Copilot Plus, BYOK, custom). Provider configuration lives in a separate Configure Provider modal reached via the row kebab.

The label is **"BYOK"** (Bring Your Own Key) — chosen to make the user's mental model explicit ("these are my keys/models") and to distinguish from the per-backend bundled-model lists in the Agent tab.

### Tab: **Agent** (desktop only)

Backend selection (OpenCode / Claude Code / Codex) shown as **sub-tabs at the top of the panel**, not a radio. Sub-tab selection ≠ active backend (see §6.2). Per-backend configuration includes: binary path, authentication (CC/Codex only), default agent model, default reasoning effort, and for CC/Codex a visibility checklist of bundled models.

### Standalone modal: **Welcome**

First-run only. Lives outside the settings modal — overlays the entire Obsidian window with a dimmed app silhouette underneath. Three primary tiles: "Use my existing subscription", "Bring my own key", "Subscribe to Copilot Plus". No "skip agent" link.

The existing **Chat & Commands** tab is unchanged by this redesign. The chat input's model picker continues to read from the unified BYOK registry, grouped by agent backend.

---

## 5. The BYOK panel (detailed)

This is the centerpiece. Mockup priorities are highest for this screen.

The panel has **two visual states**: **empty** (no providers added yet) and **populated** (one or more providers added). Providers are added via the **[+ Add provider]** dialog (§7.1), then configured/edited via the **Configure Provider** modal (§7.2). OpenCode-provided and Copilot Plus-provided models auto-appear as rows when their preconditions are met.

### 5.1 Anatomy — empty state

```
┌─────────────────────────────────────────────────────────────────┐
│ BYOK                                                            │
│ Add providers and choose which models you want available        │
│ throughout Copilot.                                             │
│                                                                 │
│             ┌─────────────────────────────────────┐             │
│             │                                     │             │
│             │   No providers added yet.           │             │
│             │                                     │             │
│             │   Add a provider to pick from its   │             │
│             │   models, or add a custom endpoint  │             │
│             │   (Ollama, self-hosted, etc.)       │             │
│             │                                     │             │
│             │        [ + Add provider ]           │             │
│             │                                     │             │
│             └─────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

The only CTA is `[+ Add provider]`. No provider shortcut buttons — selection happens inside the Add Provider dialog (§7.1).

### 5.2 Anatomy — populated state (flat table)

```
┌─────────────────────────────────────────────────────────────────┐
│ BYOK                            [Manage providers] [+ Add prov] │
│ All enabled models. Filter, sort, toggle visibility.            │
│                                                                 │
│ [🔍 Filter models…]  [All] [💬 chat] [🤖 agent] [local]         │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │   MODEL · PROVIDER             CAPABILITY    META           │ │
│ ├─────────────────────────────────────────────────────────────┤ │
│ │ ☑ Big Pickle · OpenCode        🤖            Free           │ │
│ │ ☑ Copilot Plus Flash · …       🤖            Plus           │ │
│ │ ☑ Claude Sonnet 4.5 · Anthropic 💬 🤖        200k · Vision ⋯│ │
│ │ ☑ Claude Opus 4.1 · Anthropic   💬 🤖        200k · Reason  │ │
│ │ ☑ Claude Haiku 4.5 · Anthropic  💬 🤖        200k · Fast    │ │
│ │ ☑ GPT-5 · OpenAI                💬 🤖        400k · Vision  │ │
│ │ ☑ llama3.2 · Ollama (local)     💬 🤖        local · 8B     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ 7 enabled · 124 available in catalog                            │
└─────────────────────────────────────────────────────────────────┘
```

**Why a flat table instead of per-provider accordion sections?** Two reasons:

1. Power users with 30+ models can scan a single sorted list faster than 5+ collapsible cards.
2. Provider configuration belongs in its own dedicated modal, not in the line-of-sight of users who just want to find a model. The Configure Provider modal (§7.2) lives one click away via the row kebab.

**Ordering rule.** OpenCode-provided rows appear first, then Copilot Plus rows, then BYOK and custom-provider rows grouped by provider in the order the user added them. The user cannot drag-to-reorder.

### 5.3 Header controls

Top-right of the populated table:

- **[+ Add provider]** — primary action. Opens Add Provider dialog (§7.1).
- **[Manage providers]** — ghost button. Opens a small list of every configured provider with a "Configure →" link for each. Useful when you want to change a key but don't have a specific model row to kebab into.

Below the header, a filter bar:

- **Search box** — fuzzy match against model name and provider.
- **Capability chips** — `All` / `💬 chat` / `🤖 agent` / `local`. Click to filter; multi-select.

Footer of the panel: a muted line showing `<N> enabled · <M> available in catalog`.

### 5.4 Model row anatomy

Each row in the flat table:

- **Checkbox** — visibility toggle. Checked = visible in the chat input's model picker dropdown. Unchecking **does not** remove the model from the registry — it just hides it from the picker.
- **Model display name** (provider's preferred name, e.g. "Claude Sonnet 4.5", not the API id `claude-sonnet-4-5-20250929`) · **Provider** (muted, smaller, joined by `·`).
- **Capability badges** — `💬 chat` and/or `🤖 agent` pills.
- **Inline metadata** — context window, "Free", "Reasoning", "local", etc. — small, muted.
- **Kebab `⋯`** — opens the row menu:
  - **⚙ Configure provider (<Provider>) →** — primary action. Opens Configure Provider modal (§7.2) in `edit` state, scoped to this row's provider.
  - **↗ View model docs** — opens the provider's model page in a browser.
  - **— Remove from list** — removes the model from the registry. Inline confirmation. (Different from unchecking the visibility checkbox.)

Capability badges have a tooltip on hover explaining what they mean.

There is **no ★ Default pill** on rows. The BYOK panel does not surface a "default chat model" — defaults are an Agent-tab concern (per backend), and chain-mode chat uses whatever the user last selected in the chat input.

### 5.5 OpenCode / Copilot Plus rows

When OpenCode is detected, OpenCode-provided models (e.g. Big Pickle) appear as flat-table rows with provider = "OpenCode", caps = `[🤖]`, meta = "Free". When the user has a Copilot Plus license, Copilot Plus-provided models (e.g. Copilot Plus Flash) appear as rows with provider = "Copilot Plus", caps = `[🤖]`, meta = "Plus".

Both kinds of rows behave like any other row (visibility checkbox, capability badges, meta). The kebab menu omits "Configure provider" (provider is system-managed — nothing to configure) but keeps "View model docs" and "Remove from list" (removing hides until the source re-adds it).

When OpenCode isn't installed, OpenCode-provided rows do not appear, and an inline banner at the top of the BYOK panel reads: _"OpenCode isn't installed yet. Models with the 🤖 badge will work once you install it. → Go to Agent tab."_ Copilot Plus rows are similarly absent when the license isn't active; the Welcome modal already pushes Plus to net-new users.

### 5.6 Mobile differences

- 🤖 badges hidden everywhere.
- OpenCode and Copilot Plus rows hidden (no agent backend → no consumer).
- Header text changes to "Choose which models you want available for chat."
- Single-column layout, larger touch targets.

---

## 6. The Agent tab (detailed)

Desktop only. Hidden on mobile. There is **no "agent mode" on/off toggle** — desktop is always agent-capable.

### 6.1 Anatomy

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent                                                           │
│ Run multi-turn agent sessions with tool use and file edits.     │
│                                                                 │
│ [ ▶ OpenCode ]  [ Claude Code ]  [ Codex ]                      │
│                                                                 │
│ ┌─ Status ─────────────────────────────────────────────────┐    │
│ │ Status                              [✓ Active backend]   │    │
│ │ v0.4.2 at /usr/local/bin/opencode                        │    │
│ │ [Use this backend] [Reinstall] [Browse…]                 │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                 │
│ ┌─ Default agent model ─────┐ ┌─ Default reasoning effort ─┐    │
│ │ [Claude Sonnet 4.5 ▾]     │ │ [Min] [Low] [●Med] [High]  │    │
│ │ From Models registry,     │ │                            │    │
│ │ 🤖-capable.               │ │                            │    │
│ └───────────────────────────┘ └────────────────────────────┘    │
│                                                                 │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Models live in the BYOK tab.   → Open Models               │  │
│ └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Sub-tabs vs active backend

Backend selection uses **sub-tabs at the top of the Agent panel**, not a radio list. Sub-tabs swap the whole configuration panel; switching sub-tabs does **not** change the active backend.

The **active backend** (the one chat sessions actually use) is separate from the sub-tab currently being viewed. Each backend's Status card shows whether it is active (`✓ Active backend`) or merely configured (`○ Configured, not active`) or unconfigured (`⚠ Not installed`). The **`[Use this backend]`** button in the Status card promotes the viewed backend to active.

This separation lets the user configure a non-active backend (re-authenticate, change visibility, install) without disrupting the currently-running active one.

Each backend remembers its own configuration (binary path, auth, default agent model, default reasoning effort, visibility) — switching sub-tabs preserves state.

### 6.3 OpenCode panel

The OpenCode sub-tab contains:

1. **Status card** — version + binary path; `[Use this backend]`, `[Reinstall]`, `[Browse…]` buttons. When the binary is missing, the card shows `⚠ Not installed` and offers `[Install OpenCode]` (primary) + `[I have it elsewhere…]`.
2. **Default agent model** — dropdown filtered to every 🤖-capable model in the BYOK registry (BYOK + custom + Big Pickle + Copilot Plus Flash). The model OpenCode boots with for a new agent session.
3. **Default reasoning effort** — **chip group** with four levels: Min / Low / Med / High. Applies to reasoning-capable models when run through OpenCode.
4. **"Models live in the BYOK tab"** dashed banner — one-line explainer and deep link. No inline model curation on OpenCode (the BYOK registry is the single source of truth).

### 6.4 Claude Code / Codex panels

Five key elements:

1. **Status card** — same shape as OpenCode (binary path + version + buttons). For CC/Codex the install button reads `[Install Claude Code]` / `[Install Codex]`.
2. **Subscription card** — "Authenticated as <email>", `[Re-authenticate]` button. Unauthenticated state: "Not signed in to <backend>. [Sign in via <backend>]".
3. **Visible models in picker** — inline checklist of that backend's bundled models. The list is small (4–8 entries), maintained in plugin code, refreshed on plugin update. Each row: checkbox + model id (monospace). No 💬/🤖 badges (entire list is 🤖-only).
4. **Default agent model** — dropdown filtered to the **visible** models above. Used as the seed model when starting a session in this backend.
5. **Default reasoning effort** — chip group (Min / Low / Med / High).

If the binary isn't detected, the visible-models list still renders (pre-configure visibility before installing). The Default agent model picker is gated with "Install <backend> first."

### 6.5 Authentication state (Claude Code / Codex only)

Claude Code and Codex auth via the binary's own subscription flow (not BYOK). The Subscription card surfaces:

- Authenticated user (e.g. "Authenticated as zerolxy@gmail.com")
- `[Re-authenticate]` button → triggers the binary's auth refresh
- Unauthenticated state: `⚠ Not signed in` badge + `[Sign in via <backend>]` (opens binary auth flow in a child process). Bundled-models list rendered greyed until signed in.

---

## 7. Dialogs (detailed)

Three dialogs in this redesign:

- **Add Provider** (§7.1) — provider picker. Opens from `[+ Add provider]`.
- **Configure Provider** (§7.2) — one shared modal with **three states**: `new-byok`, `new-custom`, `edit`. Replaces what would have been three separate dialogs (Enter API key / Add Models / Add Custom Endpoint). Opens after picking a provider, or from the row kebab on the BYOK table.
- **Add Custom Model** (§7.3) — first-class modal opened from Configure Provider's Models header to add a model not in the catalog (preview models, fine-tunes, private deployments). Works for **any** provider — BYOK or custom.

### 7.1 Add Provider dialog

Modal opened by `[+ Add provider]`. Lists every supported provider plus a "Custom OpenAI-compatible endpoint" option.

```
┌─────────────────────────────────────────────────────────────────┐
│ Add a provider                                            [X]   │
│ [🔍 Search providers…                                       ]   │
│                                                                 │
│  Recommended                                                    │
│    [An]  Anthropic   — Claude family                  [Add →]   │
│    [Op]  OpenAI      — GPT family                        ＋     │
│    [Go]  Google      — Gemini family                     ＋     │
│                                                                 │
│  More providers                                                 │
│    [Gr]  Groq                                            ＋     │
│    [Mi]  Mistral                                         ＋     │
│    [xA]  xAI                                             ＋     │
│    [De]  DeepSeek                                        ＋     │
│    [OR]  OpenRouter                                      ＋     │
│    [Co]  Cohere                                          ＋     │
│    [Az]  Azure OpenAI                                    ＋     │
│    [AW]  AWS Bedrock                                     ＋     │
│    [Gi]  GitHub Copilot                                  ＋     │
│    [To]  Together                                        ＋     │
│    [Fi]  Fireworks                                       ＋     │
│    [Pe]  Perplexity                                      ＋     │
│  ────────────────────────────────────                           │
│    + Custom OpenAI-compatible endpoint                          │
│      Ollama, vLLM, LM Studio, self-hosted, etc.       [Add →]   │
└─────────────────────────────────────────────────────────────────┘
```

Selecting a built-in provider closes this dialog and opens **Configure Provider** in `new-byok` state (§7.2). Selecting "+ Custom OpenAI-compatible endpoint" opens Configure Provider in `new-custom` state.

Recommended providers (Anthropic, OpenAI, Google) appear at the top; the rest follow alphabetically. Already-added providers are filtered out (so users can't accidentally duplicate). **OpenCode** and **Copilot Plus** never appear in this list — they're system-managed.

### 7.2 Configure Provider dialog — one screen, three states

The same screen renders three flavors based on entry point:

- **`new-byok`** — after picking Anthropic/OpenAI/etc. from Add Provider.
- **`new-custom`** — after picking "Custom endpoint" from Add Provider.
- **`edit`** — from the row kebab on the BYOK table (or from `[Manage providers]` → Configure).

```
┌─────────────────────────────────────────────────────────────────┐
│ [An] Anthropic              ✓ Verified  (edit state only) [X]   │
│ Added Mar 4 · 4 models registered · used by chat & agent        │
│  (or: "Paste your key and pick which models you want." new-byok)│
│  (or: "OpenAI-, Anthropic-, or Google-compatible servers." cust)│
│                                                                 │
│ Display name      Ollama (local)              (new-custom only) │
│ Type              (●) OpenAI-comp  ( ) Anthropic  ( ) Google    │
│                                       (new-custom only)         │
│                                                                 │
│ API key           sk-ant-•••••••••••••••     [Replace]  [Test]  │
│ Base URL          https://api.anthropic.com                     │
│ Availability      ☑ chat   ☑ [OC] OpenCode   ☐ mobile           │
│                                                                 │
│ ── Models ─── (5 in catalog · pick which to register)           │
│                                  [+ Add from catalog]  (edit)   │
│                                  [+ Add custom model]           │
│                                                                 │
│ [🔍 Filter models…] [All][💬 chat][🤖 agent][Vision][Reasoning] │
│                     [Tool use][≥ 200k ctx][≤ $1/M]              │
│                                                                 │
│ ☑ Claude Sonnet 4.5             200k · Vision · Reasoning    ⋯  │
│ ☑ Claude Opus 4.1               200k · Reasoning             ⋯  │
│ ☑ Claude Haiku 4.5              200k · Fast                  ⋯  │
│ ☑ Claude Sonnet 3.7             200k                         ⋯  │
│ ☐ Claude Haiku 3.5              200k                            │
│                                                                 │
│ catalog — known models · custom — preview/fine-tune/private     │
│ ─────────────────────────────────────────────────────────────   │
│ [Remove provider]                       [Cancel] [Save changes] │
│                                                       (edit)    │
│                                                                 │
│  "3 selected · key stored in OS keychain"                       │
│                                       [Cancel] [Verify & save]  │
│                                       (new states)              │
└─────────────────────────────────────────────────────────────────┘
```

#### 7.2.1 Header

- **Provider glyph + name** (provider's preferred name).
- **Status badge** — `✓ Verified` only in `edit` state with a working key. Not shown in new states (no badge until the user clicks Test or Verify & save).
- **Subhead line** varies by state:
  - `edit`: context — "Added Mar 4 · 4 models registered · used by chat & agent".
  - `new-byok`: "Paste your key and pick which models you want available."
  - `new-custom`: "OpenAI-, Anthropic-, or Google-compatible servers."

#### 7.2.2 Connection fields

All three states share a 120px label gutter. Fields:

- **Display name** — only in `new-custom`. The user-facing label for the custom provider.
- **Type** — only in `new-custom`. Radio: OpenAI-compatible / Anthropic / Google. Drives request format.
- **API key** — always shown. In `edit`: masked value with `[Replace]` button. In `new` states: empty field. `[Test]` button issues a no-cost verification call. In `new-custom`, the field label adds "(optional)" since many local servers don't require auth.
- **Base URL** — always shown. Read-only in BYOK states (provider's known URL); editable in custom state (e.g. `http://localhost:11434/v1`).
- **Availability** — three checkboxes: `chat`, `<OpenCode glyph> OpenCode`, `mobile`. Controls which consumers can see this provider's models. (Custom providers often default `mobile` off since custom endpoints typically live on localhost.)

#### 7.2.3 Models section

Header row: `Models <subtitle>` on the left, action buttons on the right.

- Subtitle in `new-byok`: "5 in catalog · pick which to register".
- Subtitle in `edit`: "4 of 5 catalog registered".
- Subtitle in `new-custom`: omitted (catalog is auto-discovered from the endpoint's `/models`).
- Action buttons on the right:
  - `[+ Add from catalog]` — only in `edit` (re-opens the catalog picker inline).
  - `[+ Add custom model]` — in all three states (opens Add Custom Model dialog §7.3).

Below the header: a **filter bar** with search + chips for `All` / `💬 chat` / `🤖 agent` / `Vision` / `Reasoning` / `Tool use` / `≥ 200k ctx` / `≤ $1/M`. (The price chip is suppressed for custom providers where pricing isn't applicable.)

The model list is a tight checklist. Each row: checkbox + model display name + meta line. In `edit` state each registered row gets a `⋯` kebab with model-level actions (View docs, Remove from registry).

A helper note appears below the model list (edit state): _"catalog — known models · custom — preview, fine-tune, private deployment"_.

For `new-custom`, the model list is populated by calling the provider's `/models` endpoint. On failure, the list shows an empty state inviting the user to use `[+ Add custom model]`.

#### 7.2.4 Footer

- **New states (`new-byok`, `new-custom`):**
  - Left: muted info — "3 selected · key stored in OS keychain" (BYOK) or "2 selected · stored locally" (custom).
  - Right: `[Cancel]` `[Verify & save]`.
- **Edit state:**
  - Left: `[Remove provider]` (ghost, danger). Removes the provider, its key, and all its registered models. Confirmation modal.
  - Right: `[Cancel]` `[Save changes]`.

### 7.3 Add Custom Model dialog (any provider)

Opens from the `[+ Add custom model]` button in any Configure Provider state. The provider's connection (API key, base URL) is reused — this dialog just adds a model entry that the catalog doesn't list (preview models, fine-tunes, private deployments, just-released models).

```
┌─────────────────────────────────────────────────────────────────┐
│ [An] Add custom model · under Anthropic                  [X]    │
│ Use this for preview models, fine-tunes, private deployments,   │
│ or anything not in the catalog. The provider's connection       │
│ (key, base URL) is reused.                                      │
│                                                                 │
│ Display name      Claude Sonnet 4.5 (preview)                   │
│ Model ID          claude-sonnet-4-5-20260601-preview     [Test] │
│ Context window    200000   tokens — optional, defaults to prov  │
│                                                                 │
│ Capabilities      ☑ 💬 chat   ☑ 🤖 agent   ☐ Vision             │
│                   ☑ Reasoning ☑ Tool use   ☐ JSON mode          │
│                                                                 │
│ Availability      ☑ chat   ☑ [OC] OpenCode   ☐ mobile           │
│ ──────────────────────────────────────────────────────────────  │
│ Test once before saving — we'll send a minimal "ping" request.  │
│                                          [Cancel] [Add model]   │
└─────────────────────────────────────────────────────────────────┘
```

Fields:

- **Display name** — what the user sees in pickers.
- **Model ID** — the string the provider's API expects.
- **Context window** — optional integer; defaults to the provider's general default.
- **Capabilities** — six checkboxes: `💬 chat`, `🤖 agent`, `Vision`, `Reasoning`, `Tool use`, `JSON mode`. Explicit because Copilot can't infer capabilities from a model ID alone.
- **Availability** — same three checkboxes as Configure Provider.

The `[Test]` button next to Model ID issues a minimal "ping" request to verify the model is reachable at the provider before saving. Save creates the entry in the registry under this provider.

### 7.4 Catalog source

Both Configure Provider's catalog list and Add Custom Model's provider context read from the same source that powered the BYOK panel (OpenCode if available, bundled snapshot otherwise — see §2). Already cached; no network call when the dialog opens.

### 7.5 Search and filters (in Configure Provider's model list)

- **Search box** — fuzzy match against model name, family, and description.
- **Capability chips** — `All` / `💬 chat` / `🤖 agent` / `Vision` / `Reasoning` / `Tool use` / `≥ 200k ctx` / `≤ $1/M`. Multi-select. The `local` chip from the BYOK table doesn't appear here (scope is one provider).
- **Sort** — default by recency (release date desc). Optionally by name or context window.

### 7.6 Already-registered models

In `edit` state, registered models are pre-checked. In `new-byok`, recommended models are pre-checked on open. A model already in the registry from a previous open of the dialog renders with its checkbox pre-checked.

### 7.7 OpenRouter special case

OpenRouter exposes hundreds of models from many upstream providers. Configure Provider's model list groups by upstream provider (Anthropic, OpenAI, Mistral, …) with **sticky section headers** within the scroll. Search still cross-cuts. Capability + price chip filters become especially important.

### 7.8 Verification on save

When Configure Provider closes via `[Verify & save]` or `[Save changes]`, the plugin verifies each newly-added model by issuing a minimal test call ("hello, reply ok"). On failure, the model appears in the BYOK table with a `⚠` icon and a tooltip ("Last verification failed — click to retry"). The user can still keep it (some endpoints don't support the test call but work fine for real prompts).

---

## 8. Critical user journeys (walk-throughs)

These are the journeys the designer mocked in the Final flow. Each is a multi-screen flow.

### 8.1 First-run desktop (agent-first, three onboarding paths)

**Goal:** New user gets to a working agent in under 60 seconds.

The Welcome modal is **standalone** — it overlays the entire Obsidian window with a dimmed app silhouette behind. It is **not** rendered inside the settings modal. There is **no** "Just want simple chat? Skip agent setup →" secondary link. The three primary paths are:

- **"Use my existing subscription"** — for users with Claude Code or Codex installed/subscribed. Opens Agent tab pre-selected to whichever backend the plugin can detect.
- **"Bring my own key"** — for users who already have a provider API key. Opens Add Provider dialog over the BYOK tab.
- **"Subscribe to Copilot Plus"** — for users who'd rather pay Copilot than juggle keys. Opens the Plus subscription flow; on success, OpenCode is auto-installed, Copilot Plus rows light up in BYOK, and the user lands in the Agent tab on the OpenCode sub-tab.

**Walkthrough — "Use my existing subscription" (e.g. Claude Code):**

1. User installs the plugin, opens Obsidian — Welcome modal appears over a dimmed Obsidian.
2. User clicks **"Use my existing subscription."** Sub-picker shows Claude Code / Codex.
3. User picks Claude Code. Welcome closes; Settings opens to the Agent tab, Claude Code sub-tab.
4. Binary auto-detected at `/usr/local/bin/claude` → ✓ Detected.
5. Subscription card: "Not signed in. [Sign in via Claude Code]." User clicks → Claude Code's auth flow runs in a child process.
6. Status updates: "Authenticated as user@example.com." Bundled model list lights up. Default agent model auto-set to Sonnet. Default effort = Med.
7. User clicks `[Use this backend]` to promote Claude Code to active. Done.

**Walkthrough — "Bring my own key":**

1. User clicks **"Bring my own key."** Welcome closes; Settings opens to BYOK tab with **Add Provider** dialog already showing.
2. User picks Anthropic. Add Provider closes; **Configure Provider** opens in `new-byok` state with the API key field focused.
3. User pastes the key, clicks `[Test]` → ✓ Verified.
4. The Models section in the same screen pre-checks recommended Anthropic models (Sonnet 4.5, Opus 4.1).
5. User leaves defaults, clicks `[Verify & save]`. Configure Provider closes; BYOK table now shows the registered Anthropic rows.
6. A non-intrusive prompt: "Set up the agent so models work in agent sessions too." → Switches to Agent tab, OpenCode sub-tab, `[Install OpenCode]` prominent.
7. User clicks Install. Progress, then ✓ Detected.
8. OpenCode's Default agent model auto-populates with Sonnet 4.5 (from the BYOK registry). Default effort = Med. Done.

**Walkthrough — "Subscribe to Copilot Plus":**

1. User clicks **"Subscribe to Copilot Plus."**
2. Plus subscription flow runs (out of scope — handled by license management).
3. On success, the plugin installs OpenCode in the background.
4. User lands in the Agent tab, OpenCode sub-tab. ✓ Detected. Copilot Plus rows now appear in the BYOK tab.
5. Default agent model auto-set to Copilot Plus Flash. Default effort = Med. Done.

### 8.2 Add a model from OpenRouter (hundreds of models)

1. User has already added OpenRouter as a provider (Configure Provider, `edit` state).
2. User opens the OpenRouter row's kebab on the BYOK table → "Configure provider (OpenRouter)".
3. Configure Provider opens in `edit` state, scoped to OpenRouter, showing the catalog grouped by upstream provider with sticky section headers.
4. User types "sonnet" in the search box → list filters to ~6 matches across upstreams.
5. User applies the `Vision` chip → list filters further.
6. User checks "anthropic/claude-sonnet-4-5" and "google/gemini-2.5-flash". Footer shows "5 of 327 selected".
7. User clicks `[Save changes]`. Configure Provider closes. Both models appear in the BYOK table with verification spinners → ✓ within 2s each.

### 8.3 Add a local Ollama provider

1. User clicks `[+ Add provider]` at the top of the BYOK table.
2. Add Provider dialog opens. User scrolls down and clicks "+ Custom OpenAI-compatible endpoint."
3. **Configure Provider** opens in `new-custom` state.
4. User fills: Display name = "Ollama (local)", Type = OpenAI-compatible, Base URL = `http://localhost:11434/v1`, API key empty.
5. Plugin pings `http://localhost:11434/v1/models`; the Models section populates with locally-installed Ollama models.
6. User checks `llama3.2:latest` and `qwen2.5-coder:7b`. Clicks `[Verify & save]`.
7. Configure Provider closes. BYOK table now has two Ollama rows at the top-level (alongside Anthropic etc., not nested). Both show 💬 🤖 badges (Availability had OpenCode checked).
8. If OpenCode is running, the plugin registers Ollama as a custom provider in OpenCode's config so the models are usable in agent mode.

### 8.4 Change Claude Code agent visibility

**Pre-condition:** User has Claude Code installed (sub-tab configured), but the active backend is OpenCode.

1. User opens Settings → Agent tab.
2. User clicks the Claude Code sub-tab. The panel swaps. Status card shows `○ Configured, not active`.
3. User scrolls to "Visible models in picker." Sees 4 checkboxes:
   - ☑ claude-sonnet-4-5
   - ☑ claude-opus-4-1
   - ☑ claude-haiku-4-5
   - ☑ claude-sonnet-3-7
4. User unchecks `claude-haiku-4-5` and `claude-sonnet-3-7`.
5. State persists immediately (no Save button — inline persistence). The change applies whether Claude Code is currently active or not.
6. If the user wants Claude Code to be active too, they click `[Use this backend]` in the Status card. Otherwise OpenCode stays active.

### 8.5 Switch agent backends (OpenCode → Codex)

1. User opens Settings → Agent tab, clicks the Codex sub-tab.
2. Codex panel: Status `⚠ Not installed`. `[Install Codex]` (primary) + `[I have it elsewhere…]`.
3. User clicks Install. Progress, then ✓ Detected.
4. Subscription card: "Sign in to Codex after install." User clicks `[Sign in]` → child process. Auth completes; status updates to "Authenticated as user@example.com."
5. Bundled-models list lights up. User leaves defaults.
6. Default agent model dropdown lists visible models. User picks GPT-5. Default effort = Med.
7. User clicks `[Use this backend]` in the Status card. Codex is now active. Chat input picker now reads from Codex's visible models.

### 8.6 Offline (no network)

1. User opens Settings → BYOK on a laptop without internet.
2. Panel renders normally — bundled catalog powers Configure Provider's Models section. No network call needed.
3. User clicks `[+ Add provider]` → Anthropic → Configure Provider opens in `new-byok` state.
4. User pastes a key, clicks `[Test]` — fails. The key is still saved but the field shows "⚠ Couldn't verify — offline. Will verify when online."
5. User picks two models, clicks `[Verify & save]`. Verification calls fail. Models appear in the BYOK table with `⚠` icons and tooltip "Couldn't verify — offline. Will retry when used."
6. Later, when online, the next real use of the models succeeds and the warning icons disappear automatically.

### 8.7 OpenCode not installed — graceful degradation

1. User has BYOK providers configured but no OpenCode binary.
2. BYOK table renders normally. Catalog source falls back to the bundled snapshot. OpenCode-provided rows are absent; Copilot Plus rows are also absent (Plus requires OpenCode at runtime).
3. 🤖 badges still appear on cloud BYOK models (they would work via OpenCode if it were installed).
4. A banner at the top of the BYOK panel: "OpenCode isn't installed yet. Models with the 🤖 badge will work once you install it. → Go to Agent tab."
5. User can configure chat models normally; chain-mode chat works.
6. When user installs OpenCode (via Agent tab), the banner disappears, the catalog source switches to OpenCode, OpenCode-provided rows and (if Plus) Copilot Plus rows appear in the table.

### 8.8 Remove a model entirely

1. User in BYOK tab, opens a row's `⋯` kebab.
2. Menu: ⚙ Configure provider (Anthropic) | ↗ View model docs | — Remove from list
3. Clicks Remove. Inline confirmation: "Remove Claude Haiku 4.5? You can add it back from + Add from catalog." `[Cancel]` `[Remove]`.
4. Row disappears. If it was a Default Agent Model for any backend, that backend's default reverts to its first visible model.

(There is no "Set as default chat" menu item — the Default Chat Model concept is gone. The visibility checkbox handles show/hide.)

### 8.9 Edit a custom provider's base URL

1. User in BYOK tab opens an Ollama row's `⋯` kebab → "Configure provider (Ollama)".
2. Configure Provider opens in `edit` state with all fields pre-filled.
3. User changes Base URL to `http://my-server.tailnet.ts.net:11434/v1`. Clicks `[Test]` → ✓.
4. Clicks `[Save changes]`. Plugin pings the new URL. Existing models stay in the registry.
5. If the new URL doesn't return the expected model IDs, the model rows show `⚠` warnings with "These models weren't found at the new URL. Remove them?" → `[Remove these models]`.

---

## 9. Empty / loading / error states

### 9.1 Empty registry (no providers yet)

Default state on first launch of the BYOK tab. See §5.1. The single primary CTA is `[+ Add provider]`. Helper copy invites both BYOK and custom endpoints. No provider shortcut buttons.

### 9.2 Polling OpenCode for catalog

Brief skeleton state on BYOK tab open while the plugin queries OpenCode for its live catalog. Usually <500ms — shimmer skeletons on the table rows. When OpenCode isn't installed, this state is skipped (bundled catalog renders immediately).

### 9.3 Invalid API key

Inside Configure Provider, below the key field, red text:

```
⚠ Couldn't verify your key. Check that it's correct and has access to chat models.
[Re-enter key] [Get a new key →]
```

The "Get a new key" link goes to the provider's key management page.

### 9.4 Model verification failed

On saving Configure Provider with a model that fails its test call, the row in the BYOK table shows `⚠` next to the model name. Tooltip: "Last verification failed: <error message>". Click `⚠` → popover with `[Retry]` and `[Remove from registry]`.

### 9.5 Two OpenCode binaries detected

Agent tab → OpenCode sub-tab. Status card shows a radio list:

```
(●) /usr/local/bin/opencode        v0.4.2 · system
( ) ~/Library/.../opencode         v0.4.0 · plugin-installed
```

Helper text: "Two OpenCode installations detected. Choose which one to use."

### 9.6 No providers, no models

BYOK tab empty state. No "default chat model" picker exists (the concept is removed), so there's no empty-default-picker variant to design.

### 9.7 Subscription not authenticated (Claude Code / Codex)

Subscription card in the backend sub-tab:

```
⚠ Not signed in
Your subscription auth has expired or never completed.
[Sign in via Claude Code]   [Helper docs →]
```

Bundled-models card greyed until signed in.

### 9.8 Offline notice

Top of BYOK tab when network is unreachable:

```
[i] You're offline.
Catalog still works (bundled). Keys & models will verify when you're online.
```

### 9.9 OpenCode missing banner

Top of BYOK tab when OpenCode is selected as the active backend but the binary is missing:

```
[i] OpenCode isn't installed yet.
Models with the 🤖 badge will work once you install it.  → Go to Agent tab
```

### 9.10 Remove-model confirmation

Inline mini-modal triggered from the row kebab → Remove from list:

```
Remove Claude Haiku 4.5?
Remove from registry? You can add it back from + Add from catalog.
(If it was a default agent model, the default will revert to next.)
[Cancel] [Remove]
```

---

## 10. Platform considerations

### 10.1 Desktop vs mobile

The redesigned settings UI is **desktop-shaped** (90%+ of users). Mobile users get a stripped-down view of the same surfaces:

| Aspect                                                            | Desktop                        | Mobile                                |
| ----------------------------------------------------------------- | ------------------------------ | ------------------------------------- |
| Welcome modal                                                     | Standalone modal over Obsidian | Skipped — direct to BYOK tab          |
| Agent tab                                                         | Visible                        | Hidden entirely                       |
| 🤖 badges                                                         | Visible                        | Hidden everywhere                     |
| OpenCode rows (Big Pickle, etc.)                                  | Visible                        | Hidden                                |
| Copilot Plus rows (Plus Flash, etc.)                              | Visible                        | Hidden                                |
| Configure Provider "Availability" — `OpenCode` checkbox           | Visible                        | Hidden (forced off)                   |
| Add Custom Model "Availability" — `OpenCode` + agent capabilities | Visible                        | `OpenCode` hidden, `agent` cap hidden |
| Settings modal width                                              | ~1320px                        | Full-screen overlay                   |
| Touch targets                                                     | Default                        | Min 44pt                              |

### 10.2 Obsidian theme

The Obsidian shell exposes CSS variables for colors, spacing, radii, fonts. Mockups should look native to a default Obsidian dark theme but also work in light theme. Avoid full-bleed color blocks or unique typography that breaks theme expectations.

### 10.3 Settings modal constraints

Copilot's settings live inside the Obsidian modal. The tab list runs **horizontally across the top of the modal** (Copilot's existing pattern — not Obsidian's stock left-rail).

- Width: bounded by Obsidian modal (~1320px for the redesign).
- Tabs: horizontal strip at the top (BYOK, Agent, Chat & Commands, …).
- Content: scrolls vertically beneath the tabs.
- Nested dialogs (Add Provider, Configure Provider, Add Custom Model) overlay the modal at ~80% of its area, max ~820px wide.
- The Welcome modal is standalone — not nested inside Settings.

### 10.4 Persistence

All settings persist immediately on change (no Save button) — the existing Copilot pattern. Configure Provider and Add Custom Model are the exceptions: they use explicit `[Verify & save]` / `[Save changes]` / `[Add model]` buttons because the user is composing multiple fields at once.

---

## 11. Migration

Existing users on the current settings will, on first launch after this redesign ships:

1. Existing provider keys → preserved. Each provider with a configured key auto-appears in the BYOK registry (no need to re-add via Add Provider). The user can hit the row kebab → Configure provider to inspect.
2. Existing `activeModels` array → preserved; each model lands as a row in the BYOK table under its provider.
3. Existing per-model overrides (temperature, max_tokens, etc.) → **dropped silently.** All chains revert to defaults. No notice shown.
4. Existing agent-mode model curation (`modelEnabledOverrides` for OpenCode) → merged into the BYOK registry's visibility state (the row checkbox).
5. Existing "Default Chat Model" setting → **discarded.** The concept is removed; chat input remembers the last-selected model.
6. Existing per-backend agent defaults (Default Agent Model, Default reasoning effort) → preserved per backend in the Agent tab. If any backend lacks a saved default, seed with the backend's first visible model and Med effort.
7. Existing "agent mode enabled" boolean → **discarded.** Agent capabilities are always available on desktop; the per-user toggle no longer exists.
8. Existing custom provider definitions → preserved as top-level providers in the BYOK registry. Each gets an `edit`-state row in Configure Provider.

There is no migration UI; the changes are silent on launch.

---

## 12. Out of scope (explicit)

- **Embedding models.** Separate "Embeddings" panel, not touched.
- **Reranker models.** Same — separate, untouched.
- **License / Plus / Believer tier management.** Separate panel, not part of this redesign.
- **Chat UI.** The redesigned chat-input model picker is a consumer of the BYOK registry, but its design is owned by chat redesign work.
- **Skills / Custom commands / MCP servers.** Separate panels.
- **Per-model temperature / max_tokens / system prompt.** Removed.
- **Default Chat Model picker.** Removed — chain-mode chat uses last-selected.
- **Drag-to-reorder models.** Out. Sort defaults: provider order then alphabetical.
- **Special "pinned section" styling for OpenCode / Copilot Plus.** OpenCode and Copilot Plus appear as ordinary table rows, sorted to the top, not as visually-distinct pinned sections.

---

## 13. Glossary

- **BYOK** — Bring Your Own Key. The user supplies an API key from their provider account. Also the name of the consolidated settings **tab** (renamed from "Models").
- **Chain mode** — Single-turn LLM calls via LangChain. Powers chat, custom commands. Works on mobile.
- **Agent mode** — Multi-turn agent sessions via an external binary backend. Desktop-only.
- **OpenCode** — Copilot's recommended agent backend. Open source, BYOK, supports many providers. Ships with a bundled `models.dev` catalog and a set of free models (Big Pickle, etc.).
- **Claude Code** — Anthropic's official agent CLI. Subscription-based, Claude-only.
- **Codex** — OpenAI's official agent CLI. Subscription-based, GPT-only.
- **Big Pickle** — A free model bundled with OpenCode. No BYOK or license required. Agent-only (requires OpenCode installed).
- **Copilot Plus** — Copilot's paid subscription tier. Unlocks access to hosted models served by Copilot (e.g. Copilot Plus Flash).
- **Copilot Plus Flash** — A paid hosted model served by Copilot, available to Copilot Plus subscribers. Routed through OpenCode at runtime. Agent-only.
- **`models.dev`** — An open catalog of LLM models across providers with metadata (context, pricing, modalities, capabilities). The plugin ships a tree-shaken snapshot. There is **no live refresh** in this design.
- **Capability badges** — `💬 chat` and `🤖 agent` pills shown next to each enabled model row.
- **Default Agent Model** — One **per agent backend** (lives in the Agent tab, inside each backend's sub-tab). The model used when starting an agent session in that backend. Must be 🤖-capable and visible in that backend.
- **Default Reasoning Effort** — One **per agent backend** (in the Agent tab). Four levels: Min / Low / Med / High. Applies to reasoning-capable models in that backend. Surfaced as a chip group, not a radio.
- **Registry** — The user's enabled models. Curated, not the full catalog. The list users see in the BYOK panel.
- **Catalog** — The full list of available models for a provider. Not all of them are in the user's registry.
- **Active backend** — The agent backend that chat sessions actually use. Separate from the Agent tab's _viewed sub-tab_. Promoted via `[Use this backend]` on the sub-tab's Status card.
- **Custom provider** — A user-defined OpenAI-compatible (or Anthropic / Google-compatible) endpoint, e.g. Ollama or a self-hosted server. Appears as a top-level provider in the BYOK registry, **not** nested under a "Custom" wrapper.
- **Configure Provider** — A single dialog with three states (`new-byok`, `new-custom`, `edit`). Consolidates what would otherwise be three separate dialogs (Enter API key, Add Models, Add Custom Endpoint).
- **Add Custom Model** — A first-class dialog opened from Configure Provider to register a model that isn't in the catalog. Works for any provider.
- **LangChain** — The library Copilot uses to instantiate and call provider SDKs in chain mode.

---

## 14. Design source

The design that this doc reflects is exported from Claude Design as `copilot-model-settings/`. The canonical reference for visuals and interaction details:

- `project/index.html` — the wireframe app shell.
- `project/screens/final.jsx` — the **★ Final flow** that consolidates picked variants and adds two gap-filling screens (unified Configure Provider, Add Custom Model). Read this first.
- `project/screens/welcome.jsx` (V1) — Welcome modal as standalone three-tile picker.
- `project/screens/models-populated.jsx` (V3) — populated BYOK tab as a flat table.
- `project/screens/add-provider.jsx` (V1) — provider picker dialog.
- `project/screens/add-models.jsx` (V2) — OpenRouter-scale picker with sticky upstream-provider headers (now folded into Configure Provider's catalog list).
- `project/screens/agent-opencode.jsx` (V2) — Agent tab with sub-tabs per backend.
- `project/screens/agent-cc.jsx` (V1) — Claude Code / Codex internals (subscription + bundled visibility checklist).
- `project/screens/states.jsx` — all empty / loading / error / offline / auth states.
- `project/styles.css` and `project/primitives.jsx` — the low-fi component primitives the wireframes use.
- `chats/chat1.md` and `chats/chat2.md` — design conversation transcripts that document the iterations and final decisions.

When in doubt, the design files override anything in this doc. This doc exists to translate design intent into engineering-ready language and to track the constraints (catalog source, migration, mobile differences) that aren't visually obvious in the mocks.
