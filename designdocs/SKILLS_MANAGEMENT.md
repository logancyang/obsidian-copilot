# Skills Management — Design Doc

## Context

Copilot for Obsidian now spawns three coding-agent backends — Claude Code
(in-process SDK), Codex (`@zed-industries/codex-acp` subprocess), and
OpenCode (subprocess) — each with its own skill / agent / command discovery
system. In parallel, Copilot has its own legacy "Custom Commands" feature
(markdown files in the vault, surfaced in Settings → Commands, the chat
slash menu, the context menu, and the Obsidian command palette).

Today the user has to learn three or four different skill systems, and
agent-side skills are invisible to Copilot — they can't be browsed,
toggled, or shared across agents. The legacy custom-command flow also
doesn't take advantage of agent capabilities (tool use, file edits) and
uses a different invocation paradigm than every CLI agent.

This proposal consolidates everything under one **Skills** tab backed by a
single canonical location: `<vault>/copilot/skills/`. Every skill Copilot
manages lives there. Per-agent visibility is a per-skill toggle that fans
out into each agent's project directory via symlinks.

We take a **cc-switch-style ownership** stance: Copilot owns the skills
domain. Existing skills the user already authored under
`<vault>/.claude/skills/`, `<vault>/.opencode/skills/`, or
`<vault>/.agents/skills/` are brought under management via a one-time,
opt-in **Import** flow that moves the file into `copilot/skills/` and
leaves a symlink at the original location so the owning agent keeps
working with zero behavior change. Users who decline import keep their
files in place; those skills are simply outside Copilot's management
(the owning agent still uses them natively).

User-level skill directories (`~/.claude/skills/`, `~/.codex/skills/`,
`~/.config/opencode/skills/`) are explicitly **out of scope for v1** —
they belong to cc-switch / the agent's own install and we defer
discovery and management of them to a future version (see Non-goals).

The legacy Custom Commands tab is replaced; existing commands migrate
into managed skills on opt-in.

The design has two audiences:

- **New users** — never created a skill, possibly don't know what one
  is. Open the Skills tab, see an empty-state card, create their first
  skill via chat. Never have to think about file locations.
- **Hardcore users** — already have skills authored under a specific
  agent's project directory from using Claude Code, Codex, and OpenCode
  against this vault. Open the Skills tab, see an Import dialog listing
  every detected skill, accept or skip per row, then land in a unified
  grid where every imported skill has three per-agent toggles.

Key references:

