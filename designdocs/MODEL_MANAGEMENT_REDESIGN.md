# Model Management Redesign — Design Handoff

**Status:** Draft for design handoff
**Audience:** Senior product designer doing UX/mockup work in Claude Design. No codebase access assumed.
**Scope:** Provider keys, model catalog, model selection, model visibility, agent backend configuration. Everything a user does to answer the question "what LLM is this plugin going to call?"
**Out of scope:** Embedding model configuration (lives in its own panel, untouched by this redesign), chat UI redesign, command palette redesign, plus/license management.

---

## 0. What this product is, in one paragraph

Copilot for Obsidian is a plugin that adds AI capabilities (chat, autocomplete, semantic search, custom commands, agent workflows) to the Obsidian note-taking app. It supports many LLM providers — OpenAI, Anthropic, Google, Groq, Mistral, xAI, DeepSeek, OpenRouter, Azure, AWS Bedrock, GitHub Copilot, Ollama, plus arbitrary OpenAI-compatible endpoints. Users configure provider API keys and select which models they want the plugin to use. The plugin runs in both Obsidian desktop and Obsidian mobile.

The plugin has **two execution modes** that share the same model pool:

- **Chain mode** (legacy / chat / commands) — single-turn LLM calls via LangChain. Used for chat, custom command execution, quick prompts. **Works on mobile.** Always available.
- **Agent mode** (newer / "OpenCode" et al) — multi-turn agent sessions with tool use, file ops, sessions. Runs by spawning an external binary (OpenCode, Claude Code, or Codex). **Desktop-only.** Optional.

Today, model configuration is split across three duplicated UI surfaces (Basic Settings provider key panel, Models Settings table, Agent Mode model curation). This redesign consolidates them.

---

## 1. Goals & Non-Goals

### Goals

1. **One canonical place to configure providers, keys, and models.** Currently three places; should be one.
2. **A user can complete first-run setup in under 60 seconds.** Pick a provider, enter a key, pick a model, done.
3. **OpenRouter and similar large-catalog providers don't drown the UI.** OpenRouter has hundreds of models. Users see only what they've enabled, with a separate dialog to add more.
4. **The mobile flow is identical** to the desktop chain-only flow. No "mobile mode" branding — just fewer fields because agent mode isn't possible.
5. **Visibility curation exists** — users can hide models they don't want cluttering the model picker dropdown next to the chat input.
6. **Local providers (Ollama, custom OpenAI-compatible endpoints) are first-class**, not a power-user afterthought.
7. **Non-BYOK models (OpenCode-provided free models like "Big Pickle", and Copilot Plus paid models like "Copilot Plus Flash") appear naturally in the same panel** without surprise; capability badges explain why they only work in agent mode.
8. **Offline-capable.** The plugin ships with a bundled model catalog so users without internet can still see providers and configure keys.

### Non-Goals

- Embedding model management (separate, unchanged).
- Per-model temperature / max_tokens / system prompt overrides. **These are being removed entirely.** All chains use sensible defaults.
- Reordering models in a custom order (drag-to-reorder is out). Alphabetical or provider-grouped is fine.
- Adding any new agent backends beyond OpenCode / Claude Code / Codex.
- Visual restyling of the surrounding Obsidian settings shell.

---

## 2. Conceptual model (read this before designing anything)

### Two execution modes, one model pool

```
                   ┌──────────────────────────────┐
                   │   ONE Models registry        │
                   │   (the unified Models panel) │
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

### What lives in the unified registry

Models the user has explicitly enabled. Each model in the registry has one of four origins:

- **BYOK** — User entered a provider API key, then picked which of that provider's models they want enabled. Most common.
- **Local/Custom** — User defined a custom OpenAI-compatible endpoint (e.g. Ollama at `http://localhost:11434`) and added one or more models running there.
- **OpenCode-provided** — Free models bundled with OpenCode (e.g. **Big Pickle**). No key required. Only available when OpenCode is installed. Only usable in agent mode.
- **Copilot-provided** — Paid models served by Copilot for **Plus subscribers** (e.g. **Copilot Plus Flash**). No BYOK key required — gated by the user's Copilot Plus license. Routed through OpenCode at runtime. Only usable in agent mode.

### Capability badges

Every model carries up to two capability badges:

- **💬 Chat-capable** — can be called via LangChain. Works in chat, custom commands, mobile.
- **🤖 Agent-capable** — can be selected as the model an agent backend runs.

Examples:

| Model | Provider | 💬 Chat | 🤖 Agent |
|---|---|:---:|:---:|
| Claude Sonnet 4.5 | Anthropic | ✓ | ✓ |
| GPT-5 | OpenAI | ✓ | ✓ |
| llama3.2 | Ollama (local) | ✓ | ✓ |
| Big Pickle | OpenCode | ✗ | ✓ |
| Copilot Plus Flash | Copilot Plus | ✗ | ✓ |

In the chat input model picker, models are grouped by agent backend (OpenCode, Claude Code, Codex) and selecting a model auto-selects the backend. The existing model picker pattern handles this — this redesign does not change it. Mobile / chain-mode-only contexts hide 🤖-only models from the picker.

### Agent backend special case (Claude Code / Codex)

OpenCode is BYOK — it uses the models in the unified registry, augmented by the OpenCode-provided free models and (for Plus subscribers) the Copilot Plus paid models.

**Claude Code and Codex are different.** They are subscription-based binaries with their own bundled model lists, authenticated by the user's Anthropic/OpenAI subscription (not the BYOK keys). They cannot accept arbitrary models. So:

- The unified Models registry does **not** include Claude Code's or Codex's models.
- Each of those backends has its own tiny **visibility panel** inside Agent Settings to let users hide models from that backend's picker (e.g. "I never want Claude Haiku to appear").
- Switching backend changes which catalog the agent model picker reads from.

### Catalog source priority (one source at a time, never merged)

When the Models panel loads, it picks ONE source for "available models per provider":

1. **OpenCode binary present and reachable** → ask OpenCode for its catalog. Includes OpenCode-provided free models (Big Pickle, etc.), Copilot Plus paid models when the user has a Plus license, any custom providers we've previously registered, and the bundled `models.dev` snapshot OpenCode ships with.
2. **OpenCode not installed** → use the plugin-bundled `models.dev` snapshot. No 🤖 badges shown on cloud BYOK models (because no agent is available). OpenCode-provided and Copilot Plus models are absent from the catalog (they require OpenCode).

