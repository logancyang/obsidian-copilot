# Settings Redesign PRD — Copilot for Obsidian

**Status:** Draft for design handoff
**Audience:** Senior product designer (Claude Design) doing IA work
**Out of scope:** Visual restyling, color/typography choices, chat UI redesign, settings storage schema

---

## 1. Context & Problem

Copilot for Obsidian currently exposes **~150 user-configurable settings** across 7 tabs (Basic, Model, QA, Command, Plus, Advanced, Agent). The information architecture has accumulated through feature additions rather than user-journey design. The result:

- Beginners encounter expert knobs (lexical search RAM limit, embedding batch size, partition count, auto-compact token threshold, agent backend internals) on the same page as their first decisions (default model, send shortcut). They get confused and bounce.
- Related settings live in different surfaces. API keys hide in a modal launched from Basic. Custom system prompts hide in Advanced. Plus features render conditionally inside a sub-component. Self-host/Miyo settings only appear after server-side eligibility checks pass.
- Conditional/nested settings have no discoverability. A user who isn't sure if a setting exists can't find out without trial and error.
- There's no settings search.
- Deprecated and unused settings (`autoIncludeTextSelection`, `chatNoteContextPath`, `inlineEditCommands`, `stream`) still ship in the schema.

**This redesign happens in parallel with the ACP-Centric Revamp** (see audit at `~/Developer/zeroliu_second_brain/notes/Copilot Feature Audit for ACP - Centric Revamp.md`), which collapses the four chat modes (Chat / Vault QA / Copilot Plus / Projects) into one chat surface with a single Agent Mode toggle, retires `@`-commands, converts custom prompts and custom commands into "skills," and adds a dedicated Agent Mode configuration tab. **This PRD describes the post-revamp world**, not today's state. Settings being dropped in the revamp are listed in §6 so the designer doesn't design around them.

### Success criteria

1. **Beginner finishes setup in <60 seconds.** API key in, default model picked, chat works.
2. **Power user can still find every knob.** No setting goes missing; advanced surfaces are reachable in ≤2 clicks from any entry.
3. **Agent Mode is a first-class section** with a clean per-backend pattern.
4. **Settings search exists** and reduces "where is X" support questions.
5. **Locked / eligibility-gated states are explicit** — never silently hidden.

---

## 2. Users & Audiences

Four tiers, used as labels throughout this doc. Use them to drive progressive disclosure.

| Tier             | Description                                                                                                      | What they configure                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Beginner**     | Just installed Copilot. Has an API key from one provider. Doesn't know what an embedding is. Wants chat to work. | API key, default model, where chat opens, send shortcut.                                                                       |
| **Intermediate** | Several weeks in. Has a saved-conversations workflow. Uses vault QA. May have configured 2–3 models.             | Save folders, conversation tags, filename templates, indexing strategy, embedding model, exclusions/inclusions, skills folder. |
| **Power user**   | Multi-provider, custom models, self-hosts. Tunes rate limits and partition counts. Configures agent backends.    | Performance tuning, custom model registration, Azure/Bedrock/proxies, agent backend binaries, MCP servers, self-host/Miyo.     |
| **Developer**    | Debugging the plugin or contributing.                                                                            | Debug logs, raw ACP frame capture, log files, internal toggles.                                                                |

Each setting in §5 has a tier label.

---

## 3. Goals & Non-Goals

### Goals

- Progressive disclosure: essentials default-visible, advanced collapsed.
- A clear **quick-setup path** for first-run users.
- Settings search/filter across the entire surface.
- Distinct grouping: **credentials**, **default behavior**, **performance tuning**, **experimental**.
- Agent Mode promoted to a top-level section (per audit).
- All conditional/eligibility-gated settings have a visible "locked" state with a reason.
- A clear mobile story for desktop-only features.

### Non-Goals

- Changing the _meaning_ of any setting. This is IA only.
- Visual restyling beyond what IA decisions require.
- Modifying the underlying settings storage schema (`CopilotSettings` interface).
- Redesigning the chat UI, command palette, or modals.
- Adding new functionality. (Skills replace custom prompts/commands as part of the parallel ACP revamp — that work is upstream of this PRD; here we just need to know skills exist.)

---

## 4. Platform & Tier Constraints

The designer must respect these. They're not negotiable.

### Obsidian native settings shell