- `designdocs/todo/AGENT_MODE_TODOS.md` line 21 (P1 Skills; line 88 P2
  "Slash command support. Revamp current slash command to function like
  skills").
- User-scope discovery is deferred to v2 (see Non-goals).

## Per-agent landscape (paths we discover for import + symlink into for fanout)

| Backend  | Project-level paths (vault)                                                                                                                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | `.claude/skills/<name>/SKILL.md`, `.claude/agents/<name>.md`, `.claude/commands/<name>.md`                                                                                                                                                                             |
| Codex    | `.agents/skills/<name>/SKILL.md` (walks up to filesystem/git root; use `path.parse(cwd).root` as the stop sentinel — `'/'` won't terminate on Windows); `AGENTS.md`                                                                                                    |
| OpenCode | `.opencode/skills/<name>/SKILL.md`, `.opencode/agents/<name>.md`, `.opencode/commands/<name>.md`; **also** reads `.claude/skills/` and `.agents/skills/` cross-discovery, gated by `OPENCODE_DISABLE_EXTERNAL_SKILLS` / `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` env vars |

**Skill format consensus**: a directory containing `SKILL.md` with YAML
frontmatter (`name`, `description`) plus optional supporting files. All
three CLIs converge on this. Frontmatter dialect varies (Claude has the
richest); we adopt a portable subset and round-trip per-agent extras
unchanged.

## Goals

1. **One home, one grid**: every Copilot-managed skill lives at
   `<vault>/copilot/skills/<name>/`. The Settings → Skills tab shows them
   all in one card grid with no scope chrome.
2. **Per-agent toggles, default off**: every card has three per-agent
   toggles (Claude / Codex / OpenCode), all off by default for newly
   imported or discovered skills. Toggling on creates a symlink in that
   agent's project dir; toggling off removes it. Carve-out: skills
   created via `skill-creator`, imported during the explicit import
   flow, or migrated from legacy custom commands auto-enable the
   relevant agent at creation/import time as part of the user's
   explicit consent.
3. **Opt-in import for existing agent-folder skills**: the first time
   the Skills tab is opened with detected skills under
   `.claude/skills/`, `.agents/skills/`, or `.opencode/skills/`, the
   user sees an **Import** dialog with per-row Import / Skip choices.
   Imported skills land in `copilot/skills/` with a symlink left at
   their original location so the owning agent keeps working unchanged.
   Skipped skills are untouched and remain outside Copilot's management.
   The Import dialog is re-runnable at any time.
4. **New-user onboarding**: when discovery returns zero skills, the
   Skills tab renders a single onboarding card pointing at the
   conversational `skill-creator`.
5. **Replace legacy Custom Commands**: provide a per-command, opt-in
   migration path that produces managed skills. Keep the quick-command
   UX (selection → palette/context menu → modal → insert/replace)
   working under the new model.
6. **Skill creation is conversational**, not a settings UI. Ship a
   built-in `skill-creator` skill so agents can scaffold new skills in
   `<vault>/copilot/skills/`.

## Non-goals

- **User-scope skill discovery / management** — deferred to a future
  version. v1 only sees skills inside the vault. cc-switch territory
  (`~/.claude/skills/`, `~/.codex/skills/`, `~/.config/opencode/skills/`)
  is untouched.
- **In-place management of skills the user declined to import** — if
  the user clicks Skip in the Import dialog, that skill stays where it
  is and Copilot makes no claim over it. We don't show toggles, we
  don't surface it in the Skills tab. The user can re-run import to
  bring it under management later.
- A visual editor for SKILL.md.
- Cross-vault skill sync.

## On-disk layout

```
<vault>/
  copilot/
    skills/                              ← canonical home for every managed skill
      <skill-name>/
        SKILL.md                         ← per-skill state in `copilot:`
                                           frontmatter block
        ...support files
  .claude/skills/<name>                  ← symlink/junction → absolute
                                           <vault>/copilot/skills/<name>
                                           when Claude toggle is on
                                         (real dir IFF the skill was
                                          skipped during Import — outside
                                          Copilot's management)
  .agents/skills/<name>                  ← symlink/junction (Codex) — same rule
  .opencode/skills/<name>                ← symlink/junction (OpenCode) — same rule
```

Discovery operates in two modes:

- **Steady-state** (every load): walk `<vault>/copilot/skills/` only.
  This is the canonical store and the fast path. Build an in-memory
  `Skill[]`.
- **Import detection** (on demand and on first run): walk every
  per-agent project path and identify entries that are real
  directories (i.e. not symlinks pointing at `<vault>/copilot/skills/`).
  These are import candidates. Symlinks already pointing at the
  canonical store are ignored (they belong to imported skills).

### Storage — in SKILL.md frontmatter

Per-skill state lives in the skill file itself under a `copilot:` block,
keeping every skill self-contained and vault-portable.

```yaml
---
name: review-prose
description: Critique writing for clarity, voice, and rhythm.
copilot:
  enabledAgents: [claude, opencode] # which agents have a symlink today
  preferredModel: <optional model key override>
allowed-tools: [Read, Grep, WebSearch] # optional Claude-style passthrough
---
<skill body — substitution placeholders allowed>
```

`copilot.enabledAgents` is the source of truth for which agents have a
symlink in their project dir. The on-disk symlinks are derived from this
field; on startup we reconcile (create missing symlinks, remove orphans).
The `copilot:` namespace keeps Copilot-owned config separate from
per-agent passthrough fields (`allowed-tools`, `model`, `tools`, …) that
we round-trip unchanged. **Default for newly-imported or auto-discovered
managed skills is `enabledAgents: []`** — denied for every agent until
the user toggles on. Carve-outs:

- Skills imported via the Import dialog ship with the originating agent
  pre-enabled (the user's explicit Import click is the consent moment).
- Skills authored via `skill-creator` ship with the active backend
  pre-enabled.
- Skills migrated from legacy custom commands ship with the active
  backend pre-enabled.

There is no `data.json` enable map under this design — per-skill state
travels with the skill file. This is a deliberate change from the prior
two-scope draft, which needed a separate map for project-only skills.

### Windows compatibility

The canonical-home + symlink fanout is the only piece of this design that
isn't portable as written. Concrete differences vs POSIX:

- **Symlink → directory junction.** `fs.symlink()` on Windows requires
  admin privileges or Developer Mode (Settings → Privacy & security →
  For developers); a stock Obsidian process gets `EPERM`. Use
  `fs.symlink(absoluteTarget, linkPath, 'junction')` for directory
  fanout on `process.platform === 'win32'`. Junctions: directory-only
  (✓ matches our case), require **absolute** targets (so resolve before
  passing — relative `../../copilot/skills/<name>` will not work),
  same-volume only (✓ inside one vault).
- **Privilege fallback.** Wrap the first `fs.symlink` call site. On
  `EPERM` surface a one-time notice in the Skills tab ("Multi-agent
  fanout requires Developer Mode on Windows; until then enabled
  per-agent toggles will be no-ops") rather than crashing discovery.
  We do **not** silently substitute a copy-based fanout in v1 — that
  would diverge state between agents on Edit and is out of scope.
- **Atomic-replace + rename retry.** The `.<name>.replacing` pattern
  (used by Import in M2 and toggle-flip in M3) hits `EBUSY`/`EPERM`
  whenever Obsidian's vault watcher, OneDrive/Dropbox, or AV holds an
  open handle. Reuse the existing rename-with-retry helper from
  `OpencodeBinaryManager` (`src/agentMode/backends/opencode/OpencodeBinaryManager.ts:401-413`)
  rather than re-implementing.
- **Sync-folder caveat.** When the vault lives inside OneDrive / iCloud
  Drive / Dropbox on Windows, sync clients sometimes replace junctions
  with shortcuts or skip them entirely. Detect this via substring match
  on the absolute vault path and render a one-line warning in the
  Skills tab ("This vault is inside `<provider>`; managed-scope fanout
  may not survive cloud sync").

## Skill lifecycle

Every managed skill has the same set of actions. There is no scope
distinction.

| Action             | Effect                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toggle agent X on  | Create symlink/junction at `<vault>/.<X-dir>/skills/<name>` → `<vault>/copilot/skills/<name>` (absolute target). Update `copilot.enabledAgents`.        |
| Toggle agent X off | Remove that symlink. Canonical copy untouched. Update `copilot.enabledAgents`.                                                                          |
| Edit               | Open `<vault>/copilot/skills/<name>/SKILL.md` in the Obsidian editor (cleanly vault-indexed; no synthetic TFile dance needed).                          |
| Delete             | Remove the canonical directory and every symlink under each agent's project dir. Confirmation dialog required. (Vault sync / git is the rollback path.) |

Toggle ops are atomic-replace-friendly: if the target path already
exists (e.g. a leftover real dir from an aborted Import), rename it to
`.<name>.replacing`, create the link with an absolute target, then
delete the `.replacing` directory.

## Import existing skills (replaces the prior "Promote" action)

The Import flow brings a user's pre-existing agent-folder skills under
Copilot management. It is **opt-in per skill** and runs in two contexts:

1. **First-run prompt**: the first time the Skills tab is opened and
   discovery detects ≥1 importable skill (a real directory under
   `.<agent>/skills/<name>/` that is not a symlink to
   `<vault>/copilot/skills/`), we open the Import dialog automatically.
2. **Manual re-run**: a "Find existing skills" action in the Skills tab
   header re-runs discovery and reopens the dialog. Useful after the
   user authors a new skill via Claude Code's CLI (or similar) and
   wants Copilot to pick it up.

### Dialog UX

A modal listing every importable candidate, grouped by source agent,
showing for each row:

- Skill name and one-line description (parsed from frontmatter).
- Source path (`<vault>/.claude/skills/<name>/`, etc.).
- Per-row action: **Import** / **Skip**.
- Bulk action at top: **Import All**.
- Per-row resolve UI for name collisions (see below).

After the user clicks Confirm, each Imported row runs the import flow
in sequence. Skipped rows are remembered (in `data.json` under
`agentMode.skills.skippedImports: ["<source-path>", …]`) so we don't
re-prompt for them on every Skills-tab open. The user can clear that
list by re-running import via the header action.

### Import flow per skill (atomic)

1. **Move** `<vault>/.<agent>/skills/<name>/` → `<vault>/copilot/skills/<name>/`.
   - Use the rename-with-retry helper from `OpencodeBinaryManager`
     (`src/agentMode/backends/opencode/OpencodeBinaryManager.ts:401-413`)
     to absorb `EBUSY`/`EPERM` from vault-watcher / sync / AV holds.
2. **Verify** the canonical copy reads cleanly (SKILL.md frontmatter
   parses, expected files present). On failure, move back and abort
   this row.
3. **Stamp `copilot:` frontmatter**: write
   `enabledAgents: [<source-agent>]` and any `preferredModel`
   already in the file. Round-trip every other frontmatter key
   byte-for-byte.
4. **Atomic-replace** the original directory path with a symlink (POSIX)
   / directory junction (Windows) pointing at the canonical copy:
   - Create the link at the original path with an **absolute** target.
   - The original path was already moved in step 1, so this is a
     simple create — no rename dance needed.
   - On Windows without privilege, skip the symlink and surface the
     one-time EPERM notice. The skill is still imported into the
     canonical store; the originating agent will not see it until the
     user enables Developer Mode and re-toggles.
5. An interrupted run can leave the canonical copy without the symlink;
   on next Skills-tab load we reconcile by walking
   `copilot.enabledAgents` and recreating any missing links.

### Name collisions on import

If `<vault>/copilot/skills/<name>/` already exists when importing a
candidate of the same name, the dialog asks per row:

- **Rename** the imported skill (text input).
- **Replace** the existing managed copy (destructive; requires a
  second-tap confirmation).
- **Skip** this row.

We do not silently merge or overwrite.

## Filtering enabled skills per backend

Default state for every imported skill is **deny** (because
`enabledAgents` starts at `[]` for auto-discovered cards, or at the
single source agent for Import-confirmed cards).

The per-spawn deny list is rebuilt every time a backend launches a
session, computed as `discovered_skills_for_<backend> − enabled_for_<backend>`,
where:

- `discovered_skills_for_<backend>` = the union of
  - real symlinks under `<vault>/.<backend-dir>/skills/` resolving to
    `<vault>/copilot/skills/<name>/` (these are managed skills with the
    backend toggled on — already implicitly enabled), and
  - real directories under `<vault>/.<backend-dir>/skills/` that we
    skipped during Import (outside Copilot's management — we leave them
    alone).
  - For OpenCode only: also includes managed skills that show up via
    cross-discovery from `.claude/skills/` and `.agents/skills/` even
    when OpenCode's own toggle is off. These are the cases where
    spawn-time deny earns its keep.

- `enabled_for_<backend>` = managed skills whose
  `copilot.enabledAgents` includes `<backend>`.

**Claude Code (SDK)**: emit `permissions.deny: ["Skill(<name>)", …]`
for every name in `discovered − enabled`. Verify the rule grammar at
implementation time: research surfaced both `skillOverrides` and `Skill`
permission rules. If `Skill(name)` deny doesn't take effect at runtime,
fallback is `skillOverrides: { <name>: "off" }` per disabled name.

**OpenCode**: extend `OPENCODE_CONFIG_CONTENT` (already injected at
spawn by `OpencodeBackend.buildSpawnDescriptor`,
`src/agentMode/backends/opencode/OpencodeBackend.ts:82-86`) with:

```js
permission: {
  skill: { "<name>": "deny" /* per disabled skill, including cross-discovered ones */ }
}
```

Cross-discovery (`.claude/skills/`, `.agents/skills/`) stays **on**
intentionally: managed skills with Claude or Codex toggles on but
OpenCode toggle off get denied per-name; this is more precise than a
blanket cross-discovery shut-off that would also affect skills the
user _did_ enable.

**Codex**: in v1 Codex has no per-skill deny. Under the new model this
is largely a non-issue:

- Managed skills with Codex toggle off → no symlink at
  `.agents/skills/<name>/` → Codex cannot see them. ✓
- Skipped skills the user left under `.agents/skills/` → Codex sees
  them natively, but they are explicitly outside Copilot's management
  and we make no claim about hiding them. The user manages those via
  Codex's own configuration.

The previous design's "always visible to Codex regardless of toggle"
warning is no longer needed for managed skills. (Skipped skills under
`.agents/skills/` are an outside-Copilot concern, not a limitation we
need to surface.)

### Reconciliation on startup

On Skills-tab load (and on relevant vault-watch events):

1. Read every `copilot/skills/<name>/SKILL.md` to build the in-memory
   `Skill[]`.
2. For each skill, for each agent in `copilot.enabledAgents`, ensure
   the corresponding symlink exists at `.<agent-dir>/skills/<name>/`.
   If missing, create it. If present and pointing elsewhere, repair.
3. For each agent path, find symlinks pointing at `copilot/skills/`
   that no longer correspond to a managed skill (orphans) and remove
   them. (Removal only — never delete real directories during
   reconciliation.)

This makes `copilot.enabledAgents` the source of truth and the
filesystem a derived view that we keep aligned.

## Quick commands

**A skill is unified — it doesn't declare an execution mode.** The
_invocation surface_ picks the runtime profile:

| Surface                              | Tool profile          | Result rendering                                      |
| ------------------------------------ | --------------------- | ----------------------------------------------------- |
| Chat `/skill-name`                   | Active session's mode | Streamed into the chat trail (existing agent UI)      |
| Palette / right-click on a selection | **Read-only profile** | Modal — see _Edit-preview rendering_ below (deferred) |

In every surface, the slash menu / palette / context menu show only the
skills currently **enabled** for the active backend.

### Read-only tool profile

For each backend, configure the spawn so write/exec tools are denied
while read tools (Read, Grep, Glob, optionally WebSearch/WebFetch) stay
on:

- **Claude (SDK)**: pass `allowedTools` plus a `PreToolUse` hook (the
  SDK adapter in `src/agentMode/sdk/` already accepts hooks) that denies
  `Write`, `Edit`, `Bash`, `MultiEdit`, etc. silently — the model never
  sees a permission error, the tool simply isn't available.
- **Codex**: it already has `read-only` ACP mode (mapped to `plan`
  today in `src/agentMode/backends/codex/descriptor.ts:127`); reuse for
  quick-command spawns.
- **OpenCode**: extend `OPENCODE_CONFIG_CONTENT` with `permission.tool`
  / `permission.write` denials.

### Edit-preview rendering — cross-cuts with chat agent mode (deferred)

How a quick-command modal shows the user "here's what would change,
accept or reject" is the **same problem** chat agent mode has when an
agent calls `Edit` / `Write` and we want to preview the diff before it
lands on disk. There is already a standing P1 for this in
`designdocs/todo/AGENT_MODE_TODOS.md:27-28`. We will not solve this in
two places:

- The mechanism that captures, previews, and accept/rejects an agent's
  proposed edit must work for both the chat-mode agent edit and the
  quick-command surface.
- Until that mechanism is designed, the quick-command surface ships
  with a _minimal_ result modal (existing `CustomCommandChatModal` with
  insert / replace / copy) and treats the agent's response as plain
  markdown.
- When the chat agent edit-preview lands, the quick-command surface
  inherits it for free.

### Trade-off accepted

Today's path goes straight to the user's plain LLM provider (no agent),
which works even when Agent Mode is disabled. Under this proposal,
quick commands depend on having an agent backend installed.
**Mitigation**: keep a fallback "plain LLM, no tools" path for users
without any agent backend, reusing the existing
`useStreamingChatSession` hook (`src/hooks/use-streaming-chat-session.ts`).

### Substitution

For the chat slash-command surface, SKILL.md placeholders (`$ARGUMENTS`,
`$1`) are resolved by the agent's native skill resolver — we don't
expand them plugin-side. For the quick-command surface, the user's
selection is passed to the agent alongside the skill invocation; the
exact wire format is settled with the edit-preview design.

## Migration: Custom Commands → Skills (per-command opt-in)

The Skills tab shows a dedicated **Legacy commands** section at the top
listing every existing `CustomCommand`. Each row has a "Migrate to skill"
action; nothing is moved automatically. Migration produces a managed skill
with the active agent pre-enabled.

For each command the user opts in:

1. Parse current frontmatter → derive `name` (slugified `title`).
2. Generate a one-line `description` via a single LLM call. The user
   sees the proposed description in a confirmation dialog and can edit
   before accepting.
3. Wrap content into `SKILL.md`:
   ```yaml
   ---
   name: <slug>
   description: <user-confirmed one-liner>
   copilot:
     enabledAgents: [<active backend at migration time>]
     preferredModel: <command.modelKey || empty>
   ---
   <command.content>
   ```
   Today's `showInSlashMenu` / `showInContextMenu` flags are dropped:
   every migrated skill is invocable from chat, palette, and context
   menu by default.
4. Write to `<vault>/copilot/skills/<slug>/SKILL.md` and create a
   symlink under the active backend's project dir.
5. Delete the original legacy markdown file once the new SKILL.md is
   written and verified (vault sync / git is the rollback path).
6. Re-register palette + context-menu entries from the new skills set.

The legacy command stays functional until migrated — both systems coexist
during the migration window. The Legacy section is hidden once empty.

## UX design brief (for Claude design)

> Paste the body of this section into the Claude design tool. It is
> intentionally self-contained — Claude design has no access to the rest
> of this doc, our codebase, or Obsidian itself, so all the context it
> needs to reason about the screens lives below. **Visual fidelity,
> layout, iconography, and interaction polish are entirely the design
> tool's call** — this brief only supplies product context, vocabulary,
> jobs-to-be-done, and the user flows that must be expressible in the
> final design.

### Role and deliverable

You are a UX designer. Design the settings surface for a feature called
**Skills** in a desktop note-taking app plugin. Cover the screens and
states listed at the end of this brief. Choose the visual language that
fits — fidelity, density, color, and component style are up to you.
Don't generate code; deliver a design.

**Design for both ends of the spectrum.** The same surface has to land
gracefully for someone who has never heard the word "skill" before
(needs teaching and a single obvious next step) _and_ for a power user
who arrives with skills already authored across multiple agent CLIs
(needs a fast path to bring those under the plugin's management).
The design should not feel built for only one of them.

### Product context (assume zero prior knowledge)

- **Obsidian** is a Markdown note-taking app for desktop. It has a
  Plugin Settings dialog that opens as a modal over the app. That
  dialog uses a **top-tab layout** for major settings areas. The
  feature you're designing lives inside that dialog as one of those
  tabs.
- **Copilot for Obsidian** is a plugin that adds an AI assistant to
  Obsidian. The assistant can run on top of one or more **agent
  backends** the user has installed locally — three of them, all
  terminal-based AI coding agents: **Claude Code**, **Codex**, and
  **OpenCode**.
- Today the assistant's settings dialog already has tabs for areas
  like Basic, Model, Agent, QA, Commands, Plus, Advanced. We are
  **replacing the existing "Commands" tab with a new "Skills" tab**.

### Who the user is — two personas, one surface

This tab serves two audiences. Don't pick one; design so the same
layout teaches the first while staying out of the way of the second.

1. **Newcomer.** Has Copilot installed and uses the assistant in chat,
   but has never authored or managed a skill, may not have any agent
   backend installed beyond the default, and doesn't know what
   "agent" or "skill" mean. Needs the tab to teach what a skill is
   and why they'd want one, make the path to creating one obvious,
   and not punish them with jargon when they have nothing to manage.
   Their home base is the **Empty state** and the **First-run** screen.

2. **Power user.** Already runs Claude Code / Codex / OpenCode against
   this vault, has skills authored under one or more of the agents'
   project folders, and wants a single place to govern what each agent
   can see in this vault. Their home base is the **Steady state**
   _after_ the **Import dialog** has run.

When in doubt about where to put weight, lean **newcomer** in copy and
empty states (plain language, define jargon inline) and lean **power
user** in density and information access.

### Vocabulary the design needs to introduce visually

- **Skill** — a reusable, named instruction set: a name, a one-line
  description, a markdown body, and optional support files. Invoked
  by name from chat (`/skill-name`), from a right-click on selected
  text in a note, or from Obsidian's command palette.

- **Agent backend** — Claude Code, Codex, OpenCode. Three independent
  CLI tools, each with its own folder inside the vault where it looks
  for skill files.

- **Managed skill (the only kind shown on this tab)** — a skill the
  plugin manages. It lives in the plugin's own folder
  (`<vault>/copilot/skills/<name>/`). Visible to any combination of
  the three agents, controlled by per-card toggles.

- **Importable skill (shown only inside the Import dialog)** — a
  skill the plugin detected in one of the agent CLIs' folders that is
  _not yet_ managed. The user accepts or skips per row. Accepted
  rows become managed skills (the file is moved into the plugin's
  folder; a symlink is left in the agent's folder so the agent keeps
  working without behavior change). Skipped rows are left exactly
  as they are; the plugin makes no further claim over them.

- **Default-deny with opt-in enable.** Every newly imported or
  detected managed skill starts **disabled** for every agent. The
  per-agent toggles let the user opt _in_. Toggling on adds a symlink
  in that agent's folder; toggling off removes it. The canonical file
  is never touched. Carve-outs: the originating agent of an imported
  skill auto-enables on import; skills created via the conversational
  `skill-creator` auto-enable on the active agent; legacy custom
  commands migrated to skills auto-enable on the active agent at
  migration time.

- **Invocation surfaces** — every enabled skill is reachable from
  three places at once: chat slash menu (`/skill-name`), right-click
  on selected text inside a note, and Obsidian's command palette.
  There is no per-surface toggle; if a skill is enabled for the
  active agent, it's in all three.

- **Skill creation is conversational, not a form.** The user creates
  a new skill by talking to the assistant in chat — a built-in
  `skill-creator` skill scaffolds the files. The Skills tab does not
  contain a "create skill" form.

### Jobs-to-be-done on this tab

1. "Bring my existing agent-folder skills under the plugin's
   management" (Import dialog flow).
2. "Which skills can my agents currently see?" (steady-state grid).
3. "Stop one of my agents from seeing a specific skill" (toggle off,
   no destructive confirmation).
4. "Let multiple agents share this skill" (flip more toggles on).
5. "Edit / delete a skill the plugin owns."
6. "Move my old custom commands into this new system, one at a time."
7. "Take me to where I create a new skill."

### Information architecture for the Skills tab body

Top to bottom. Some sections are conditional.

1. **Top-right actions** — two affordances:
   - **"New skill"** — opens chat with `skill-creator` pre-staged.
   - **"Find existing skills"** — re-opens the Import dialog. Subdued
     when nothing is detectable.

2. **Legacy commands section** (conditional) — present only while
   un-migrated legacy custom commands exist. Each row shows the
   legacy command's name, an auto-generated one-line description, and
   a "Migrate to skill" action. Migrated rows leave; the section
   disappears entirely when empty.

3. **Skills list** — the main content. **One unified list** of every
   managed skill. No scope badges. Every card has the same shape:
   name, description, three agent toggles, an action menu.

### What each skill entry must communicate

- The skill's **name** and a one-line **description**.

- **Agent visibility toggles** — three (Claude / Codex / OpenCode), all
  starting **off** for newly-imported / auto-discovered skills.
  Toggling on creates a symlink in that agent's folder; toggling off
  removes it. The canonical file is never touched.

- A **per-card action menu**:
  - **Edit** — opens the underlying SKILL.md in Obsidian's main
    editor; the Skills tab itself does not contain an editor.
  - **Delete** — destructive; confirmation step required. Removes the
    canonical directory and every symlink.

The fact that every enabled skill is reachable via chat slash, context
menu, and command palette is global, not per-skill — it likely belongs
in the tab header or a single explainer rather than on every entry.

### User flows the design must support end-to-end

- **First-run import.** The user opens the tab for the first time
  with skills already authored under `.<agent>/skills/` folders. A
  modal appears listing every detected skill, grouped by source
  agent. Each row has Import / Skip; the modal also has Import All.
  Confirming runs the imports and dismisses the modal. The Skills
  tab then shows the imported skills as managed cards, with the
  source agent's toggle pre-enabled and the others off. **Never
  silently moves files** — every import is an explicit user click.

- **First-time discovery, no existing agent skills.** The user opens
  the tab and the import dialog is empty (or never appears, depending
  on the design choice). The list shows whatever managed skills
  exist (likely none). The empty state takes over (see Screen D).

- **Let an agent see a skill.** The user finds the skill, flips the
  relevant per-agent toggle on. Happens immediately, no destructive
  confirmation, because nothing irreversible is happening — just a
  symlink in or out.

- **Edit a skill.** The user clicks edit; the skill's markdown file
  opens in Obsidian's main editor pane.

- **Delete a skill.** Confirmation step required, because this
  removes the canonical copy and every symlink.

- **Re-run import.** The user adds a new skill via Claude Code's CLI
  (or skipped one originally and changed their mind), then clicks
  "Find existing skills" in the Skills tab header. The import dialog
  re-opens with new candidates listed.

- **Migrate a legacy command to a skill.** The user expands the
  legacy section, reviews the auto-generated description, edits if
  desired, then confirms. That row disappears from legacy and appears
  in the main list with the active agent pre-enabled.

- **Resolve a name collision during import.** If an imported skill's
  name matches an existing managed skill, the row exposes Rename /
  Replace / Skip choices inline before Confirm. Never silently merge
  or overwrite.

- **Create a new skill.** The tab makes it obvious that creation
  happens in chat by invoking `skill-creator`. Explicitly _not_ a
  form on this tab.

### Specific screens / states the design must include

- **Screen A — Steady-state grid (power-user home base, after import).**
  The everyday view. Unified list of managed skills, each with three
  agent toggles in a realistic mix (some on, some off). Top-right
  actions ("New skill", "Find existing skills") visible. Legacy
  section absent.

- **Screen B — Import dialog (first run with detected agent skills).**
  Modal listing every importable candidate, grouped by source agent
  (Claude / Codex / OpenCode), with Import / Skip per row plus an
  Import All bulk action. Show a few candidates with the name
  collision UI inline (Rename / Replace / Skip).

- **Screen C — First-run (newcomer-leaning, no detected agent skills).**
  No import dialog. The list is empty (or shows just one or two
  managed skills if they exist). The "New skill" affordance is
  prominent. Onboarding copy explains what a skill is.

- **Screen D — Empty state (newcomer's first impression).** Nothing
  detected anywhere — no managed skills, no agent-folder skills, no
  legacy commands. The whole tab body becomes a single onboarding
  moment for someone who doesn't yet know what a skill is:
  - Plain-language explainer (one or two short paragraphs, no
    jargon — define "skill" inline).
  - One or two concrete example use-cases.
  - A single CTA that opens chat and pre-stages `skill-creator`.

- **Screen E — Legacy commands migration.** Show the legacy section
  expanded near the top with several rows. Convey what the per-row
  "review and confirm migration" step looks like (the editable
  description). Convey what the section looks like mid-migration as
  it empties out.

### Interaction notes that should shape the layout

- Per-agent toggles must feel **cheap and reversible** — they only
  symlink in or out. No destructive confirmation.
- Edit always leaves the Skills tab; the tab is not a file editor.
- Delete is destructive; confirmation step required.
- The Import dialog is the only place file moves happen, and every
  import is an explicit user click. Never quietly relocate files
  outside this flow.

### Out of scope — please don't invent these

- No vault-wide "managed mode" toggle, no opt-in gate, no settings
  switch for the whole tab. The tab itself is the gate.
- No skill-creation form on the Skills tab. Creation lives in chat.
- No in-place skill editor. Editing opens the file in Obsidian's
  editor.
- No diff / accept-reject preview UI for skill output. That's a
  separate, deferred surface this tab does not own.
- No per-skill toggles for individual invocation surfaces.
- No surface for skipped agent-folder skills. They are explicitly
  outside the plugin's management; if the user wants them back,
  they re-run the Import dialog.
- No backup folder / restore-from-backup flow — vault sync (git or
  Obsidian Sync) is the rollback path.

## Critical files (for implementation phase)

- `src/agentMode/backends/{claude,codex,opencode}/descriptor.ts` — read
  to understand spawn descriptor surface; OpenCode already injects
  `OPENCODE_CONFIG_CONTENT` (we extend it to add per-name deny entries).
- `src/agentMode/backends/registry.ts` — add per-backend skill path map.
- `src/commands/{type,state,customCommandRegister,contextMenu,CustomCommandChatModal,customCommandUtils}.ts`
  — migration source + modal reuse for the "Ask" / "Edit" quick-command
  surfaces.
- `src/components/chat-components/plugins/SlashCommandPlugin.tsx` —
  rewire to skills.
- `src/settings/v2/components/CommandSettings.tsx` — replace with
  `SkillsSettings.tsx`.
- `src/settings/model.ts` — extend `agentMode.skills` schema with
  `skippedImports: string[]` (paths the user declined to import).
- New: `src/skills/SkillManager.ts` — canonical-store discovery,
  per-skill state, symlink lifecycle, import flow, reconciliation.
- New: `src/skills/skillFormat.ts` — SKILL.md parse/serialize,
  frontmatter contract.
- New: `src/agentMode/sdk/skillDenyList.ts` and equivalents per
  backend — emits the per-name deny snippet computed as
  `discovered − enabled` from the canonical store.

## Decisions captured

- **One canonical home, no scopes**: every Copilot-managed skill lives
  at `<vault>/copilot/skills/<name>/`. There is no project-only scope,
  no scope badges, and no Promote action. The `agentMode.skills.enabled`
  map from the prior draft is dropped (per-skill state lives in
  SKILL.md frontmatter only).
- **Opt-in Import flow replaces Promote**: the user's existing
  agent-folder skills are brought under management via an explicit
  Import dialog, runnable on first open and re-runnable from the tab
  header. Skipped skills are left untouched and are outside Copilot's
  management.
- **cc-switch-style ownership**: when the user accepts an Import row,
  the skill file is moved into `copilot/skills/` and a symlink is
  left at the original agent path so the owning agent keeps working
  with zero behavior change. The "no move" promise is unverifiable
  from the user's perspective (every operation goes through the
  symlink and gets the same bytes), and the complexity of preserving
  it doesn't earn its keep.
- **Default-deny + opt-in enable**: every newly-imported or
  auto-discovered managed skill starts disabled for every agent.
  Carve-outs: imported skills auto-enable the originating agent;
  skill-creator and legacy migrations auto-enable the active agent.
- **Codex limitation evaporates for managed skills**: under symlink
  fanout, toggling Codex off removes the symlink → Codex no longer
  sees the skill. The previous "always visible regardless of toggle"
  warning is no longer needed.
- **OpenCode cross-discovery stays on**: per-name deny in OpenCode's
  permission config is precise enough; no blanket
  `OPENCODE_DISABLE_EXTERNAL_SKILLS` shut-off.
- **Storage**: per-skill state in SKILL.md `copilot:` frontmatter
  (single source of truth). `data.json` carries only
  `agentMode.skills.skippedImports: string[]` so we don't re-prompt
  for skipped skills on every load.
- **Migration**: per-command opt-in; migrated skills land directly in
  `copilot/skills/` with the active agent pre-enabled.
- **Quick-command runtime**: unified across surfaces. Quick-command
  surface spawns the active agent with a read-only tool profile;
  v1 ships the existing insert/replace modal unchanged. Edit-preview
  is deferred and shared with chat agent mode's edit-preview design.
  Plain-LLM fallback when no agent backend is installed.

## Milestones

Each milestone is independently shippable and verifiable. Checkpoints
are concrete pass/fail steps the user can run by hand.

### M1 — Canonical-store discovery + read-only grid + new-user onboarding

**Goal**: every skill in `<vault>/copilot/skills/` shows up in the
Skills tab. New users see a clean onboarding card. Nothing is mutated.

**Scope**:

- `src/skills/SkillManager.ts` discovery walks
  `<vault>/copilot/skills/` only (steady-state path).
- `src/skills/skillFormat.ts` parse/serialize SKILL.md with full
  frontmatter round-trip (preserve unknown per-agent keys
  byte-for-byte).
- `SkillsSettings.tsx`: card grid. Toggles rendered but disabled / no
  actions wired in this milestone.
- Empty-state onboarding card when discovery returns zero skills.
- Legacy `CommandSettings.tsx` left in place.

**Checkpoints**:

1. Fresh vault, no managed skills → Skills tab shows the onboarding
   card only.
2. Hand-create `<vault>/copilot/skills/managedfoo/SKILL.md` → reload →
   card "managedfoo" appears.
3. SKILL.md with extra unknown frontmatter (e.g. `allowed-tools`,
   `tools`, `model`) → unit test confirms round-trip is byte-equal.

### M2 — Import existing skills (first-run + re-runnable dialog)

**Goal**: existing skills under `.claude/skills/`, `.agents/skills/`,
`.opencode/skills/` can be imported into the canonical store via an
explicit dialog. Skipped skills are remembered.

**Scope**:

- Import-detection walker scans every per-agent project path; emits
  candidates that are real directories (not symlinks pointing at
  `<vault>/copilot/skills/`) and not in
  `agentMode.skills.skippedImports`.
- Import dialog UI: per-row Import / Skip, Import All bulk action,
  inline name-collision Rename / Replace / Skip.
- First-run trigger: dialog auto-opens on Skills-tab first load with
  ≥1 candidate. Re-run trigger: "Find existing skills" header action.
- Import flow per row:
  - Move source dir → `copilot/skills/<name>/` via rename-with-retry.
  - Verify SKILL.md parses; on failure, move back and surface error.
  - Stamp `copilot.enabledAgents: [<source-agent>]`,
    `copilot.preferredModel` if previously known.
  - Create symlink/junction at the original agent path → canonical
    (absolute target). On Windows EPERM, surface the one-time notice
    and proceed without the link.
- Skipped paths added to `agentMode.skills.skippedImports`.

**Checkpoints**:

1. Fresh vault with `.claude/skills/projfoo/SKILL.md` (real dir) →
   open Skills tab → import dialog appears with `projfoo` listed
   under Claude.
2. Click Import on `projfoo` → confirm:
   - `<vault>/copilot/skills/projfoo/` exists with original contents.
   - `<vault>/.claude/skills/projfoo` is now a symlink to the canonical.
   - `projfoo` SKILL.md has `copilot.enabledAgents: [claude]`.
   - Card appears in main grid with Claude toggle on.
3. Click Skip on a different candidate → dialog closes; that path
   appears in `data.json` `skippedImports`; reopening Skills tab does
   not re-prompt for it.
4. Click "Find existing skills" header action → import dialog
   re-opens with skipped + any new candidates.
5. Name collision: managed `foo` exists, candidate `foo` discovered →
   row exposes Rename / Replace / Skip; choosing Rename prompts for
   new slug; nothing on disk mutates until Confirm.

### M3 — Per-agent toggles for managed skills (symlinks)

**Goal**: managed skills can be made visible to any subset of agents
via per-agent toggles that maintain symlinks under the matching project
paths. Edit and Delete actions wired up.

**Scope**:

- Toggle on for an agent → create a symlink (POSIX) / directory
  junction (Windows) at `<vault>/.<agent>/skills/<name>` →
  absolute path of `<vault>/copilot/skills/<name>`. Atomic-replace if
  the path already exists. Update `copilot.enabledAgents`.
- Toggle off → remove the link. Canonical copy untouched. Update
  `copilot.enabledAgents`.
- On Windows without privilege to create symlinks/junctions: surface
  the one-time notice; toggle state still reflects in the SKILL.md
  but the on-disk fanout is a no-op until Developer Mode is enabled.
- Edit action opens `<vault>/copilot/skills/<name>/SKILL.md` in the
  Obsidian editor.
- Delete action removes the canonical dir + every symlink (confirm
  dialog).
- Reconciliation pass on Skills-tab load: walk
  `copilot.enabledAgents` for every managed skill, ensure each
  enabled agent has the symlink in place; remove orphan symlinks
  pointing at the canonical store but not corresponding to any
  managed skill.

**Checkpoints**:

1. Managed card "managedfoo" with all three toggles off → no symlinks
   exist under any agent's project dir.
2. Toggle Claude on → `<vault>/.claude/skills/managedfoo` is a
   symlink to `<vault>/copilot/skills/managedfoo`;
   `copilot.enabledAgents` includes `claude`.
3. Toggle Claude off → symlink removed; canonical copy intact;
   `copilot.enabledAgents` no longer includes `claude`.
4. Toggle all three on → three symlinks (Claude / Codex / OpenCode).
5. Edit the canonical SKILL.md body → invoke `/managedfoo` from any
   enabled agent's session → updated body runs.
6. Delete the skill → all symlinks gone, canonical dir gone.
7. Manually rm a symlink that should exist per `copilot.enabledAgents`
   → reload Skills tab → reconciliation recreates it.

### M4 — Spawn-time deny for OpenCode cross-discovery

**Goal**: managed skills with OpenCode toggle off but Claude or Codex
toggle on are denied per-name in OpenCode's permission config, so
OpenCode's cross-discovery doesn't accidentally expose them.

**Scope**:

- Per-spawn deny list computed as `cross_discovered − enabled_for_opencode`.
- Extend `OPENCODE_CONFIG_CONTENT` with `permission.skill: { "<name>":
"deny" }` per affected name.
- Claude (SDK) deny rules also wired in this milestone for symmetry,
  even though under managed-only the Claude deny set is usually empty
  (no cross-discovery to worry about). Useful for skipped skills that
  happen to live in `.claude/skills/` and that the user toggles off
  via some future surface — and as defense in depth.

**Checkpoints**:

1. Managed skill `foo` with `copilot.enabledAgents: [claude]` →
   Claude session sees `foo`; OpenCode session has `foo` denied via
   `permission.skill: { foo: "deny" }` in injected config (verify by
   inspecting OpenCode spawn).
2. Toggle OpenCode on for `foo` → next OpenCode spawn no longer
   denies it; `foo` runs normally.
3. Inspect Claude SDK spawn permissions on a fresh vault → deny list
   is empty by default (sanity check).

### M5 — Slash command in chat resolves to agent skill

**Goal**: `/skill-name [args]` in the chat input runs the skill via
the active agent's native discovery. Plain-LLM fallback covers users
without any agent backend.

**Scope**:

- Rewire `SlashCommandPlugin.tsx`: replace today's "paste content"
  handler with a send that delegates to the active agent session.
  Slash menu lists managed skills currently enabled for the active
  agent (i.e., have the active agent in `copilot.enabledAgents`).
- Plain-LLM fallback: when no agent backend is configured, route
  through `useStreamingChatSession` with the skill body as the prompt
  and `args` appended.

**Checkpoints**:

1. With Claude backend live and a managed skill `summarize` (Claude
   toggle on), type `/summarize text` in chat → agent loads SKILL.md
   (via the symlink) and runs it.
2. Disable `summarize` on Claude → slash menu no longer lists it for
   the active Claude session; typing `/summarize` produces "skill not
   available" feedback.
3. With Agent Mode disabled and no backend → `/summarize text` works
   via plain-LLM fallback (verify network call goes to user's
   configured LLM provider).
4. Skill with `$ARGUMENTS` placeholder → agent expands it natively;
   fallback path performs naive string substitution.

### M6 — Quick-command surface (palette + right-click) under read-only profile

**Goal**: every enabled managed skill is invocable from the command
palette and the right-click context menu against the user's current
selection. Result opens the existing `CustomCommandChatModal`. The
agent runs with write/exec tools denied.

**Scope**:

- Re-register palette + context-menu entries from `SkillManager`,
  filtered to skills enabled for the active agent.
- Read-only spawn profile per backend (see "Read-only tool profile").
- Modal reuse from `CustomCommandChatModal` (insert / replace / copy).

**Checkpoints**:

1. Select text → right-click → "Skills →" submenu lists every enabled
   managed skill → run one → modal opens with the result.
2. Same flow via cmd-P with no selection → modal gets the empty-input
   variant.
3. Run a skill that asks the agent to edit a file → log shows
   `Edit`/`Write` tool calls denied by the spawn profile (no file
   mutation); agent still streams a final text result into the modal.
4. Disable a skill on the active agent → it disappears from palette
   and right-click immediately (no restart).

### M7 — Legacy Custom Commands → managed skills migration

**Goal**: every existing `CustomCommand` can be migrated into a
managed skill. Old + new coexist during the migration window.

**Scope**:

- "Legacy commands" section atop the Skills tab.
- Per-command "Migrate to skill" action: derive slug, propose
  one-sentence description via single LLM call, show editable
  confirmation dialog.
- Write `<vault>/copilot/skills/<slug>/SKILL.md` with `copilot:`
  frontmatter (`enabledAgents` = active backend at migration time;
  symlink created accordingly).
- Delete the original legacy markdown file once the new SKILL.md is
  written and verified.
- Re-register palette + context-menu entries from the new set.

**Checkpoints**:

1. Vault has 3 legacy commands → Legacy section shows 3 rows.
2. Click "Migrate" → confirmation dialog with proposed description +
   slug, both editable.
3. Confirm → managed skill exists; original legacy `.md` is gone;
   symlink to active agent's project dir is created; new card appears.
4. Migrated skill is invocable via chat slash, palette, and context
   menu without restart.
5. Legacy section auto-hides once empty.
6. Un-migrated commands still run via the legacy path during the
   migration window.

### M8 — `skill-creator` built-in + new-user onboarding wiring

**Goal**: users can create skills conversationally; new users see a
guided empty-state.

**Scope**:

- Bundle a `skill-creator` skill in plugin assets; copy into
  `<vault>/copilot/skills/skill-creator/` on first run if missing.
  The bundled skill-creator scaffolds new skills with
  `copilot.enabledAgents: [<active backend>]`.
- "New skill via chat" CTA in the Skills tab top-right opens chat with
  `/skill-creator` pre-staged.
- Empty-state card from M1 also points at this CTA.

**Checkpoints**:

1. Fresh vault → Skills tab shows onboarding card → click "Create your
   first skill" → chat opens with `/skill-creator` ready to send.
2. Walk through the conversation → `<vault>/copilot/skills/<new-name>/`
   is created with a valid SKILL.md whose `copilot.enabledAgents`
   contains the active backend; the matching project symlink exists.
3. New skill appears as a card without reload; onboarding card
   disappears. The active-backend toggle is on; others off.
4. New skill is invocable via chat slash, palette, and context menu
   immediately.