**No live refresh from `models.dev/api.json`.** The catalog the user sees is whatever ships with the plugin (bundled snapshot) or whatever OpenCode provides (when installed). New models become available on plugin update or OpenCode update. There is no "Refresh catalog" button, no daily background fetch, no network dependency for the catalog. This keeps the model offline-correct and architecturally simple.

The bundled snapshot is tree-shaken to ~20 supported providers (Anthropic, OpenAI, Google, Groq, Mistral, xAI, DeepSeek, OpenRouter, Cohere, Azure, AWS Bedrock, GitHub Copilot, Together, Fireworks, Perplexity, plus a few more). For providers outside that set, the user can still add them as a custom provider with manual model entry.

---

## 3. User requirements (jobs to be done)

The redesigned UI must let a user accomplish every one of these:

### First-run setup

- **JTBD-1.** As a new user on desktop, get to a working agent in under 60 seconds via one of three paths: use an existing Claude Code / Codex subscription, bring my own provider key, or subscribe to Copilot Plus.
- **JTBD-2.** As a new user, understand that Copilot is **agent-first** — the welcome flow surfaces agent setup as the primary action; chain-mode chat is a quieter secondary option.

### Provider key management

- **JTBD-4.** Enter, edit, paste, and remove a provider API key.
- **JTBD-5.** Verify that a key works (a "Test" or "Verify" affordance, or implicit on key change).
- **JTBD-6.** See which providers have keys configured at a glance.
- **JTBD-7.** Get a clear error when a key is invalid, expired, or has insufficient permissions.

### Model selection (enabling models)

- **JTBD-8.** After entering a provider key, browse the models that provider offers and choose which to enable.
- **JTBD-9.** Add a model from a provider that has many models (like OpenRouter, with hundreds) without the UI becoming unscannable.
- **JTBD-10.** Quickly disable a model I no longer want, without removing my provider key.
- **JTBD-11.** Remove a model entirely (not just disable).
- **JTBD-12.** See, for each enabled model, where it works (chat, agent, both).

### Custom / local providers