The plugin renders inside Obsidian's settings modal. Standard convention is a left-rail tab list with a scrollable right-pane content area. Redesigns can deviate, but they must still feel native to Obsidian — no full-bleed marketing pages, no animated backgrounds, no overlays that obscure the modal chrome. Width is constrained by the Obsidian modal (roughly 700–900px effective).

### Mobile vs desktop

- **Agent Mode is desktop-only.** External ACP backends (opencode / claude-code / codex) require local binaries; mobile cannot run them. The legacy in-process agent is the only path on mobile.
- **Vault index can be disabled on mobile** (default on) to save battery/storage.
- The settings UI must degrade gracefully on Obsidian mobile (smaller width, touch targets). Desktop-only sections should be visible on mobile but show a "desktop only" state — don't hide them silently or users will think they don't exist.

### Plus / Believer / Self-host tiers

- **Free** — BYOK API keys, vault QA with own embeddings, basic agent (legacy).
- **Plus** — hosted models, web search, YouTube transcripts, PDF parsing, reranker, memory.
- **Believer** (lifetime supporter) — unlocks Self-host mode + Miyo (private indexing infra).

When a feature requires a tier the user doesn't have, **show the section with a locked state** and a one-line "what this does + how to unlock." Don't hide it silently.

### Eligibility-gated settings

Some panes (Self-host activation, Miyo enable) require live server-side validation. The 3-strike grace flow allows up to 3 successful validations to grant offline-permanent access. Designer needs a UI pattern for **"verified eligible"** vs **"checking…"** vs **"not eligible — here's why"** states.

### Settings that trigger expensive work

Some settings cause heavy side effects when changed. The IA must surface this **inline at the setting**, not in a separate "danger zone."

- Changing the embedding model → full vault reindex.
- Changing partition count → index rebuild.
- Toggling semantic search on/off → index state changes.
- Disabling index sync → moves index to/from `.obsidian` folder.

---

## 5. Settings Inventory — Post-Revamp State

Settings are grouped by **functional purpose**, not by current tab. The designer decides where each group lives in the new IA. Each setting has audience tier, default, and notes.

Tier shorthand: `B` Beginner · `I` Intermediate · `P` Power · `D` Developer.

### A. Account & Credentials

| Setting                                                                     | Tier | Default | Notes                                                                                                     |
| --------------------------------------------------------------------------- | ---- | ------- | --------------------------------------------------------------------------------------------------------- |
| Plus license key                                                            | B    | empty   | Validated online; success unlocks Plus features and triggers welcome modal. Drives visibility of group G. |
| OpenAI API key                                                              | B    | empty   | Most common; should be prominent.                                                                         |
| Anthropic API key                                                           | B    | empty   |                                                                                                           |
| Google (Gemini) API key                                                     | B    | empty   |                                                                                                           |
| OpenRouter API key                                                          | I    | empty   |                                                                                                           |
| Cohere API key                                                              | I    | empty   | Often used for embeddings/reranker.                                                                       |
| Groq, Mistral, xAI, DeepSeek, SiliconFlow, HuggingFace API keys             | I    | empty   | Long tail; collapse.                                                                                      |
| OpenAI org id                                                               | I    | empty   |                                                                                                           |
| OpenAI proxy base URL                                                       | P    | empty   | Custom OpenAI-compatible endpoint.                                                                        |
| Embedding proxy base URL                                                    | P    | empty   | Separate from chat proxy.                                                                                 |
| Azure OpenAI (api key, instance, deployment, version, embedding deployment) | P    | empty   | Five fields, only meaningful together.                                                                    |
| AWS Bedrock (api key, region)                                               | P    | empty   | Two fields, only meaningful together.                                                                     |
| GitHub Copilot (access token, token, expiry)                                | P    | empty   | OAuth-driven; expiry auto-refreshed.                                                                      |

**Today** these live in a separate modal (`ApiKeyDialog`) launched from Basic. Open question: should they stay modal or move inline into the IA?

### B. Default Chat Behavior

| Setting                         | Tier | Default                                 | Notes                                                                                                         |
| ------------------------------- | ---- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Default chat model              | B    | `google/gemini-2.5-flash\|openrouterai` | The single most important setting. Drives 90% of UX. Picker reads from enabled chat-model registry (group D). |
| Send shortcut                   | B    | Enter                                   | Enter vs Shift+Enter.                                                                                         |
| Where chat opens                | B    | Sidebar view                            | Sidebar vs main editor.                                                                                       |
| Auto-add active note to context | B    | on                                      | Convenience.                                                                                                  |
| Auto-add selection to context   | B    | off                                     |                                                                                                               |
| Pass markdown images            | I    | on                                      | Only meaningful with multimodal models.                                                                       |
| Show suggested prompts          | B    | on                                      | UI affordance toggle.                                                                                         |
| Show relevant notes             | B    | on                                      | UI affordance toggle.                                                                                         |

