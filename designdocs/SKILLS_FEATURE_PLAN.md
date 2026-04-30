# Skills Feature for Agent Mode — Implementation Plan

## Context

Copilot for Obsidian today ships a **custom commands** feature: per-user prompt templates with multiple trigger surfaces (slash flash-fill in chat, right-click context menu, Cmd-P palette, Quick Command). The system has accreted a heavy templating layer (`{}`, `{activenote}`, `{#tag}`, `{[[note]]}`, `{copilot-selection}`), a separate non-agent execution chain (`customCommandChatEngine.ts` + `CustomCommandChatModal`), and per-command model pairing that's only honored on the modal-based triggers — slash silently uses the global model.

Meanwhile, Agent Mode (branch `zero/acp-test`) wires three ACP backends — Claude Code, OpenCode, Codex — and each of those backends already speaks the **open Agent Skills standard** (agentskills.io): a SKILL.md-based, progressively-disclosed prompt format originated by Anthropic and now adopted by 40+ agents. When the plugin spawns one of these backends, the backend's own runtime auto-discovers skills from its known directories — meaning skill discovery is something the plugin can _rely on_ rather than reimplement.

This plan converts custom commands into skills. The new feature is **Agent Mode only** (legacy chains keep working unchanged until they're retired separately). It uses the open standard so files round-trip across Claude Code, OpenCode, and Codex; relies on each backend's native progressive discovery for slash-style auto-invocation; and adds Copilot-specific scoping/pairing metadata for the context-menu and palette triggers under the standard's `metadata` namespace.

User decisions already made:

- Shared skills live at **`<vault>/copilot/skills/`** (vault-relative, syncs with Obsidian Sync).
- Backend-native skills (`~/.claude/skills/` etc.) get **full CRUD** from the Copilot UI.
- Legacy custom commands stay until the user clicks **"Migrate now"** in a one-time banner.
- Slash invocation **delegates to the native backend** so progressive discovery works.

## Goal

A unified skills system in Agent Mode that (a) speaks the Agent Skills open standard, (b) reuses each backend's native discovery so skills auto-trigger and slash invocation works without inline body injection, (c) lets the user pair a skill with a specific (backend, model, effort, mode) for context-menu / Cmd-P triggers, and (d) cleanly retires the legacy templating engine.

## Skill format

One file per skill: `<dir>/<name>/SKILL.md`. Frontmatter is YAML and follows the open standard, with Copilot-specific extensions namespaced under `metadata.copilot.*`.

```yaml
---
name: summarize # required, lowercase + hyphens, == folder name
description: Bullet-point summary # required, ≤1024 chars; loaded into agent context for progressive discovery
license: MIT # optional (standard)
metadata:
  copilot:
    slash:
      enabled: true # appears in `/` autocomplete in agent chat
    contextMenu:
      enabled: true # appears in editor right-click submenu
      backend: claude-code # required when scope=shared; ignored when skill is backend-native
      modelKey: claude-sonnet-4-5
      effort: medium # optional
      mode: default # default | plan | auto
    commandPalette:
      enabled: true # registered as Obsidian command for Cmd-P
    order: 1020 # display order in menus + settings list
    lastUsedMs: 0 # for recency sort
---
Bullet-point summary of $ARGUMENTS. Each bullet captures one key point.
```

The body is plain Markdown using the standard's `$ARGUMENTS` substitution. We **do not** introduce new placeholders. Existing `{}` / `{activenote}` etc. content survives migration as-is — modern agents handle it; the plugin no longer parses or expands it.

Keep all Copilot-specific knobs under `metadata.copilot` so other agents that read the same SKILL.md ignore them gracefully and the file stays standard-compliant.

## Skill sources & directory layout

Three logical sources surfaced in the Skills tab. Each has full CRUD.

### 1. Shared (Copilot-managed, cross-backend)

- Source of truth: `<vault>/copilot/skills/<name>/SKILL.md`
- To make these discoverable to every backend, the plugin **mirrors** each shared skill into each backend's vault-scoped skill directory whenever the source changes:
  - `<vault>/.claude/skills/<name>/SKILL.md`
  - `<vault>/.opencode/skill/<name>/SKILL.md` (verify exact path during impl)
  - `<vault>/.codex/skills/<name>/SKILL.md` (verify exact path during impl)
- Mirrors carry a marker line `metadata.copilot.mirrorOf: <relative path under copilot/skills>` so the plugin can identify and clean them up safely on delete/rename. Mirrors are **regenerated**, never edited in place.
- Each mirror's frontmatter is rewritten so its `metadata.copilot.contextMenu.backend` matches the host backend (so a shared skill works as a context-menu skill paired with whichever backend the user chose for the trigger; the source file holds the canonical pairing).
- Vault-scoped mirroring keeps everything inside the user's vault, never writes to `~/`, and hands progressive discovery to each backend's normal `<cwd>/.<agent>/skills/` lookup.

### 2. Backend-native, user-scoped

Discovered (read) from each backend's home directory:

- Claude Code: `~/.claude/skills/`
- OpenCode: `~/.opencode/skill/` (verify)
- Codex: `~/.codex/skills/` (verify)

Full CRUD from Copilot's UI. These are implicitly paired with their host backend for the context-menu / palette triggers; the modelKey / effort / mode pairing fields are still authorable. Naming collisions with shared mirrors are blocked at create time per backend.

### 3. Backend-native, project-scoped

Same layout under `<vault>/.<agent>/skills/` per backend, excluding any path used as a shared-skill mirror (those are filtered by the `metadata.copilot.mirrorOf` marker).

## Settings UI

One **Skills** tab in agent settings. Replaces the current `CommandSettings` tab when agent mode is on (legacy tab stays for users with agent mode disabled). Sections in this order:

1. **Shared skills** — list with create/edit/delete/duplicate/reorder. Editor modal exposes: name, description, body, slash-enabled, context-menu-enabled, command-palette-enabled, default pairing (backend picker + model picker + effort + mode). Pairing applies to context-menu/palette only.
2. **<Backend> skills** — one collapsible section per registered backend (`AgentSettings.tsx` already iterates `listBackendDescriptors()`). Each section lists user-scoped + project-scoped skills for that backend, separated visually. Editor modal is the same as shared, minus the backend picker (host backend is implicit). Includes "Open in Obsidian" / "Reveal in Finder" actions.
3. **Migration banner** (only when legacy custom commands are present): one-time, dismissible, with "Migrate now" button and link to a confirmation modal that lists what will be moved. See migration section below.

The new tab reuses the existing draggable list, model picker (`activeModels` based, same as today's command modal), and confirmation modal patterns from `CommandSettings.tsx`. Per-backend lookup of model lists routes through the descriptor's existing model-picker plumbing (same as `useAgentModelPicker`).

## Invocation surfaces

### Slash in agent chat — `/skill-name [args]`

- New Lexical plugin: `src/agentMode/ui/plugins/AgentSlashCommandPlugin.tsx`. Modeled on the existing `SlashCommandPlugin.tsx` (legacy chat) but with two differences: (a) source is the union of slash-enabled skills visible to the _current backend_ (its native scopes + all shared mirrors), and (b) **selecting a skill does not flash-fill**. It inserts `/skill-name ` (with trailing space) at the cursor as plain text and leaves the cursor at the end so the user can append context.
- On send, the chat input ships the literal text — including the leading slash — to the backend as the prompt. Each backend's runtime intercepts `/skill-name` server-side and applies progressive disclosure (the body is loaded by the backend, not by us). No body injection from the plugin.
- Verification step required during implementation: confirm each ACP wrapper (`claude-agent-acp`, `codex-acp`, `opencode acp`) honors `/skill-name` invocation through ACP `prompt` blocks. If a wrapper passes the slash through verbatim instead of resolving, fall back to **inline body injection for that backend only** (load `SKILL.md`, substitute `$ARGUMENTS`, send body as the prompt). Document the fallback decision in the descriptor.
- For autocomplete UX: read skill name + description (~100 tokens each) on session start, cache per backend; refresh on file system changes (chokidar / Obsidian's vault events) just like the current `CustomCommandRegister` debounced watcher.

### Context-menu on selected text

- Replaces today's `registerContextMenu` flow. New file: `src/agentMode/skills/contextMenu.ts`.
- Submenu lists every skill (any source) with `metadata.copilot.contextMenu.enabled === true`, sorted by `order`.
- Click → spawn a one-shot agent session with the skill's paired `(backend, model, effort, mode)`. Session prompt = `/skill-name <selection>`. Selection is appended after the slash invocation as the argument text (each backend already substitutes `$ARGUMENTS`). The ephemeral session is rendered in the existing agent chat view (or a new dedicated modal mirror — pick during impl based on whether `AgentChat.tsx` supports ephemeral sessions cleanly).
- Replaces `CustomCommandChatModal` entirely for context-menu invocations. The legacy modal stays available only as long as the legacy commands tab is shown.

### Obsidian command palette (Cmd-P)

- Same code path as context-menu. Each skill with `metadata.copilot.commandPalette.enabled === true` registers as an Obsidian command via the existing `CustomCommandRegister`-style watcher (renamed to `SkillCommandRegister`).
- Editor callback gets selected text (or empty), then routes to the same one-shot-agent invocation as the context menu.

### Removed surfaces

- **Quick Command (Cmd-K) modal as a custom-command host** — the synthetic "Quick Command" stays as a quick-input feature but no longer reuses custom-command machinery; it just opens an empty agent prompt in the current backend.
- **`ApplyCustomCommandModal`** — gone, redundant with the Cmd-P registered list.

## What gets dropped

- `src/commands/customCommandChatEngine.ts` — the LangChain-based execution path for legacy commands. Stays alive only until the legacy tab is retired; not used by skills.
- `src/commands/customCommandUtils.ts` template engine: `processPrompt`, `processCommandPrompt`, all `{...}` regex handling, `LEGACY_SELECTED_TEXT_PLACEHOLDER` → archived (kept for migration parsing only, then removed).
- `enableCustomPromptTemplating` setting in `src/settings/model.ts:133`.
- `SlashCommandPlugin` flash-fill behavior (the file stays for the legacy chat tab; skills get a separate plugin).
- Per-command `modelKey` plumbing in legacy slash code path — replaced by the new `metadata.copilot.contextMenu.modelKey` field on the skill.

## Migration

One-time, user-initiated.

- Detection: on plugin load, check for any `*.md` under `customPromptsFolder` (default `<vault>/copilot/copilot-custom-prompts/`). If present and no `<vault>/copilot/skills/` directory yet, render a banner at the top of the Skills tab.
- Banner CTA: "Migrate now" → opens a confirmation modal listing every legacy command, the target shared-skill folder name, and a checkbox to archive the legacy folder afterward.
- Per command, the migrator:
  1. Creates `<vault>/copilot/skills/<slug(title)>/SKILL.md`.
  2. Writes standard frontmatter — `name`, `description` (first 200 chars of body or title fallback), `metadata.copilot.{slash, contextMenu, commandPalette, order, lastUsedMs}` derived from the legacy frontmatter (`copilot-command-slash-enabled`, `copilot-command-context-menu-enabled`, `copilot-command-context-menu-order`, `copilot-command-last-used`, `copilot-command-model-key`).
  3. Writes the body verbatim. No placeholder rewriting; agents handle them.
  4. For shared-skill scope, sets `metadata.copilot.contextMenu.backend` to the user's currently-active agent backend with the legacy `modelKey` value. The user can re-pair afterward.
- After successful migration, all shared mirrors are generated for every registered backend. Legacy folder is archived to `<vault>/copilot/copilot-custom-prompts.legacy-<timestamp>/` if the user opted in; otherwise left alone.
- Reuse the existing `migrateCommands()` plumbing in `src/commands/migrator.ts` as a starting point — extend with skill-format output and progress reporting.

## Files to add / modify

**New:**

- `src/agentMode/skills/types.ts` — `Skill`, `SkillSource` (`shared` | `<backend-native-user>` | `<backend-native-project>`), `SkillPairing`, `SkillMetadata`.
- `src/agentMode/skills/SkillRepository.ts` — file-system-backed CRUD with debounced watchers; mirrors shared → backend-vault dirs.
- `src/agentMode/skills/SkillManager.ts` — registry, lookup-by-backend, pairing resolution, mirror lifecycle.
- `src/agentMode/skills/contextMenu.ts` — Obsidian context-menu integration.
- `src/agentMode/skills/SkillCommandRegister.ts` — Obsidian palette command registration (replaces `customCommandRegister.ts` for skills).
- `src/agentMode/skills/migrator.ts` — legacy-command → skill migration + banner state.
- `src/agentMode/ui/plugins/AgentSlashCommandPlugin.tsx` — Lexical slash-typeahead for the agent chat input.
- `src/settings/v2/components/SkillSettings.tsx` — the Skills settings tab.
- `src/settings/v2/components/SkillEditorModal.tsx` — create/edit modal (reuses `useEnabledModels`, the model picker, and the effort/mode pickers from the existing per-backend settings).

**Modify:**

- `src/agentMode/backends/<id>/descriptor.ts` — add `skillsDirs(): { userScoped: string; projectScoped: string; mirrorRoot: string }` so the `SkillRepository` is backend-agnostic. (Keeps the `agentMode/CLAUDE.md` boundary rules: skills logic only talks to descriptors, never deep-imports into a specific backend.)
- `src/agentMode/ui/AgentChat.tsx` — wire the new `AgentSlashCommandPlugin` next to the existing keyboard plugin (model after `KeyboardPlugin.tsx` registration around AgentChat.tsx:435–460).
- `src/settings/v2/components/AgentSettings.tsx` — render `SkillSettings` inside the agent settings tab (or alongside per-backend cards).
- `src/main.ts` — register `SkillCommandRegister` and `contextMenu.ts`; deregister legacy `CustomCommandRegister`/`registerContextMenu` when agent mode is enabled.
- `src/commands/migrator.ts` — add the skill-output path branch, leave legacy migrate-from-settings path intact.
- `src/settings/model.ts` — drop `enableCustomPromptTemplating`; add `agentMode.skillsBannerDismissed: boolean`.

**Existing functions/utilities reused:**

- Frontmatter read/write helpers in `src/commands/customCommandUtils.ts:79-180` — generic enough; lift them to a shared util `src/utils/frontmatter.ts` so both skills and legacy commands use the same parser.
- Lexical `useTypeaheadPlugin` (already used by `SlashCommandPlugin.tsx`) — reused by `AgentSlashCommandPlugin` with a different option provider.
- Model-picker JSX from `src/settings/v2/components/CustomCommandSettingsModal.tsx:101-144` — extract into `<ModelPicker>` and reuse in `SkillEditorModal`.
- Drag-and-drop list logic from `CommandSettings.tsx` — copy as-is to the new tab; data shape is the same (title, order, two enabled flags).
- Backend / model / effort / mode adapters in `src/agentMode/session/modeAdapter.ts`, `src/agentMode/session/effortAdapter.ts`, and `useAgentModelPicker` — reused inside the editor modal for per-skill pairing pickers.

## Verification

End-to-end:

1. **Build & reload**: `npm run build` then `/Applications/Obsidian.app/Contents/MacOS/obsidian plugin:reload id=copilot`.
2. **Shared skill creation**: open Skills tab → create "summarize" with body + `metadata.copilot.contextMenu.backend = claude-code, modelKey = <your installed Claude model>`. Verify file appears at `<vault>/copilot/skills/summarize/SKILL.md` and three mirrors appear under `<vault>/.claude/skills/`, `<vault>/.opencode/skill/`, `<vault>/.codex/skills/`.
3. **Slash discovery (per backend)**: switch the agent backend three times (Claude Code, OpenCode, Codex). In each, type `/sum` in the chat input — the autocomplete should list "summarize" (sourced from the mirror). Select it → text becomes `/summarize `. Append "this paragraph" and send.
4. **Native progressive discovery**: confirm the backend resolved the slash and produced output that uses the skill body, not the literal `/summarize this paragraph`. If any backend echoes the slash literally, document it and switch that backend's invocation to inline-injection fallback.
5. **Context-menu**: select text in a note, right-click → Copilot → "summarize". A one-shot agent session opens with the paired Claude Code + selected model, runs `/summarize <selection>`, returns a bullet summary. Verify `lastUsedMs` updates in the SKILL.md.
6. **Cmd-P**: open palette, run "Copilot: summarize" while a note has a selection → same path as context-menu.
7. **Backend-native CRUD**: edit `~/.claude/skills/foo/SKILL.md` via the Skills tab, verify file changes on disk, then verify the change is visible in raw `claude` CLI (skill description appears in `/help` output or via `claude /foo`).
8. **Migration**: with legacy commands present, click "Migrate now" → confirm banner disappears, all entries appear under Shared, legacy folder archived (if opted in), and each migrated skill triggers via slash and context-menu.
9. **Lint & format**: `npm run format && npm run lint && npm test`.
10. **Layer boundaries**: `npm run lint` enforces `eslint-plugin-boundaries` per `src/agentMode/CLAUDE.md` — confirm `agentMode/skills/` only imports from `acp/`, `session/`, and `backends/registry.ts` (never deep-imports a specific backend).

## Open verification items (resolve during impl, not blocking the plan)

- Confirm exact skill directory layout for OpenCode and Codex (`~/.opencode/skill/` vs `skills/`, project-scoped path). Cite their docs in the descriptor PR.
- Confirm each ACP wrapper resolves `/skill-name` server-side. If not, switch that backend to inline-injection fallback and document.
- Decide: ephemeral one-shot session for context-menu trigger as a modal popover vs spinning a hidden agent chat panel. The first is closer to today's `CustomCommandChatModal` UX; the second reuses more code.