- **JTBD-13.** Add a local Ollama instance with one or more models, in a single flow.
- **JTBD-14.** Add a custom OpenAI-compatible endpoint (e.g. self-hosted vLLM, a colleague's Tailscale-hosted server).
- **JTBD-15.** Edit a custom provider's base URL after adding it.
- **JTBD-16.** Have local models work in both chat and (when desktop + OpenCode installed) agent.

### Defaults

- **JTBD-17.** Pick a **Default Chat Model** — used for chain-mode chat (mobile chat, simple chat, custom commands). Filtered to 💬-capable models.
- **JTBD-18.** Pick a **Default Agent Model per agent backend** — one each for OpenCode, Claude Code, Codex. Filtered to 🤖-capable models for that backend. Used when starting an agent session in that backend.
- **JTBD-19.** Pick a **Default Reasoning Effort per agent backend** (minimal / low / medium / high) for reasoning-capable models. Maps to the existing per-backend effort knob.

### Agent backend configuration (desktop only)

- **JTBD-20.** Pick which agent backend is active: OpenCode (recommended), Claude Code, or Codex.
- **JTBD-21.** Install the OpenCode binary from inside the plugin if I don't have it yet.
- **JTBD-22.** Point the plugin at an existing binary location, or detect one automatically.
- **JTBD-23.** When using Claude Code or Codex, curate which of that backend's bundled models show up in the agent model picker dropdown.
- **JTBD-24.** Switch between backends and see the model picker re-populate appropriately.

### Visibility & cleanup

- **JTBD-25.** Hide models I don't want cluttering the chat input's model picker dropdown, without removing them from the registry.
- **JTBD-26.** Bulk-disable models from a single provider (e.g. "I deleted my OpenAI key, hide all OpenAI models from the picker").

### Offline

- **JTBD-27.** Configure providers and add models when my machine has no internet, using the bundled catalog that ships with the plugin.

### Mobile

- **JTBD-28.** On mobile, see the Models tab without 🤖 badges and without the OpenCode / Copilot Plus sections. Agent UI is hidden. No dedicated mobile onboarding — mobile uses the same Models tab as desktop, just with the agent surfaces hidden.

---

## 4. Information architecture

Settings is rendered inside Copilot's settings modal: a horizontal tab strip at the top of the modal, with the content area scrolling beneath. Modal width is ~700–900px (see §10.3).

The Model Management redesign occupies **two tabs**:

### Tab: **Models**

The unified registry. Source of truth for everything chain-capable, and the BYOK input pathway for OpenCode-capable models.

Always visible. Same on desktop and mobile, with two differences on mobile:
- The 🤖 column / badge is hidden everywhere.
- The **OpenCode** and **Copilot Plus** sections are hidden (no agent backend → no consumer).

### Tab: **Agent** (desktop only)

Backend picker (OpenCode / Claude Code / Codex), binary path, per-backend visibility curation for Claude Code and Codex. (No per-backend "default model" picker — see §2 and §6.3.)

Hidden entirely on mobile. (Existing "Settings → Agent Mode" pattern. Already established in the broader settings redesign.)

The existing **Chat & Commands** tab is unchanged by this redesign. The chat input's model picker continues to read from the unified Models registry, grouped by agent backend, with selection auto-routing to the right backend.

---

## 5. The Models panel (detailed)

This is the centerpiece. Mockup priorities are highest for this screen.

The panel has **two visual states**: **empty** (no providers added yet) and **populated** (one or more providers added). Providers do not pre-populate as collapsed cards; users explicitly add the providers they want via a `[+ Add provider]` button.

The two non-BYOK sections (**OpenCode** and **Copilot Plus**) auto-appear when their preconditions are met (OpenCode binary detected; Plus license active). They are not user-added and cannot be removed.

### 5.1 Anatomy — empty state (default for new users)

```
┌─────────────────────────────────────────────────────────────────┐
│ Models                                                          │
│                                                                 │
│ Add providers and choose which models you want available        │
│ throughout Copilot.                                             │
│                                                                 │
│                                                                 │
│             ┌─────────────────────────────────────┐             │
│             │                                     │             │
│             │   No providers added yet.           │             │
│             │                                     │             │
│             │   Add a provider to pick from its   │             │
│             │   models, or add a custom endpoint  │             │
│             │   (Ollama, self-hosted, etc.)       │             │
│             │                                     │             │
│             │   [ + Add provider ]                │             │
│             │                                     │             │
│             └─────────────────────────────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Anatomy — populated state

```
┌─────────────────────────────────────────────────────────────────┐
│ Models                                          [+ Add provider]│
│                                                                 │
│ Default chat model:  [ Claude Sonnet 4.5 ▾ ]                    │
│ (Used for chain-mode chat and custom commands. Agent defaults   │
│  are per-backend, set in the Agent tab.)                        │
│                                                                 │
│ ──────────────────────────────────────────────────────────────  │
│                                                                 │
│ ▼ [opencode-logo] OpenCode                        1 model       │
│   Free models bundled with OpenCode. Agent only.                │
│                                                  [✓ Detected]   │
│   ☑ Big Pickle                  🤖   Free                       │
│                                                                 │
│ ──────────────────────────────────────────────────────────────  │
│                                                                 │
│ ▼ Copilot Plus                                    1 model       │
│   Hosted models for Copilot Plus subscribers. Agent only.       │
│                                                  [✓ Plus]       │
│   ☑ Copilot Plus Flash          🤖   Included with Plus         │
│                                                                 │
│ ──────────────────────────────────────────────────────────────  │
│                                                                 │
│ ▼ Anthropic                                       4 models      │
│   API key:  •••••••••••••••••••••••••  [Change] [✓ Verified]    │
│                                                                 │
│   ☑ Claude Sonnet 4.5      💬 🤖   200k ctx   ★ Default chat    │
│   ☑ Claude Opus 4.1        💬 🤖   200k ctx                     │
│   ☑ Claude Haiku 4.5       💬 🤖   200k ctx                     │
│   ☑ Claude Sonnet 3.7      💬 🤖   200k ctx                     │
│                                                                 │
│   [ + Add models ]                              [Remove provider]│
│                                                                 │
│ ──────────────────────────────────────────────────────────────  │
│                                                                 │
│ ▼ Ollama (local — custom)                         2 models      │
│   Base URL: http://localhost:11434  [Change]                    │
│                                                                 │
│   ☑ llama3.2:latest        💬 🤖                                │
│   ☑ qwen2.5-coder:7b       💬 🤖                                │
│                                                                 │
│   [ + Add models ]                              [Remove provider]│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Section ordering rule.** When present, the **OpenCode** and **Copilot Plus** sections always sit at the top of the panel (in that order), immediately under the Default chat model selector. BYOK and custom providers follow in the order the user added them. This ordering surfaces the highest-leverage models (the ones Copilot uniquely provides) first; the user can collapse them if they prefer.

**Icon usage note.** The OpenCode section header uses the OpenCode logo icon (small, ~16px). Apply the same OpenCode logo wherever OpenCode is referenced (Agent tab radio option, install button, status badges, in-chat backend indicators). Do not use a generic placeholder.

### 5.3 Provider section behavior

A provider section exists in the Models panel only because the user added it (or because it auto-appears — OpenCode/Copilot Plus). Sections are expanded by default after adding. Once collapsed by the user, the collapsed header still shows: provider name, model count, and any status badges.

Each BYOK section contains:

- **Masked API key** with `[Change]` button and verification status (✓ Verified / ⚠ Invalid / ⏳ Checking…).
- **Enabled models list** — each row is a model the user has added (see §5.4 for row anatomy).
- **`[+ Add models]`** button — opens the Add Models dialog (§7), pre-scoped to this provider.
- **`[Remove provider]`** button (right side of the section) — removes the provider, its key, and all its enabled models. Confirmation modal.

OpenCode and Copilot Plus sections have a different structure — see §5.7.

### 5.4 Model row anatomy

Each row in an enabled-models list shows, left to right:

- **Checkbox** (visibility toggle — controls whether the model appears in the chat input's model picker; checked = visible)
- **Model display name** (provider's preferred name, e.g. "Claude Sonnet 4.5", not the API id `claude-sonnet-4-5-20250929`)
- **Capability badges** (💬 and/or 🤖 — see §2)
- **Inline metadata** (context window, "Free", "Reasoning", etc. — small, muted)
- **★ Default chat** pill if this is the user's Default Chat Model
- **Row hover menu** (`⋯` button) with: Set as default chat (only for 💬-capable rows), Remove from registry

The capability badge has a tooltip on hover explaining what it means.

### 5.5 Default chat model selector

Sits at the top of the populated panel. Dropdown lists every enabled 💬-capable model, grouped by provider. This default is used by chain-mode contexts only: mobile chat, custom commands, simple one-shot chat. **Agent-mode defaults are per-backend and live in the Agent tab — see §6.**

If no chat-capable models are enabled, the dropdown shows "Add a chat-capable model below to set a default."

### 5.6 Mobile differences

- 🤖 badges hidden, header text changed to "Choose which models you want available for chat."
- **OpenCode** and **Copilot Plus** sections hidden entirely (no agent backend → no consumer).
- Add Custom Provider dialog hides the "Available in agent mode" toggle (always chat-only on mobile).
- Single-column layout, larger touch targets.

### 5.7 OpenCode and Copilot Plus sections — special behavior

Both sections are **system-managed** (auto-appear when conditions are met), unlike BYOK and custom providers which are user-added. **When present, they always render at the top of the panel** (OpenCode first, Copilot Plus second), above any user-added providers.

- **No API key input.** They use either no auth (OpenCode-provided) or the Copilot Plus license (Copilot Plus).
- **No `[+ Add models]` button.** The catalog is curated by Copilot/OpenCode; users can only toggle visibility of what's offered, not add arbitrary models.
- **No `[Remove provider]` button.** They can't be removed individually — only by uninstalling OpenCode or letting the Plus license lapse.
- **Section header shows a status badge** to clarify entitlement:
  - **OpenCode** section: `[✓ Detected]` or `[⚠ Not installed]`. When not installed, the section is rendered greyed with a "Install OpenCode in the Agent tab to unlock these models" inline link.
  - **Copilot Plus** section: `[✓ Plus]` or `[🔒 Plus required]`. When the user has no Plus license, the section is rendered greyed with a "Subscribe to Copilot Plus to unlock these models" inline link. The model list is still shown so the user understands what they'd get.

---

## 6. The Agent tab (detailed)

Desktop only. Hidden on mobile. **There is no "agent mode" on/off toggle** — desktop is always agent-capable. Mobile simply hides this tab and the agent surfaces in the Models tab.

### 6.1 Anatomy

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent                                                           │
│                                                                 │
│ Run multi-turn agent sessions with tool use and file edits.     │
│                                                                 │
│ ──────────────────────────────────────────────────────────────  │
│                                                                 │
│ Active backend:                                                 │
│   (●) [opencode-logo] OpenCode   (recommended)                  │
│   ( ) Claude Code                                               │
│   ( ) Codex                                                     │
│                                                                 │
│ ──────────────────────────────────────────────────────────────  │
│                                                                 │
│ [OpenCode panel — shown when selected]                          │
│   Binary: /usr/local/bin/opencode                               │
│   [Auto-detect] [Browse...] [Install [opencode-logo] OpenCode]  │
│   Status: ✓ Detected (v0.4.2)                                   │
│                                                                 │
│   Default agent model:  [ Claude Sonnet 4.5 ▾ ]                 │
│     (Filtered to 🤖-capable models registered for OpenCode —    │
│      BYOK providers, custom providers, Big Pickle, Plus Flash)  │
│                                                                 │
│   Default reasoning effort: ( ) Minimal  ( ) Low                │
│                             (●) Medium   ( ) High               │
│                                                                 │
│   Models                                                        │
│   Managed in Models tab. → Open Models tab                      │
│                                                                 │
│                                                                 │
│ [Claude Code panel — shown when selected]                       │
│   Binary: /usr/local/bin/claude                                 │
│   [Auto-detect] [Browse...] [Install Claude Code]               │
│   Status: ✓ Detected (v1.2.0)                                   │
│                                                                 │
│   Subscription: Authenticated as zerolxy@gmail.com              │
│   [Re-authenticate]                                             │
│                                                                 │
│   Visible models in picker:                                     │
│     ☑ claude-sonnet-4-5                                         │
│     ☑ claude-opus-4-1                                           │
│     ☐ claude-haiku-4-5                                          │
│                                                                 │
│   Default agent model:  [ claude-sonnet-4-5 ▾ ]                 │
│     (Filtered to visible models above)                          │
│                                                                 │
│   Default reasoning effort: ( ) Minimal  ( ) Low                │
│                             (●) Medium   ( ) High               │
│                                                                 │
│                                                                 │
│ [Codex panel — shown when selected]                             │
│   ...analogous to Claude Code: binary, auth, visible models,    │
│   Default agent model, Default reasoning effort...              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Icon usage note.** Use the OpenCode logo icon next to the OpenCode radio option, the OpenCode install button, and any other place OpenCode is referenced (Models panel section header, in-chat indicators, status badges). Apply consistently — never substitute a generic placeholder.

### 6.2 Backend radio behavior

Three radio options. Each radio reveals its own configuration block below the selector. Only one backend is "active" at a time; the others stay configured (paths, visibility lists, defaults are preserved per-backend so switching back doesn't lose state). The active backend's Default agent model and Default reasoning effort seed the chat input on session start.

### 6.3 OpenCode panel

Four key elements:
1. **Binary path + install** — detects existing OpenCode in PATH; if missing, "Install OpenCode" button downloads + installs into the plugin's known location. Status line shows version when detected. Uses the OpenCode logo icon.
2. **Default agent model** — dropdown filtered to every 🤖-capable model from the unified Models registry (BYOK + custom + Big Pickle + Copilot Plus Flash). This is the model OpenCode boots with for a new agent session. Independent of the Default chat model in the Models tab.
3. **Default reasoning effort** — radio with four levels (Minimal / Low / Medium / High). Applies to reasoning-capable models when run through OpenCode. Maps to the existing per-backend effort knob in the codebase.
4. **Models link** — no inline model list. Catalog is managed in the Models tab; one-line explainer and deep link.

### 6.4 Claude Code / Codex panels

Five key elements:
1. **Binary path + install** — same pattern as OpenCode.
2. **Authentication** — see §6.5.
3. **Visible models in picker** — inline checklist of that backend's bundled models. The bundled list is small (4–8 entries), maintained in plugin code, refreshed on plugin update. Each row: checkbox + model id. No 💬/🤖 badges (entire list is 🤖-only by definition).
4. **Default agent model** — dropdown filtered to the **visible** models in this backend. Used as the seed model when starting a Claude Code / Codex session.
5. **Default reasoning effort** — radio with four levels (Minimal / Low / Medium / High). Applies to reasoning-capable models in this backend.

If the binary isn't detected, the visible-models list still renders (so the user can pre-configure visibility before installing) but the Default agent model picker shows a "Install [backend] to use" empty state.

### 6.5 Authentication state (Claude Code / Codex only)

Claude Code and Codex auth via the binary's own subscription flow (not BYOK). The panel surfaces:
- Authenticated user (e.g. "Authenticated as zerolxy@gmail.com")
- "Re-authenticate" button → triggers the binary's auth refresh
- Unauthenticated state: "Not signed in. Open Claude Code to sign in." with helper link.

---

## 7. Dialogs (detailed)

Three dialogs in this redesign:
- **Add Provider** dialog (§7.1) — triggered from `[+ Add provider]` at the top of the Models panel (or from the empty-state CTA). Picks which provider to add.
- **Add Models** dialog (§7.2) — triggered from `[+ Add models]` inside a provider section. Picks which models from that provider to enable.
- **Add Custom Provider** dialog (§7.8) — a variant of Add Provider when the user picks the "Custom" option.

### 7.1 Add Provider dialog

Modal opened by `[+ Add provider]` (top-right of populated Models panel, or center CTA on empty state). Lists every provider the plugin supports, plus a "Custom" option for arbitrary endpoints.

```
┌─────────────────────────────────────────────────────────────────┐
│ Add a provider                                            [X]   │
│                                                                 │
│ [🔍 Search providers...                                      ]  │
│                                                                 │
│  Recommended                                                    │
│    Anthropic              Claude family                         │
│    OpenAI                 GPT family                            │
│    Google                 Gemini family                         │
│                                                                 │
│  More providers                                                 │
│    Groq                   Fast inference, open-weight models    │
│    Mistral                Mistral & Mixtral                     │
│    xAI                    Grok family                           │
│    DeepSeek               DeepSeek family                       │
│    OpenRouter             Aggregator (Anthropic, OpenAI, …)     │
│    Cohere                                                       │
│    Azure OpenAI                                                 │
│    AWS Bedrock                                                  │
│    GitHub Copilot                                               │
│    Together                                                     │
│    Fireworks                                                    │
│    Perplexity                                                   │
│                                                                 │
│  ──────────────────────────────────────────────                 │
│    + Custom OpenAI-compatible endpoint                          │
│      Ollama, vLLM, LM Studio, self-hosted, etc.                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Selecting a built-in provider closes this dialog and adds a new section to the Models panel for that provider, expanded with the API key input focused. Recommended providers (Anthropic, OpenAI, Google) appear at the top; the rest are alphabetical. Already-added providers are filtered out of the list (and the search) so users can't accidentally add a duplicate. **OpenCode** and **Copilot Plus** never appear in this list — they're system-managed and auto-appear when conditions are met.

Selecting "Custom OpenAI-compatible endpoint" opens the Add Custom Provider dialog (§7.8).

### 7.2 Add Models dialog (BYOK providers)

Modal dialog. Pre-scoped to the provider the user clicked from. Shows the **full provider catalog** with search and filters. User checks the rows they want; closing the dialog adds them to the enabled list.

```
┌─────────────────────────────────────────────────────────────────┐
│ Add Anthropic models                                       [X]  │
│                                                                 │
│ [🔍 Search models...                                         ]  │
│                                                                 │
│ Filters: [ All ] [ Vision ] [ Reasoning ] [ Tool use ]          │
│                                                                 │
│  ☑ Claude Sonnet 4.5         200k ctx · Vision · Reasoning      │
│    Latest balanced model                                        │
│                                                                 │
│  ☑ Claude Opus 4.1           200k ctx · Vision · Reasoning      │
│    Best reasoning                                               │
│                                                                 │
│  ☐ Claude Haiku 4.5          200k ctx · Vision                  │
│    Fast & cheap                                                 │
│                                                                 │
│  ☐ Claude Sonnet 3.7         200k ctx · Vision · Reasoning      │
│    Previous generation                                          │
│                                                                 │
│  ☐ Claude Haiku 3.5          200k ctx                           │
│                                                                 │
│  ...more...                                                     │
│                                                                 │
│  2 selected           [Cancel]  [Add 2 models]                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Catalog source for the dialog

Reads from the same source that powered the Models panel (OpenCode if available, bundled snapshot otherwise — see §2). Already cached, no network call when the dialog opens.

### 7.4 Search and filters

- **Search box** — fuzzy match against model name, family, and description.
- **Capability filters** — chip buttons for Vision, Reasoning, Tool use, Attachments. Multi-select.
- **Sort** — default by recency (release date desc). Optionally by name or context window.

### 7.5 Already-enabled models in the dialog

Models already in the registry render with their checkbox pre-checked and disabled (no double-add). A small text label "Already added" replaces the description.

### 7.6 "Custom model" escape hatch

Below the catalog list: a small "+ Add a model not listed here" link that opens a sub-form with three fields:
- Display name
- Model ID (the string the API expects)
- Capabilities (Vision / Reasoning / Tool use checkboxes)

For users who need to use a model the catalog doesn't know about (just-released models, fine-tunes, etc.).

### 7.7 OpenRouter special case

OpenRouter exposes hundreds of models from many upstream providers. The dialog gets a secondary grouping by upstream provider (Anthropic, OpenAI, Mistral, etc.) shown as sticky section headers within the scroll. Search still cross-cuts. The capability filters become especially important here.

### 7.8 Add Custom Provider dialog

Triggered when the user selects "+ Custom OpenAI-compatible endpoint" from the Add Provider dialog (§7.1).

Form fields:
- **Display name** (e.g. "Ollama local", "Office vLLM")
- **Provider type** (radio: OpenAI-compatible / Anthropic-compatible / Google-compatible — drives request format)
- **Base URL** (e.g. `http://localhost:11434/v1`)
- **API key** (optional — many local servers don't require one)
- **Available in agent mode** (checkbox, default on; hidden on mobile)

On submit, the provider is created as a new top-level section in the Models panel (alongside Anthropic/OpenAI/etc. — not nested under a "Custom" group). The dialog then transitions to "Add models for [Display name]" (analogous to §7.2) so the user can immediately pick models. For local servers, the dialog tries to call the provider's `/models` endpoint to populate the catalog; on failure, it falls back to the "add manually" form (§7.6).

### 7.9 Verification on add

When the dialog closes with new selections, the plugin verifies each added model by issuing a minimal test call ("hello, reply ok"). On failure, the model appears in the list with a warning icon and a tooltip ("Last verification failed — click to retry"). The user can still keep it (some endpoints don't support the test call but work fine for real prompts).

---

## 8. Critical user journeys (walk-throughs)

These are the journeys the designer should mock in detail. Each is a multi-screen flow.

### 8.1 First-run desktop (agent-first, three onboarding paths)

**Goal:** New user gets to a working agent in under 60 seconds.

The welcome panel is **agent-first**. Chain-mode chat exists but is intentionally de-emphasized — the welcome doesn't prompt for chat setup. The three primary paths are:

- **"Use my existing subscription"** — for users with Claude Code or Codex installed/subscribed. Opens Agent tab pre-selected to whichever backend the plugin can detect.
- **"Bring my own key"** — for users who already have a provider API key (Anthropic, OpenAI, etc.). Opens Models tab with the Add Provider dialog already showing.
- **"Subscribe to Copilot Plus"** — for users who'd rather pay Copilot than juggle keys. Opens the Plus subscription flow; on success, the Copilot Plus section auto-appears in the Models panel and the user is dropped into the Agent tab with OpenCode pre-installed.

Below the three primary buttons, a small secondary link reads: "Just want simple chat? Skip agent setup →" — clicking it opens the Models tab without any agent guidance.

**Walkthrough — "Use my existing subscription" (e.g. Claude Code):**

1. User installs the plugin, opens Obsidian, opens Copilot for the first time.
2. Welcome panel shows the three buttons. User clicks **"Use my existing subscription."**
3. Sub-picker shows: Claude Code / Codex. User picks Claude Code.
4. Agent tab opens with Claude Code selected. Binary auto-detected at `/usr/local/bin/claude` → ✓ Detected.
5. Auth status: "Not signed in. [Sign in via Claude Code]." User clicks → Claude Code's auth flow runs in a child process → user completes auth.
6. Status updates: "Authenticated as user@example.com." Claude Code's bundled model list lights up. Default agent model = Sonnet (auto). Default effort = Medium (auto).
7. Done. User closes settings, opens a chat, sends a message. Sonnet runs via Claude Code.

**Walkthrough — "Bring my own key":**

1. User clicks **"Bring my own key."**
2. Models tab opens. Add Provider dialog is **already showing** (no extra click).
3. User picks Anthropic. Dialog closes; Anthropic section appears expanded with key input focused.
4. User pastes key. ✓ Verified.
5. Add Models dialog opens with recommended Anthropic models pre-checked. User accepts.
6. Default chat model auto-populates with Sonnet 4.5.
7. A non-intrusive next-step prompt: "Set up the agent so models work in agent sessions too." → Switches to Agent tab, OpenCode pre-selected, **"Install OpenCode"** button prominent.
8. User clicks Install. Progress, then ✓ Detected.
9. OpenCode's Default agent model picker auto-populates with Sonnet 4.5 (the BYOK model). Default effort = Medium.
10. Done.

**Walkthrough — "Subscribe to Copilot Plus":**

1. User clicks **"Subscribe to Copilot Plus."**
2. Copilot's Plus subscription flow runs (out of scope for this redesign — handled by license management).
3. On success, the plugin installs OpenCode automatically in the background.
4. User is dropped into the Agent tab. OpenCode pre-selected. Status ✓ Detected. The Copilot Plus section in the Models tab is now active with Copilot Plus Flash available.
5. Default agent model auto-set to Copilot Plus Flash. Default effort = Medium.
6. Done.

### 8.2 Add a model from OpenRouter (hundreds of models)

1. User has already added OpenRouter as a provider and entered the API key.
2. User clicks `[+ Add models]` in the OpenRouter section.
3. Add Models dialog opens, scoped to OpenRouter, showing hundreds of models grouped by upstream provider (Anthropic, OpenAI, Mistral, etc.) with sticky section headers.
4. User types "sonnet" in the search box → list filters live to ~6 matches across upstream providers.
5. User applies the "Vision" filter → list filters further.
6. User checks "Claude Sonnet 4.5" and "Gemini 2.5 Flash" → counter at the bottom updates to "2 selected".
7. User clicks "Add 2 models." Dialog closes. Both models appear in the OpenRouter section's enabled list with verification spinners → ✓ within 2s each.

### 8.3 Add a local Ollama provider

1. User clicks `[+ Add provider]` at the top of the Models panel.
2. Add Provider dialog (§7.1) opens. User scrolls down and clicks "+ Custom OpenAI-compatible endpoint."
3. Add Custom Provider dialog (§7.8) opens.
4. User fills in: Display name = "Ollama (local)", Provider type = OpenAI-compatible, Base URL = `http://localhost:11434/v1`, API key empty, "Available in agent mode" checked.
5. User clicks "Continue."
6. Dialog transitions to "Add models for Ollama (local)." The plugin pinged `http://localhost:11434/v1/models` and got back a list of locally installed Ollama models. The user sees them as a checklist.
7. User checks "llama3.2:latest" and "qwen2.5-coder:7b." Clicks "Add 2 models."
8. Dialog closes. The Ollama section now exists in the Models panel at the **top level** alongside Anthropic/OpenAI/etc. (not nested under any "Custom providers" wrapper). Both models showing 💬 🤖 badges.
9. Both models are immediately available in the chat input picker. If OpenCode is running, both are also runnable in agent mode — the plugin has registered Ollama as a custom provider in OpenCode's config.

### 8.4 Change Claude Code agent visibility

**Pre-condition:** User has Claude Code as their active agent backend.

1. User opens Settings → Agent tab.
2. Claude Code section is expanded (it's the active backend).
3. User scrolls to "Visible models in picker." Sees 4 checkboxes:
   - ☑ claude-sonnet-4-5
   - ☑ claude-opus-4-1
   - ☑ claude-haiku-4-5
   - ☑ claude-sonnet-3-7
4. User unchecks claude-haiku-4-5 and claude-sonnet-3-7.
5. State persists immediately (no Save button — inline persistence pattern from existing Copilot settings).
6. User closes settings, opens the chat input, clicks the agent model picker. Only Sonnet 4.5 and Opus 4.1 appear in the dropdown.

### 8.5 Switch agent backends (OpenCode → Codex)

1. User opens Settings → Agent tab.
2. User clicks the "Codex" radio.
3. OpenCode panel collapses. Codex panel expands.
4. Codex panel shows: binary not detected, install button, sub-only model checklist (empty defaults).
5. User clicks "Install Codex." Progress, then ✓ Detected.
6. User clicks "Sign in to Codex" → opens binary auth flow in a child process. User completes auth in browser. Status updates to "Authenticated as user@example.com."
7. Codex's bundled model list lights up. User leaves defaults checked.
8. Default agent model picker now lists Codex's visible models. User picks GPT-5. Default effort = Medium (auto).
9. Done. The chat input model picker now shows Codex's models under a "Codex" group. The user picks one from there to start a session; the backend switches accordingly.

### 8.6 Offline (no network)

**Scenario:** User opens Settings → Models on a laptop without internet.

1. Models panel opens normally — the bundled catalog (shipped with the plugin) powers the Add Models dialog. No network call is needed for the catalog to render.
2. User clicks `[+ Add provider]` → picks Anthropic → enters the key.
3. Key verification call fails (no network). The key is stored but the section shows "⚠ Couldn't verify — offline. Will verify when online."
4. User clicks `[+ Add models]` → Add Models dialog opens from the bundled catalog — full provider model list available.
5. User adds two models. Their verification calls also fail. They appear in the list with ⚠ icons and tooltip "Couldn't verify — offline. Will retry when used."
6. Later, when online, the next real use of the models succeeds and the warning icons disappear automatically.

### 8.7 OpenCode not installed — graceful degradation

1. User has OpenCode selected as backend, but binary is missing.
2. Models tab still renders. Catalog source falls back to bundled snapshot. The **OpenCode** section is shown but greyed with "Install OpenCode to unlock these models." The **Copilot Plus** section is shown the same way (also requires OpenCode at runtime).
3. 🤖 badges still appear on cloud BYOK models (because they would work via OpenCode if it were installed). A small banner at the top of the Models tab: "OpenCode isn't installed yet. Models with the 🤖 badge will work once you install it. → Go to Agent tab."
4. User can keep configuring chat models normally; chain-mode chat works.
5. When user installs OpenCode (via Agent tab), the banner disappears, the catalog source switches to OpenCode, the OpenCode and (if Plus) Copilot Plus sections light up with their model lists.

### 8.8 Remove a model entirely

1. User in Models tab, hovers a row, clicks `⋯`.
2. Menu: "Set as default chat" (if 💬-capable) | "Remove from registry"
3. Clicks Remove. Inline confirmation: "Remove Claude Haiku 4.5? You can add it back from + Add models." [Cancel] [Remove]
4. Row disappears. If it was the Default Chat Model, the default reverts to the next enabled chat-capable model. If it was a Default Agent Model for any backend, that backend's default reverts to its first visible model.

### 8.9 Edit a custom provider's base URL

1. User in Models tab finds the Ollama (local) section at the top level (alongside Anthropic etc., not nested).
2. Clicks `[Change]` next to "Base URL: http://localhost:11434".
3. Modal opens with the existing fields pre-filled. User changes URL to `http://my-server.tailnet.ts.net:11434/v1`.
4. Saves. Plugin pings the new URL. ✓ Verified. Existing models stay in the registry.
5. If the new URL doesn't return the expected model IDs, the models in this provider's enabled list show ⚠ warnings — the user is told "These models weren't found at the new URL. Remove them?" with a [Remove these models] action.

---

## 9. Empty / loading / error states

The designer must mock these explicitly — they're at least as common as the happy path.

### 9.1 Empty registry (no providers yet)

This is the **default state** of the Models tab on first launch. See §5.1 for the full anatomy. The single primary CTA is `[+ Add provider]`. Helper copy invites both BYOK and custom endpoints. There are no provider shortcut buttons — selection happens inside the Add Provider dialog (§7.1).

### 9.2 Polling OpenCode for catalog

Brief skeleton state on Models tab open while the plugin queries OpenCode for its live catalog. Usually <500ms — should not flash a heavy spinner. Use shimmer skeletons on the provider sections. When OpenCode isn't installed, this state is skipped — the bundled catalog renders immediately.

### 9.3 Invalid API key

Inline below the key input, red text:

```
⚠ Couldn't verify your key. Check that it's correct and has access to chat models.
[Re-enter key] [Get a new key]
```

The "Get a new key" link goes to the provider's key management page.

### 9.4 Model verification failed

On adding a model that fails its test call, the row in the enabled list shows ⚠ next to the model name. Tooltip: "Last verification failed: <error message>". Click ⚠ → small popover with [Retry] and [Remove from registry].

### 9.5 OpenCode binary detected at unexpected location

If the user has both a plugin-installed binary and a system-wide binary, the Agent tab shows both and lets the user pick. Helper text: "Two OpenCode installations detected. Choose which one to use."

### 9.6 No models enabled

Models panel "Default model" picker is empty. Show inline: "No models enabled yet. Add a provider above to pick models."

### 9.7 Subscription not authenticated (Claude Code / Codex)

Backend panel shows:
```
Not signed in to Claude Code.
[Sign in via Claude Code] (opens binary auth flow)
```
Models list is greyed.

---

## 10. Platform considerations

### 10.1 Desktop vs mobile

| Aspect | Desktop | Mobile |
|---|---|---|
| Agent tab | Visible | Hidden entirely |
| 🤖 badges | Visible | Hidden everywhere |
| OpenCode section (Big Pickle, etc.) | Visible | Hidden |
| Copilot Plus section (Plus Flash, etc.) | Visible | Hidden |
| Custom provider "Available in agent mode" toggle | Visible | Hidden (default off, can't be enabled) |
| Settings modal width | ~700–900px | Full-screen overlay |
| Touch targets | Default | Min 44pt |

### 10.2 Obsidian theme

The Obsidian shell exposes CSS variables for colors, spacing, radii, fonts. Mockups should look native to a default Obsidian dark theme but also work in light theme. Avoid full-bleed color blocks or unique typography that breaks theme expectations.

### 10.3 Settings modal constraints

Copilot's settings live inside the Obsidian modal. The tab list runs **horizontally across the top of the modal** (this is how Copilot's existing settings work — it is not Obsidian's stock left-rail pattern). The content area scrolls vertically below the tabs.

- Width: bounded by Obsidian modal (assume ~800px for mockup).
- Tabs: horizontal strip at the top of the modal (Basic, Models, Agent, Chat & Commands, …).
- Content: scrolls vertically beneath the tabs.
- Nested dialogs (Add Provider, Add Models, Add Custom Provider) overlay the modal at ~80% of its area — not full screen.

### 10.4 Persistence

All settings persist immediately on change (no Save button). This is the existing Copilot pattern.

---

## 11. Migration

Existing users on the current settings will, on first launch after this redesign ships:

1. Existing provider keys → preserved as-is. Providers with a configured key auto-appear as sections in the new Models panel (without the user having to re-add them via Add Provider).
2. Existing `activeModels` array → preserved; each model lands in the appropriate provider section.
3. Existing per-model overrides (temperature, max_tokens, etc.) → **dropped silently.** All chains revert to defaults. No notice shown (the cohort that notices is tiny).
4. Existing agent-mode-specific model curation (`modelEnabledOverrides` for OpenCode) → merged into the unified registry's enabled state.
5. Existing default chat model → preserved as the **Default Chat Model** in the Models tab.
6. Existing per-backend agent defaults (Default Agent Model, Default reasoning effort) → preserved per backend in the Agent tab. If any backend lacks a saved default, seed with the backend's first visible model and Medium effort.
7. Existing "agent mode enabled" boolean → **discarded.** Agent capabilities are always available on desktop; the per-user toggle no longer exists.

The designer doesn't need to design a migration UI. There isn't one.

---

## 12. Out of scope (explicit)

- **Embedding models.** They live in a separate "Embeddings" panel that this redesign does not touch.
- **Reranker models.** Same — separate, untouched.
- **License / Plus / Believer tier management.** Separate panel, not part of this redesign.
- **Chat UI.** The redesigned model picker dropdown inside the chat input is technically a consumer of the unified registry, but its design is owned by the chat redesign work (separate).
- **Skills / Custom commands / MCP servers.** Separate panels.
- **Per-model temperature / max_tokens / system prompt.** Removed. Don't design for them.
- **Drag-to-reorder models.** Out. Sort alphabetically or by provider.

---

## 13. Glossary

- **BYOK** — Bring Your Own Key. The user supplies an API key from their provider account.
- **Chain mode** — Single-turn LLM calls via LangChain. Powers chat, custom commands. Works on mobile.
- **Agent mode** — Multi-turn agent sessions via an external binary backend. Desktop-only.
- **OpenCode** — Copilot's recommended agent backend. Open source, BYOK, supports many providers. Ships with a bundled `models.dev` catalog and a set of free models (Big Pickle, etc.).
- **Claude Code** — Anthropic's official agent CLI. Subscription-based, Claude-only.
- **Codex** — OpenAI's official agent CLI. Subscription-based, GPT-only.
- **Big Pickle** — A free model bundled with OpenCode. No BYOK or license required. Agent-only (requires OpenCode installed).
- **Copilot Plus** — Copilot's paid subscription tier. Unlocks access to hosted models served by Copilot (e.g. Copilot Plus Flash).
- **Copilot Plus Flash** — A paid hosted model served by Copilot, available to Copilot Plus subscribers. Routed through OpenCode at runtime. Agent-only.
- **`models.dev`** — An open catalog of LLM models across providers with metadata (context, pricing, modalities, capabilities). The plugin ships a tree-shaken snapshot of this catalog. There is **no live refresh** in this design — the user sees whatever ships with the plugin (or whatever OpenCode provides). Catalog updates ride along with plugin or OpenCode updates.
- **Capability badges** — 💬 (chat-capable) and 🤖 (agent-capable) icons shown next to each enabled model.
- **Default Chat Model** — One global setting (lives in Models tab). The model used for chain-mode chat: mobile chat, custom commands, simple chat. Must be 💬-capable.
- **Default Agent Model** — One **per agent backend** (lives in the Agent tab, inside each backend's panel). The model used when starting an agent session in that backend. Must be 🤖-capable and visible in that backend.
- **Default Reasoning Effort** — One **per agent backend** (lives in the Agent tab). Four levels: Minimal / Low / Medium / High. Applies to reasoning-capable models in that backend.
- **Registry** — The user's enabled models. Curated, not the full catalog. The list users see in the Models panel.
- **Catalog** — The full list of available models for a provider. Not all of them are in the user's registry.
- **Provider section** — A collapsible card per provider in the Models panel (Anthropic, OpenAI, Ollama, etc.). Created when the user adds the provider, or auto-created for OpenCode and Copilot Plus when conditions are met.
- **Custom provider** — A user-defined OpenAI-compatible (or similar) endpoint, e.g. Ollama or a self-hosted server. Appears at the top level of the Models panel alongside built-in providers, **not** nested under a "Custom" wrapper.
- **LangChain** — The library Copilot uses to instantiate and call provider SDKs in chain mode.

---

## 14. Design deliverables expected from the next designer

1. **Wireframe designs** for:
   - Models panel — **empty state** (default for new users; see §5.1)
   - Models panel — **populated state** with OpenCode + Copilot Plus pinned at the top, BYOK providers (Anthropic, OpenAI, …) and custom providers (Ollama) below in user-added order (§5.2)
   - Models panel — mobile variant (no 🤖 badges, no OpenCode / Copilot Plus sections; no mobile-specific onboarding — same panel as desktop, fewer surfaces)
   - **Add Provider dialog** (§7.1) — list of built-in providers + Custom option
   - **Add Models dialog** — two variants: Anthropic-style (~5 models) and OpenRouter-style (hundreds of models with sticky upstream-provider headers)
   - **Add Custom Provider dialog** (both step 1 form and step 2 model picklist)
   - **Agent tab** with OpenCode active — including Default agent model picker and Default reasoning effort radio (§6.1 / §6.3)
   - **Agent tab** with Claude Code active — visibility checklist + Default agent model + Default reasoning effort (§6.4)
   - **Agent tab** with Codex active — analogous to Claude Code
2. **First-run welcome panel** with the **three primary buttons** (Use existing subscription / Bring my own key / Subscribe to Copilot Plus) plus the secondary "Just want simple chat?" link. See §8.1.
3. **All empty / loading / error states** listed in §9.
4. **Interaction notes** for hover menus, tooltips on badges, dialog transitions, provider section collapse/expand, and the auto-appearance + top-pinning of OpenCode / Copilot Plus sections.
5. **OpenCode icon treatment** — define the icon size, where it appears, and how it integrates with section headers, buttons, radios, and status badges.
6. **A few "before/after" comparison frames** showing how this consolidates the current three surfaces (the existing surfaces are described in §0 and the user requirements in §3 — no codebase access needed).

Things explicitly **not** to design:
- An "agent mode on/off" toggle — there is none. Desktop is always agent-capable.
- A dedicated mobile onboarding flow — mobile is ~1% of traffic; reuse the desktop Models panel with agent surfaces hidden.
- Chat-first welcome states — the welcome is agent-first; chat-only setup is a secondary link.

When in doubt, optimize for **the first-run user finishing agent setup in under 60 seconds** and **the power user with 30+ enabled models keeping the panel scannable**. Those two opposing forces are the design tension to resolve.