### C. Conversation Storage

| Setting                  | Tier | Default                         | Notes                                                                |
| ------------------------ | ---- | ------------------------------- | -------------------------------------------------------------------- |
| Autosave chat            | B    | on                              | Saves after each turn.                                               |
| Save folder              | B    | `copilot/copilot-conversations` |                                                                      |
| Default conversation tag | B    | `copilot-conversation`          |                                                                      |
| Filename template        | I    | `{$date}_{$time}__{$topic}`     | Variables: `{$date}`, `{$time}`, `{$topic}`. Must include all three. |
| AI-generated chat titles | I    | on                              | When off, falls back to first ~10 words.                             |
| Chat history sort        | B    | recent                          | recent / created / name / manual.                                    |
| Project list sort        | B    | recent                          | Same options.                                                        |

### D. Models — Chat & Embedding Registries

These are **CRUD surfaces**, not single-value settings. The IA must accommodate list/table views inside settings.

**Chat models registry** (I→P)

- 36+ built-in models pre-populated. Enable/disable per model. Drag-reorder. Add custom model (provider, name, model id, capabilities).
- Per-model capabilities: vision, reasoning.
- Per-model overrides (where supported): temperature, max tokens, reasoning effort, verbosity.

**Embedding models registry** (I→P)

- 12 built-in. Same enable/disable pattern.
- Selected embedding model is the one used for QA. **Changing it triggers full reindex** — surface inline.

**Conversation context** (cross-cutting)

- Context turns to include in chat history (I; default 15, range 1–50). 1 turn = user message + AI reply.
- Auto-compact threshold in tokens (P; default 128000, range 64000–1000000). When context exceeds this, older turns are summarized.
- Default reasoning effort (P; for o1-class models). Values: minimal / low / medium / high.
- Default verbosity (P; for GPT-5 class). Values: low / medium / high.
- Default temperature (P; default 0.1).
- Default max tokens (P; default 6000).

### E. Vault Search & Indexing

| Setting                       | Tier | Default        | Notes                                                       |
| ----------------------------- | ---- | -------------- | ----------------------------------------------------------- |
| Semantic search enabled       | B    | off            | When off: lexical-only. Toggling requires reindex.          |
| Inline citations in responses | B    | on             | Experimental; doesn't work with all models.                 |
| Indexing strategy             | I    | on mode switch | never / on startup / on mode switch. Cost implications.     |
| Max source chunks per QA call | I    | 30             | Range 1–128. More = slower + more context.                  |
| QA inclusions                 | I    | empty          | Folder/tag/title patterns. Empty = index everything.        |
| QA exclusions                 | I    | `copilot`      | Always includes copilot folder.                             |
| Index sync via Obsidian Sync  | I    | on             | When off: index goes to `.copilot/` instead of `.obsidian`. |
| Disable index on mobile       | B    | on             | QA modes unavailable on mobile when on.                     |

**Performance tuning (collapse by default, all P)**

- Embedding requests per minute (default 60, range 10–60).
- Embedding batch size (default 16, range 1–128).
- Index partition count (default 1; values 1, 2, 4, 8, 16, 32, 40). For large vaults. Requires rebuild on change.
- Lexical search RAM limit MB (default 100, range 20–1000).
- Lexical boosts enabled (default on). Folder/graph relevance boosts.

**Index management actions** (I) — these are buttons, not toggles. The IA needs to show actions inside a settings page gracefully.

- Rebuild index
- Force reindex
- Clear index
- Garbage-collect index
- List indexed files
- Inspect file by path
- Clear index cache

### F. Agent Mode (NEW dedicated top-level section per audit)

**Desktop-only.** On mobile, show the section with a "desktop only" explainer.

| Setting              | Tier | Default  | Notes                                      |
| -------------------- | ---- | -------- | ------------------------------------------ |
| Master enable        | P    | off      | Toggles entire agent UI.                   |
| Active backend       | P    | opencode | opencode / claude-code / codex.            |
| Max agent iterations | P    | 4        | Range 4–16.                                |
| Auto-accept edits    | P    | off      | When on, file edits apply without preview. |
| Diff view mode       | P    | split    | side-by-side / split.                      |

**Per-backend slice** — repeat this pattern for each of the 3 backends. Designer needs a clean repeating layout pattern.

- Binary path (string).
- Binary version (read-only, detected).
- Binary source: managed / custom (radio).
- Selected model key (dropdown from probe).
- Selected effort/reasoning level (where applicable; e.g., codex uses `gpt-5-codex/high`).
- Selected operational mode: default / plan / auto.
- Per-model enable/disable overrides (table or list — power users curate which models appear in the picker).

**Tools allowlist** (I) — checkbox list of tools the agent may use:

- localSearch, readNote, webSearch, pomodoro, youtubeTranscription, writeFile, editFile, updateMemory.

**MCP servers** (P) — list/CRUD surface. Each entry has: name, command/URL, args, env vars, enabled. Designer needs a list-with-edit-form pattern.

### G. Plus & Self-Host (gated)

Show as locked section when license tier is insufficient. Show eligibility-pending state when validation is in flight.

**Plus features** (require Plus license)

- Self-host search provider (P): Firecrawl / Perplexity.
- Firecrawl API key (P).
- Perplexity API key (P).
- Supadata API key (P) — for YouTube transcripts.

**Memory system** (I, experimental, Plus)

- Memory folder (default `copilot/memory`).
- Recent conversations enabled (default on).
- Max recent conversations (default 30, range 10–50).
- Saved memory enabled (default on).

**Document processor** (I, Plus)

- Converted document output folder (string; empty = don't save converted markdown).

**Self-host mode** (Believer-only — eligibility-gated)

- Self-host mode enabled (P; default off). Requires Believer license + 15-day re-validation. After 3 successful validations, becomes offline-permanent.
- Self-host backend URL (P).
- Self-host API key (P).

**Miyo (private index)** — requires self-host mode

- Miyo enabled (P; default off).
- Miyo server URL (P; empty = local discovery).
- Miyo search-all (P; default off — when off, limited to current vault folder).

### H. Skills & System Prompts

Per the ACP audit, **custom prompts and custom commands collapse into "skills."** Skills are file-based — each skill is a markdown file in a configured folder. The settings UI mostly governs _where they live_ and _how they're sorted_; the skills themselves are managed in a CRUD surface.

| Setting                      | Tier | Default                          | Notes                                                                                      |
| ---------------------------- | ---- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| Skills folder                | I    | `copilot/copilot-custom-prompts` | Auto-loads `.md` files.                                                                    |
| Default system prompt        | P    | empty                            | File name from custom system prompts folder. Empty = built-in.                             |
| Custom system prompts folder | P    | `copilot/system-prompts`         |                                                                                            |
| Skill sort                   | B    | timestamp                        | timestamp / alphabetical / manual (drag).                                                  |
| Template variables enabled   | I    | on                               | When off: raw prompt text. Variables: `{activeNote}`, `{[[Note]]}`, `{#tag}`, `{folder/}`. |

The skills _list_ itself (CRUD: create, edit, reorder, delete, toggle visibility in slash menu, toggle visibility in context menu) is the larger surface and the IA must accommodate it.

### I. Projects (referenced, not configured here)

Projects live in the chat sidebar, not the settings page. Mentioned because the designer should know:

- Per-project: system prompt, vault scope (folders/tag patterns), web/YouTube sources, context cache.
- **Per-project model and parameters are dropped in the revamp** — global default applies.

### J. System & Privacy

| Setting                  | Tier | Default | Notes                                                                                  |
| ------------------------ | ---- | ------- | -------------------------------------------------------------------------------------- |
| Encrypt API keys at rest | P    | off     | Encryption-at-rest for stored credentials.                                             |
| Debug logging            | D    | off     | Console + log file. Performance impact.                                                |
| ACP raw frame logging    | D    | off     | `agentMode.debugFullFrames`. Writes NDJSON to disk; sensitive data. Surface a warning. |
| Open log file            | D    | action  | Button.                                                                                |
| User ID                  | D    | UUID    | Read-only, auto-generated. Analytics.                                                  |

---

## 6. Removed / Deprecated (don't design around these)

These existed in the current schema but go away in the post-revamp world (per audit and cleanup pass). The designer should not surface them.

- **`defaultChainType`** — the four chat modes (Chat / Vault QA / Copilot Plus / Projects) collapse into one chat surface.
- **`@`-command syntax for tools** (`@vault`, `@web`, `@memory`) — agent calls tools directly. `@`-mention for notes/folders/tags/URLs _stays_.
- **Per-project model and parameters** — global default applies.
- **`inlineEditCommands`** — legacy command format, migrated to file-based skills.
- **`autoIncludeTextSelection`** — renamed to `autoAddSelectionToContext`.
- **`chatNoteContextPath`, `chatNoteContextTags`** — unused.
- **`stream`** — hard-coded true; not a user choice.
- **YouTube transcript modal** — dropped.
- **Agent-tool exposure of file parsing** (PDFs, images, YouTube, web URLs) — backends handle these natively.

---

## 7. New (introduced by revamp)

- **Agent Mode tab** with per-backend configuration (binary path, model, mode, model-enable overrides). See §5.F.
- **MCP server management** as a list/CRUD surface inside Agent Mode.
- **Skills** consolidate custom prompts + custom commands into one file-based system.
- **Backend session id** persisted per chat (no setting; storage detail).
- **Eligibility-gated panes** (Self-host, Miyo) with three states: not eligible, checking, verified.
- **Settings search** (new affordance — required by this redesign).

---

## 8. IA Principles (asks for the design)

1. **Quick-setup first.** New user lands on a screen that gets them to a working chat in under a minute: pick a provider, paste an API key, pick a default model. Optional: Plus license. Everything else is reachable but not in their face.
2. **Progressive disclosure.** Each section has an essentials view by default; "advanced," "performance," and "experimental" knobs collapse behind a disclosure toggle. Beginner labels never appear next to expert knobs without a separator.
3. **Settings search.** Inventory is too large to navigate by tab alone. Search/filter must work across all settings (label, description, alias).
4. **Audience tiering visible.** Power-user knobs visually distinct (subdued, badged, or grouped under "Advanced"). Beginners should see "this is normal to skip."
5. **Action surfaces inside settings.** Index rebuild, log file open, license validation, eligibility re-check are buttons, not toggles. The IA must accommodate them gracefully — don't force them into "ghost toggles."
6. **No silent hiding.** When a setting is gated by tier or eligibility, render it with a locked / not-eligible / desktop-only state. Show what unlocks it.
7. **Inline side-effect warnings.** Settings that trigger reindex / migration / restart announce that _at the setting_, not in a separate "danger zone."
8. **Mobile-aware.** Desktop-only sections (Agent Mode, parts of Self-host) need a clear story on mobile.
9. **CRUD surfaces are first-class.** Model registries, skills list, MCP servers — each is a list with rows, edit forms, and reordering. The IA pattern for "settings page that's mostly a list" should be repeatable and consistent across these three.
10. **Repeatable patterns over snowflakes.** The 3 agent backends share structure → use one component pattern. The 19 BYOK providers share structure → use one component pattern. Avoid bespoke layouts per provider/backend.

---

## 9. Open Questions for the Designer

1. **API keys: modal or inline?** Today they're behind a modal. Should they live inline in the new IA, in a dedicated "Credentials" section, or stay modal-launched from a single "Manage API keys" entry?
2. **Top-level shape:** tabbed left-rail (current), single-page-with-anchors, sidebar-tree, or hybrid? Which fits Obsidian's settings shell best given the inventory size?
3. **Model registry placement:** inside settings as a CRUD list, or in a dedicated "Models" management view reachable from settings?
4. **Skills placement:** same question — settings or dedicated management view? Skills also surface in chat (slash menu) which complicates ownership.
5. **Inline reindex warnings:** what's the right pattern? Inline banner under the setting? Confirmation modal on save? Toast after save?
6. **Plus / Self-host / Miyo grouping:** keep separate sections with their own gating, or merge into one "Cloud & self-host" group with sub-states?
7. **Locked states:** badge, disabled-with-tooltip, expandable upsell card, or something else?
8. **Search UX:** persistent search bar, command-palette-style overlay, or filter chips by audience tier?
9. **"Quick setup" path:** is it a separate screen on first run, a pinned section at the top of settings, or integrated into the chat onboarding flow?
10. **Settings density on mobile:** same layout collapsed, or a fundamentally different mobile IA?

---

## 10. Briefing Prompt for Claude Design

Paste the prompt below into a fresh Claude Design conversation alongside this document.

---

> # Brief: IA Redesign for Copilot for Obsidian Settings
>
> You are a senior product designer being asked to propose an **information architecture** redesign for the settings UI of _Copilot for Obsidian_, a popular Obsidian plugin that integrates LLM chat, vault Q&A, and an agent mode.
>
> ## What you're working from
>
> The accompanying document `SETTINGS_REDESIGN_PRD.md` is the spec. It contains:
>
> - The user audiences (Beginner / Intermediate / Power / Developer) with examples.
> - A complete inventory of every setting that exists in the post-revamp world, grouped by _functional purpose_ (not current tabs), with audience tier and notes for each.
> - Platform constraints (Obsidian's settings modal, mobile vs desktop, Plus/Believer tiers, eligibility-gated settings).
> - 10 IA principles to design against.
> - 10 open questions you're expected to engage with.
> - A list of removed/deprecated settings (don't design around those).
>
> Read it carefully before proposing anything.
>
> ## What I need from you
>
> 1. **Top-level IA proposal.** What are the top-level sections? In what order? Why?
> 2. **Section-by-section breakdown.** For each top-level section, list its sub-groups and which settings (from the PRD inventory) live there. Use the PRD's setting names verbatim so I can map back.
> 3. **Progressive disclosure pattern.** Concrete pattern for how essentials show by default and how advanced/performance/experimental knobs collapse. Show the same pattern applied to two different sections so I can see it's repeatable.
> 4. **Settings search behavior.** Where it lives, what it searches, what filters it offers, what happens when a setting is in a collapsed group or a gated section.
> 5. **Locked / eligibility states.** Visual treatment pattern for: not-Plus, not-Believer, eligibility-checking, eligibility-failed, desktop-only. Show one example per state.
> 6. **CRUD surface pattern.** A single repeatable pattern for "settings page that's mostly a list" — applied consistently to the three lists (chat models registry, skills, MCP servers). Show the pattern once and note any per-list deviations.
> 7. **Per-backend pattern (Agent Mode).** A repeatable layout for the three agent backends (opencode, claude-code, codex), since their settings share structure.
> 8. **Mobile fallback.** What happens on Obsidian mobile? Specifically, how Agent Mode appears.
> 9. **Quick-setup path.** How does a brand-new user get from "just installed" to "chat works" in under 60 seconds? Where does this flow live?
> 10. **Two layout sketches.** One desktop, one mobile. ASCII or markdown is fine. Show one section at depth — preferably the busiest one (Agent Mode or Vault Search & Indexing) — so I can see how density and disclosure feel.
>
> ## Engage with the open questions
>
> The PRD has 10 open questions in §9. Pick a position on each and explain your reasoning briefly. Don't punt.
>
> ## What you can change
>
> - You may **rename** settings if a current name is unclear (note the rename and why).
> - You may **merge** settings if two are conceptually one (note what you merged).
> - You may **split** a setting if one knob is doing two jobs.
> - You may **reorder** anything in the inventory.
> - You may propose **new affordances** like inline help, contextual tooltips, examples — as long as they serve IA goals.
>
> ## What you cannot change
>
> - Don't propose new settings or remove existing ones (the inventory is fixed by the parallel ACP revamp).
> - Don't propose visual style choices (colors, typography, iconography). This is IA only.
> - Don't redesign the chat UI or any modal flow — only the settings surface.
>
> ## How to deliver
>
> One markdown response. Use headings, lists, and ASCII/markdown sketches where helpful. If you need to ask clarifying questions before committing to a structure, ask them first — I'd rather answer 3 good questions than receive a guess.
>
> Be opinionated. I want a designer's point of view, not a survey of options. Where you make a judgment call, name the trade-off you accepted.

---

## Appendix: Reference files

For implementers (not the designer):

- [src/settings/model.ts](../src/settings/model.ts) — `CopilotSettings` interface; source of truth for what exists today.
- [src/constants.ts](../src/constants.ts) — `DEFAULT_SETTINGS` defaults.
- [src/settings/v2/SettingsMainV2.tsx](../src/settings/v2/SettingsMainV2.tsx) — current tab container.
- [src/settings/v2/components/](../src/settings/v2/components/) — current per-tab components.
- `~/Developer/zeroliu_second_brain/notes/Copilot Feature Audit for ACP - Centric Revamp.md` — source of truth for the post-revamp world.
