# Skills Management — Design Doc

## Context

Copilot for Obsidian now spawns three coding-agent backends — Claude
Code (in-process SDK), Codex (`@zed-industries/codex-acp` subprocess),
and OpenCode (subprocess) — each with its own skill discovery system
under a different directory in the vault. In parallel, Copilot has its
own legacy "Custom Commands" feature.

Today the user has to learn three or four different skill systems, and
agent-side skills are invisible to Copilot — they can't be browsed or
toggled per agent. This proposal adds a new **Skills** tab in Settings
that becomes the central place to organize every skill the user wants
Copilot to manage.

The design is intentionally small:

- The Skills tab is empty until the user does something with it.
- If we detect existing skills under `.claude/skills/`,
  `.agents/skills/`, or `.opencode/skills/`, we show one friendly
  consent card. One click moves all of them into a canonical store
  and leaves symlinks behind so the owning agents keep working.
- If we don't detect anything, the tab is just on — no opt-in screen.
- Managed skills get inline per-agent toggles (Claude / Codex /
  OpenCode). Toggling on creates a symlink in that agent's folder;
  toggling off removes it. The canonical file is never touched.
- The legacy **Custom Commands** tab stays exactly as it is. The two
  systems coexist. After the user hits Enter, `/skill-name` and
  `/command-name` look identical in the chat.
- User-scope skills (`~/.claude/skills/`, `~/.codex/skills/`,
  `~/.config/opencode/skills/`) are explicitly ignored. The owning
  CLI keeps using them; Copilot pretends they don't exist.

The on-disk skill format follows the **Agent Skills specification**
(<https://agentskills.io/specification>) for the shared fields
(`name`, `description`, `license`, `compatibility`, `metadata`,
`allowed-tools`). Three Claude Code-only flags
(`disable-model-invocation`, `model`, `user-invocable`) are written
as top-level frontmatter keys in Claude Code's native style so
Claude's loader picks them up directly. The single Copilot-only
field — which agents have a symlink — lives inside the spec's
`metadata` escape hatch as `metadata.copilot-enabled-agents`.

## Per-agent landscape

| Backend  | Project-level skill paths in the vault                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | `.claude/skills/<name>/SKILL.md`                                                                                                                                                                         |
| Codex    | `.agents/skills/<name>/SKILL.md` (walks up to filesystem/git root; use `path.parse(cwd).root` as the stop sentinel — `'/'` won't terminate on Windows)                                                   |
| OpenCode | `.opencode/skills/<name>/SKILL.md`; **also** reads `.claude/skills/` and `.agents/skills/` cross-discovery, gated by `OPENCODE_DISABLE_EXTERNAL_SKILLS` / `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` env vars |

All three CLIs converge on the same on-disk format: a directory
containing `SKILL.md` with YAML frontmatter plus optional supporting
files. We adopt the Agent Skills spec verbatim.

## Goals

1. **One home for managed skills.** Every Copilot-managed skill lives
   at `<vault>/copilot/skills/<name>/`. The Skills tab shows them in
   one list with no scope chrome.
2. **Per-agent toggles via symlinks.** The list row shows three
   agent-icon toggles. Toggling on creates a symlink in that agent's
   project dir; toggling off removes it. The canonical file is never
   touched.
3. **Opt-in bulk import — only when there's something to import.** If
   we find pre-existing agent-folder skills, we show a friendly
   consent card. One click brings them all under management. If we
   find nothing, the tab is just on.
4. **Storage that plays well with every loader.** Shared fields
   follow the Agent Skills spec verbatim. Claude-only flags
   (`disable-model-invocation`, `model`, `user-invocable`) are
   written at top level in Claude's native style so Claude's loader
   honors them without translation. The single Copilot-only field
   lives under `metadata.copilot-enabled-agents`.
5. **Coexist with the Custom Commands tab.** The legacy tab stays
   unchanged. Both surfaces appear in the slash menu; on name
   collision the skill wins.

## Non-goals

- **User-scope skills** (`~/.claude/skills/`, `~/.codex/skills/`,
  `~/.config/opencode/skills/`) — not detected, not warned, not
  listed. The owning CLI uses them; Copilot pretends they don't exist.
- **Conversational skill creation** (`skill-creator`) — deferred. v1
  has no "New skill" CTA on the Skills tab; users author skills by
  hand or import from agent folders.
- **A visual SKILL.md editor.** Edit opens the file in Obsidian's
  editor.
- **Per-row collision resolution UI on import.** v1 auto-suffixes
  (`foo-2`, `foo-3`, …).
- **Honoring Claude-only flags on OpenCode / Codex.** `model`,
  `disable-model-invocation`, and `user-invocable` are Claude
  Code-only in v1. OpenCode and Codex silently ignore them.
- **Cross-vault skill sync.**

## On-disk layout

The canonical store location is **user-configurable** via the
`agentMode.skills.folder` setting (see §Skills folder setting). The
default is `copilot/skills`, resolved relative to the vault root.
The rest of this doc uses the literal `copilot/skills` for
readability; everywhere it appears in a path (including the
lifecycle table, consent card, reconciliation rules, milestone
checkpoints, and spawn-time directives), substitute the configured
value. The placeholder `<skills-folder>` is used in a few places
where the configurability is load-bearing for understanding.

```
<vault>/
  <skills-folder>/                       ← canonical home for every managed skill
                                           (default: copilot/skills)
    <skill-name>/
      SKILL.md                           ← spec frontmatter, Copilot state in metadata
      ...support files
  .claude/skills/<name>                  ← symlink/junction → absolute
                                           <vault>/<skills-folder>/<name>
                                           when Claude toggle is on
  .agents/skills/<name>                  ← symlink/junction (Codex) — same rule
  .opencode/skills/<name>                ← symlink/junction (OpenCode) — same rule
```

Discovery operates in two modes:

- **Steady-state** (every load): walk `<vault>/<skills-folder>/` only.
  Build an in-memory `Skill[]`.
- **Import detection** (on first open and on demand): walk every
  per-agent project path and identify entries that are real
  directories (not symlinks pointing at `<vault>/<skills-folder>/`).
  These are import candidates.

### Skills folder setting

`agentMode.skills.folder` — string, defaults to `"copilot/skills"`.
Stored under `agentMode.skills` alongside the rest of the skills
schema in `src/settings/model.ts`.

**Resolution**:

- Always interpreted as a vault-root-relative POSIX path. Leading
  `/` and `./` are stripped before use. `..` segments are rejected
  (validation error in the settings UI).
- Empty / whitespace-only value falls back to the default.
- Forward slashes only on disk; the UI shows the value as the user
  typed it.

**Settings UI surface** (in the Skills tab, header area or top of
the settings panel — implementation choice):

- Text input labeled "Skills folder" with the configured value.
- Inline helper text: "Where Copilot stores managed skills inside
  your vault. Existing skills won't move automatically — see below."
- Save is disabled while the value fails validation (empty after
  trim, contains `..`, or contains an OS-illegal segment).

**Changing the folder** leaves canonical files alone but tears
down the agent fanout that pointed at the old location:

1. Persist the new value to settings.
2. Do **not** move existing skills automatically — moving a
   directory that is the target of live symlinks/junctions requires
   per-agent retargeting and atomic-replace semantics we'd rather
   not ship silently. The canonical files stay where they are.
3. **Sweep agent dirs**: for each entry under
   `.<agent>/skills/*`, if it's a symlink/junction whose absolute
   target resolves into the **previous** configured folder, remove
   it. Real directories and symlinks pointing anywhere else are
   left untouched (user-owned). The canonical SKILL.md files are
   the source of truth — `copilot-enabled-agents` lets us rebuild
   the fanout later if the user flips the setting back.
4. Re-run discovery against the new path on the next Skills-tab
   open. The grid reflects whatever lives at the new location
   (likely empty on first switch).
5. Surface a one-time notice in the Skills tab body when the new
   folder is empty but the old folder still contains skills:

   > Your skills folder changed to `<new>`. The agent symlinks
   > that pointed at `<old>` have been removed. Move those skills
   > into `<new>` (drag in Obsidian or in your file explorer) to
   > relink them, or switch the setting back to restore the fanout.

   Users who need migration can change the setting back (fanout
   rebuilds automatically from `copilot-enabled-agents`), move the
   files by hand, then flip the setting forward again.

6. Reconciliation only ever operates against the **currently
   configured** folder. Flipping back to a previously configured
   folder rebuilds the symlinks from each canonical SKILL.md's
   `copilot-enabled-agents` — nothing is lost.

**Spawn-time directive** (see §Decisions captured — "Spawn-time
system prompt steers skill creation into the managed folder")
must template the **currently configured** folder, not a hardcoded
`copilot/skills`. Each backend's `descriptor.ts` reads the live
setting at spawn time.

### Frontmatter

Shared fields follow the agentskills.io spec verbatim. Claude
Code-only flags are written at top level in Claude's native style.
The single Copilot-only field — agent symlink fanout — lives inside
`metadata`.

```yaml
---
name:
  review-prose # spec: required, 1–64 chars, lowercase a-z/0-9/-,
  #       no leading/trailing/consecutive hyphens,
  #       must match parent directory name
description: Critique writing for clarity, voice, and rhythm. # spec: required, ≤1024 chars
allowed-tools: Read Grep WebSearch # spec experimental + Claude native; space-separated
model: claude-opus-4-7 # Claude Code native; omitted = agent default
disable-model-invocation: false # Claude Code native; default false
user-invocable: true # Claude Code style (kebab-case top-level); default true
metadata:
  copilot-enabled-agents: "claude,opencode"
---
<skill body — pure markdown, no Copilot directives>
```

Rules:

- **Shared fields** (`name`, `description`, `license`,
  `compatibility`, `allowed-tools`, `metadata`) — written exactly as
  the agentskills.io spec defines them.
- **Claude Code-only flags** — top-level keys in Claude's native
  kebab-case style. Claude's loader picks them up directly via the
  symlink at `.claude/skills/<name>/`, which means we don't need to
  synthesize deny rules at spawn time for them.
  - `model` — model key passed to Claude. Omitted = Claude default.
  - `disable-model-invocation` — boolean. When `true`, Claude cannot
    auto-invoke the skill from its own reasoning. The user can still
    call it via the chat slash menu. Default `false`.
  - `user-invocable` — boolean (Claude-style kebab-case; not a
    native Claude field but follows the convention). When `false`,
    the skill is hidden from the chat slash menu. Enforced
    Copilot-side. Default `true`. (No palette / right-click surface
    for managed skills in v1 — see §M7.)
- **`metadata.copilot-enabled-agents`** — comma-separated list of
  `claude`, `codex`, `opencode`. Source of truth for which agents
  have a symlink in their project dir. Empty string = none.
  Lives in `metadata` because it has no Claude-native analog.
- Unknown top-level fields the spec doesn't define are tolerated on
  read (OpenCode and Codex are permissive); we only emit the keys
  listed above. Unknown `metadata` keys (e.g. `author`, `version`)
  are preserved on round-trip but never read or written by Copilot.
- The on-disk symlinks are derived from `copilot-enabled-agents`; on
  startup we reconcile (create missing symlinks, remove orphans).

There is no `data.json` enable map and no separate skip-list.
Per-skill state travels with the skill file.

### Windows compatibility

- **Directory junction instead of symlink.** `fs.symlink()` on Windows
  requires admin privileges or Developer Mode (Settings → Privacy &
  security → For developers); a stock Obsidian process gets `EPERM`.
  Use `fs.symlink(absoluteTarget, linkPath, 'junction')` on
  `process.platform === 'win32'`. Junctions are directory-only (✓),
  require **absolute** targets (resolve before passing), and are
  same-volume only (✓).
- **Privilege fallback.** On `EPERM`, surface a one-time notice in
  the Skills tab ("Multi-agent fanout requires Developer Mode on
  Windows; until then enabled per-agent toggles will be no-ops"). The
  canonical SKILL.md is still authoritative; the user can fix it later
  by enabling Developer Mode and re-toggling.
- **Rename-with-retry.** Bulk-move (M2) and atomic-replace on toggle
  flip (M3) hit `EBUSY` / `EPERM` whenever Obsidian's vault watcher,
  OneDrive / Dropbox, or AV holds an open handle. Reuse the existing
  helper at
  `src/agentMode/backends/opencode/OpencodeBinaryManager.ts:401-413`.
- **Sync-folder caveat.** When the vault lives inside OneDrive /
  iCloud Drive / Dropbox on Windows, sync clients sometimes replace
  junctions with shortcuts or skip them entirely. Detect via substring
  match on the absolute vault path and render a one-line warning in
  the Skills tab.

## Skill lifecycle

| Action             | Effect                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toggle agent X on  | Create symlink/junction at `<vault>/.<X-dir>/skills/<name>` → `<vault>/copilot/skills/<name>` (absolute target). Append `X` to `metadata.copilot-enabled-agents`.                                                             |
| Toggle agent X off | Remove that symlink. Canonical copy untouched. Remove `X` from `metadata.copilot-enabled-agents`.                                                                                                                             |
| Edit SKILL.md      | Open `<vault>/copilot/skills/<name>/SKILL.md` in Obsidian's editor. Body and frontmatter both editable; reconciliation picks up changes on next focus.                                                                        |
| Edit settings      | Open per-skill modal (name, description, allowed-tools, Claude-only flags). See §Edit settings modal. Renames are an atomic dir-rename + per-agent symlink swap (delete old `<old-name>` link, create new `<new-name>` link). |
| Delete             | Remove the canonical directory and every symlink under each agent's project dir. Confirmation dialog lists the concrete paths (see §States). Vault sync / git is the rollback path.                                           |

Toggle ops are atomic-replace-friendly: if the target path already
exists (e.g. a leftover real dir from an aborted move), rename it to
`.<name>.replacing`, create the link with an absolute target, then
delete the `.replacing` directory.

## The consent card (first-run import)

When the Skills tab opens and discovery finds ≥1 importable skill (a
real directory under `.<agent>/skills/<name>/` that is not a symlink
to `<vault>/copilot/skills/`), the tab body shows a single card:

```
You already have some skills in this vault

We spotted <N> skills tucked inside your agent folders.
Copilot can bring them together in one place so it's easier
to see them, share them across agents, and tweak them.

▸ skill-a, skill-b, skill-c                  (from Claude)
▸ research-helper                            (from Codex)
▸ writing-coach, daily-note                  (from OpenCode)

Your agents will keep working exactly the same — we just
leave shortcuts behind so nothing breaks. If two skills
share a name we'll add a small suffix (foo-2, foo-3, …).

[ Not now ]                          [ Bring them together ]
```

The preview list is read-only — no per-row toggles, no collision UI.

- **Bring them together** runs the bulk move. Each skill lands with
  `metadata.copilot-enabled-agents` set to its source agent.
- **Not now** leaves everything in place. The tab then shows the
  quiet placeholder. No persistent skip-list; a `Find existing skills`
  header action re-runs detection on demand.

If discovery returns zero candidates AND zero managed skills exist,
the tab body is just one short line: "Skills you create or import
will show up here." Skills is on by default — there's nothing to
opt into.

### Bulk-move per skill (atomic)

1. **Move** `<vault>/.<agent>/skills/<name>/` →
   `<vault>/copilot/skills/<name>/`. Use the rename-with-retry helper.
   On name collision in the canonical store, append the smallest
   suffix (`-2`, `-3`, …) that keeps the name spec-valid.
2. **Verify** the canonical copy parses (SKILL.md frontmatter is
   valid per spec). On failure, move back and abort this row with a
   one-line notice.
3. **Stamp `metadata`**: set `copilot-enabled-agents` to the source
   agent. Preserve every other frontmatter field byte-for-byte
   (within the spec's allowed shape).
4. **Atomic-replace** the original path with a symlink/junction to
   the canonical copy, absolute target. On Windows without privilege,
   skip the link and surface the one-time EPERM notice.
5. An interrupted run can leave the canonical copy without the
   symlink; reconciliation on next load walks
   `copilot-enabled-agents` and recreates any missing links.

## Filtering enabled skills per backend

Default for every imported skill: `copilot-enabled-agents` includes
the source agent only.

The per-spawn deny list is rebuilt every time a backend launches a
session, computed as `cross_discovered − enabled_for_<backend>`,
where:

- `cross_discovered` = the set of managed skills the backend would
  otherwise see via cross-discovery (OpenCode reads `.claude/skills/`
  and `.agents/skills/` in addition to its own).
- `enabled_for_<backend>` = managed skills whose
  `copilot-enabled-agents` includes `<backend>`.

**Claude (SDK)**: Claude's loader honors top-level
`disable-model-invocation` and `model` natively via the symlink at
`.claude/skills/<name>/`. We don't synthesize spawn-time deny rules
for them. Claude has no cross-discovery to worry about, so its deny
list is usually empty. (We still wire the deny mechanism for
defense-in-depth and for any future cross-discovery surface.)

**OpenCode**: extend `OPENCODE_CONFIG_CONTENT` (already injected at
spawn by `OpencodeBackend.buildSpawnDescriptor`,
`src/agentMode/backends/opencode/OpencodeBackend.ts:82-86`) with
`permission.skill: { "<name>": "deny" }` per skill in
`cross_discovered − enabled`. The Claude-only flags
(`disable-model-invocation`, `user-invocable`, `model`) are unknown
to OpenCode and are silently ignored by its frontmatter loader; we
don't translate them.

**Codex**: managed skills are governed by symlink presence only. If
the Codex toggle is off, there is no symlink at
`.agents/skills/<name>` and Codex cannot see the skill. The
Claude-only flags are unknown to Codex and ignored.

### Reconciliation — keeping the fanout in sync

The managed folder and the per-agent symlink dirs stay aligned via
a single idempotent reconciliation pass owned by `SkillManager`.
**`metadata.copilot-enabled-agents` is the source of truth; the
agent-dir symlinks are a derived view.** Whenever the two disagree,
the filesystem is reshaped to match the metadata — never the
reverse.

#### What constitutes a "managed" entry

For reconciliation purposes, an entry at `.<agent>/skills/<name>/`
is **managed** (and therefore reconciliation's to touch) iff it's a
symlink/junction whose absolute target resolves into the **current
or any previously configured** skills folder. Everything else —
real directories, symlinks pointing elsewhere, broken symlinks
pointing into directories we never owned — is **user-owned** and
reconciliation never modifies it. The "previously configured"
allowance covers the brief window between a folder change and the
sweep landing; outside that window the same rule lets us clean up
state left by an aborted sweep.

#### Triggers

A pass runs (debounced 250ms, single-flight — see Concurrency):

1. **Plugin load**, once, after `app.vault.onLayoutReady`.
2. **Skills-tab open** and on Skills-tab focus regained.
3. **App / window focus regained** — defensive; catches external
   changes (git pull, file-manager edits, sync clients) made while
   the plugin wasn't observing.
4. **Vault-watcher events** scoped to:
   - `<skills-folder>/**` — `create` / `modify` / `delete` /
     `rename` on any `SKILL.md` or the parent dir.
   - `.claude/skills/**`, `.agents/skills/**`,
     `.opencode/skills/**` — link/dir mutations from outside
     Copilot.
5. **Immediately after every Copilot-initiated write** — toggle,
   rename, delete, bulk import, folder change. The UI doesn't wait
   for the watcher; the action runs reconciliation locally so the
   grid reflects the new state on the same tick.

Obsidian's `app.vault.on(...)` only fires for vault-indexed paths;
symlink dirs and files outside the markdown tree can fall through.
Use `fs.watch` (or `chokidar` if multi-platform reliability proves
flaky) on the four watched roots above, scoped to the vault root,
and tear the watchers down in `onunload`.

#### The pass (idempotent)

1. **Walk the canonical store.** Read every
   `<skills-folder>/<name>/SKILL.md`, validate against the spec,
   build `Skill[]`. Files that fail validation are skipped with a
   one-line warning surfaced in the Skills tab (no symlink work is
   done for an invalid skill — its symlinks, if any, fall through
   to step 3 and are treated as orphans).
2. **Forward sync** — for each skill, for each agent in
   `metadata.copilot-enabled-agents`:
   - Link missing → create it (absolute target).
   - Link present, target resolves to current canonical → no-op.
   - Link present, target resolves elsewhere or is broken →
     atomic-replace via the §Skill lifecycle helper.
   - A **real directory** sits at the path → log a one-line
     warning and skip. Reconciliation never deletes real
     directories. (This is the "import never completed" or
     "user dropped a folder here" case; the user resolves it
     by running the consent card or moving the dir.)
3. **Reverse sync (orphan removal)** — for each agent path, list
   entries and remove any link that meets all of:
   - Is a symlink/junction (never a real dir).
   - Resolves into the current or previously configured skills
     folder.
   - Its basename has no matching entry in step 1's `Skill[]`,
     or its target's `<name>` no longer matches the link's
     basename.
4. **Emit state.** Publish the new `Skill[]` through `SkillManager`'s
   subscription so `SkillsSettings.tsx` re-renders.

#### Concurrency

- **Single-flight.** `SkillManager` holds an `inFlight: Promise<void> | null`.
  Triggers that fire while a pass is running coalesce to one
  trailing pass scheduled when the current one settles.
- **Debounce.** Watcher-driven triggers are debounced 250 ms so a
  multi-file save or git checkout fires one pass, not N.
- **UI writes are awaited.** Toggle / rename / delete handlers
  `await` reconciliation before resolving so the grid never paints
  a stale state.

#### Failure handling

- **Windows EPERM** on `fs.symlink(..., 'junction')` → per-skill
  warning surfaced in the Skills tab, pass continues for the
  remaining skills, metadata is **not** rolled back. The skill
  re-attempts its fanout on every subsequent pass; the user enables
  Developer Mode and the next trigger heals it.
- **Parse errors** on `SKILL.md` → that skill is skipped with a
  one-line warning; orphan removal in step 3 will clean its stale
  symlinks since it's absent from `Skill[]`.
- **Mid-pass `ENOENT` / `EBUSY`** (sync client or AV grabbed the
  file) → use the existing rename-with-retry helper for writes;
  swallow ENOENT on reads (the file was deleted out from under us;
  the next pass picks up the new reality).
- **All errors are non-fatal to the pass** — a partial reconcile is
  better than a thrown promise that never re-emits state.

## UI — V1 Tidy list row

The Skills tab follows the **V1 Tidy list row** variant from the
attached Claude design exploration (the `#v1` section in
`Skills Tab v2.html`). The plugin matches the visual contract — not
the literal HTML/CSS, which is a prototype.

### Row anatomy

```
┌──────────────────────────────────────────────────────────────────┐
│ skill-name                                  [C][X][O]      ⋯     │
│ One-line description from frontmatter.                            │
└──────────────────────────────────────────────────────────────────┘
```

- **Left**: skill name (bold) + one-line description (muted).
- **Right**: three agent icons (Claude / Codex / OpenCode) acting as
  toggles. Brand-colored when enabled (Claude coral, Codex charcoal,
  OpenCode green); dashed-outline + muted glyph when disabled. Tap to
  flip — immediate effect, no confirmation.
- **Far right**: ⋯ overflow menu (`Edit SKILL.md · Edit settings · Delete`).

### States

- **Consent-needed** — the consent card body (see §The consent card).
- **Empty placeholder** — one short line ("Skills you create or
  import will show up here.") shown when there are no managed skills
  and no detectable candidates. No CTA in v1.
- **Steady-state grid** — list of V1 rows.
- **Edit settings modal** — per-skill modal; fields below.
- **Delete confirmation** — modal body lists the concrete paths
  that will be removed so the user can verify before confirming:

  ```
  Delete <name>?

  This will remove:
    • <vault>/copilot/skills/<name>/
      (canonical SKILL.md and supporting files)
    • <vault>/.claude/skills/<name>           (if linked)
    • <vault>/.agents/skills/<name>           (if linked)
    • <vault>/.opencode/skills/<name>         (if linked)

  Vault sync / git is the only rollback path.

  [ Cancel ]                       [ Delete skill ]
  ```

  Only the agent-symlink lines whose agent appears in
  `metadata.copilot-enabled-agents` are rendered. The action button
  uses the destructive variant.

### Header action

Top-right: **Find existing skills** — re-runs import detection and
reopens the consent card.

There is no **New skill** button in v1.

### Visual language

Use Obsidian's existing settings density and typography (Tailwind
`text-normal`, `text-muted`, `border-border`). Do not replicate the
prototype's Kalam / Caveat / JetBrains-Mono aesthetic — that is
prototype chrome, not product chrome.

### Edit settings modal

Opened from the row's ⋯ menu. The single metadata surface for a
managed skill — Markdown body editing is reserved for **Edit
SKILL.md** (Obsidian's editor). Fields, top to bottom:

- **Name** _(all agents)_ — text input mapped to the top-level
  `name` field. Validated against the spec
  (`^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 chars). Changing the value
  triggers the rename mechanics below.
- **Description** _(all agents)_ — text input mapped to the
  top-level `description` field. 1–1024 chars, non-empty per spec.
  Plain frontmatter rewrite; no symlink work.
- **Allowed tools** _(all agents)_ — text input mapped to the
  top-level `allowed-tools` field (space-separated string, spec
  experimental + Claude native). No per-agent translation — the
  value is the literal frontmatter string. Example:
  `Read Grep Bash(git:*)`.
- **Model override** _(Claude Code only)_ — text input mapped to
  the top-level `model` field. UI label carries "(Claude Code only)".
  Honored by Claude's loader directly; unknown to OpenCode / Codex.
- **Don't let Claude invoke this on its own** _(Claude Code only)_
  — checkbox mapped to the top-level `disable-model-invocation`
  field. Honored by Claude's loader directly; unknown to OpenCode /
  Codex.
- **Show in slash menu** _(Claude Code only)_ —
  checkbox mapped to the top-level `user-invocable` field (default
  on). Enforced Copilot-side by hiding the skill from the chat
  slash menu. Claude / OpenCode / Codex don't have a first-party
  equivalent; we label it Claude-only to avoid implying parity.
  (No palette / right-click surface in v1 — see §M7.)

#### Rename mechanics

A rename via this modal is the only interactive code path that
mutates a skill's identity. The save action runs atomically:

1. Validate the new `name` against the spec. Surface inline
   validation errors and keep the dialog open.
2. If another managed skill already owns the new name under
   `copilot/skills/`, show an inline collision error and don't save.
   **No auto-suffix in interactive edits** — auto-suffix is reserved
   for bulk import where the user has no chance to intervene.
3. Rename `copilot/skills/<old>/` → `copilot/skills/<new>/` via the
   rename-with-retry helper (`OpencodeBinaryManager.ts:401-413`).
4. For each agent in `metadata.copilot-enabled-agents`: **remove**
   the old symlink at `.<agent>/skills/<old>/` and **create** a
   fresh symlink at `.<agent>/skills/<new>/` pointing at the
   renamed canonical (absolute target). The two paths are different,
   so this is delete-old + create-new, not a same-path retarget;
   use the atomic-replace strategy from §Skill lifecycle if a stale
   entry from an aborted prior run already sits at the new path.
   Old links must be gone before the operation reports success —
   leaving them would leave the agent resolving `/old-name` to the
   renamed skill.
5. Rewrite the `name:` value inside SKILL.md so the spec's
   parent-directory-match rule (see §Frontmatter) holds.
6. On Windows-EPERM symlink failures, surface the same one-time
   notice as toggle ops. The canonical rename still succeeds; the
   user can re-toggle once Developer Mode is on.

## Slash command

Managed skills are invokable from the chat slash menu only. The
command palette and editor right-click context menu are **out of
scope for v1** for managed skills — see §Milestones / §M7 below.
Legacy custom commands continue to surface on the palette and
right-click as they always have, via the existing
`CustomCommandRegister`; that path is untouched.

### Chat slash menu

- The slash menu lists managed skills currently enabled for the
  active backend (i.e., `metadata.copilot-enabled-agents` includes
  the active agent) **plus** every legacy custom command not hidden
  by collision.
- Skills with top-level `user-invocable: false` are hidden.
- **Managed skill** → Copilot does nothing special. The user's
  message reaches the agent containing the `/skill-name` literal;
  the agent's native skill resolver picks it up via the symlink in
  `.<agent>/skills/<name>/`. Args go to the agent verbatim.
- **Legacy custom command** → the command body is passed to the
  active agent at runtime (not pasted into the input).
- **Visual identical**: after Enter, the chat bubble shows
  `/skill-name` or `/command-name` and the agent streams its
  response. The user doesn't need to know which mechanism is firing.
- **Name collision**: managed skill wins on the slash menu. The
  legacy custom command stays available on the palette / right-click
  via its own registration.

### Plain-LLM fallback

When no agent backend is configured, route through
`useStreamingChatSession` (`src/hooks/use-streaming-chat-session.ts`)
with the skill body or command body as the prompt, args appended
naively. Keeps Skills usable without Agent Mode.

## Critical files

- `src/agentMode/backends/{claude,codex,opencode}/descriptor.ts` —
  spawn descriptor surface; OpenCode already injects
  `OPENCODE_CONFIG_CONTENT` (we extend it to add per-name deny
  entries and the read-only profile).
- `src/agentMode/backends/registry.ts` — add per-backend skill path
  map.
- `src/commands/{type,state,customCommandRegister,contextMenu,CustomCommandChatModal,customCommandUtils}.ts`
  — legacy command surface preserved; updated to route content to
  the agent at runtime and to hide commands shadowed by managed
  skills.
- `src/components/chat-components/plugins/SlashCommandPlugin.tsx` —
  rewire to managed skills + legacy commands; runtime injection
  instead of paste; skill wins on name collision.
- `src/settings/v2/components/SkillsSettings.tsx` (new) — V1 Tidy
  list row grid, consent card, empty placeholder, Edit settings
  modal, Delete confirmation.
- `src/settings/v2/components/CommandSettings.tsx` — untouched.
- `src/settings/model.ts` — extend `agentMode.skills` schema with
  `folder: string` (default `"copilot/skills"`). No `skippedImports`
  field; per-skill state lives in SKILL.md.
- `src/agentMode/skills/SkillManager.ts` (new) — canonical-store
  discovery, bulk-move, symlink lifecycle, reconciliation.
- `src/agentMode/skills/skillFormat.ts` (new) — SKILL.md
  parse/serialize strictly against the agentskills.io spec. Validates
  `name` constraints + parent-directory match. Preserves unknown
  `metadata` keys on round-trip.
- `src/agentMode/sdk/skillDenyList.ts` (new) and per-backend
  equivalents — emit per-name deny snippets for cross-discovery only.
  Claude's loader handles `disable-model-invocation` natively via
  the symlink, so we don't synthesize deny rules for it.
- `eslint.config.mjs` + `src/agentMode/CLAUDE.md` — register
  `skills/` as a new Agent Mode layer with restricted cross-imports.
  See §ESLint boundary updates below.

## ESLint boundary updates

Placing skills under `src/agentMode/skills/` makes it a new Agent
Mode layer in the sense `src/agentMode/CLAUDE.md` describes
("Adding a new layer"). Two follow-ups need to land in the same PR
as M1 so the discipline isn't silently broken.

### Boundary plugin status

`src/agentMode/CLAUDE.md` references `eslint-plugin-boundaries` and a
`boundaries/elements` / `boundaries/dependencies` discipline, but
`eslint.config.mjs` does not currently register the plugin —
`no-restricted-imports` is the only import-restriction rule named,
and it is `off`. Before the rules below can be enforced, either:

1. Wire `eslint-plugin-boundaries` into `eslint.config.mjs` with
   `elements` covering every existing Agent Mode layer (`session`,
   `acp`, `sdk`, `backends`, `ui`) plus the new `skills` element.
2. Or, if pulling in the plugin in this PR is out of scope, encode
   the same intent via `no-restricted-imports` with `patterns`
   (zone-style) as an interim. Same rules, simpler surface.

Whichever path is chosen, it should also retrofit the existing
layers — leaving boundaries off everywhere except `skills/` would
let the rest of Agent Mode drift further.

### `skills/` element + dependency rules

Add `skills` matching `src/agentMode/skills/**` with the following
direction rules:

- **Skills may import**:
  - `src/agentMode/session/**` — types only (`SessionEvent`,
    `BackendId`, descriptor surface).
  - Shared utilities outside agent-mode that don't reach into
    backend internals (`src/logger`, generic vault helpers).
  - `node:fs`, `node:path` — already permitted by the
    `src/agentMode/**` override at `eslint.config.mjs:240-248`,
    which the new path inherits automatically. Confirm the inherited
    `import/no-nodejs-modules: off` still matches once any new
    boundaries config lands; if the glob narrows, re-add the
    inheritance explicitly.
- **Skills must NOT import**:
  - `src/agentMode/acp/**` — ACP wire types are confined there.
  - `src/agentMode/sdk/**` — sibling in-process driver layer.
  - `src/agentMode/backends/**` — backend-specific internals.
    Spawn descriptors consume skills, not the other way around.
  - `src/agentMode/ui/**` — UI is a downstream consumer.
- **Inbound (who may import `skills/`)**:
  - `src/agentMode/backends/**` (spawn-time deny list composition;
    `OPENCODE_CONFIG_CONTENT` extension).
  - `src/agentMode/sdk/**` and `src/agentMode/ui/**` for the same
    reason — they read managed-skill state.
  - `src/settings/v2/components/SkillsSettings.tsx` — owns the
    consent card, grid, and modals and calls into `SkillManager`.
  - `src/main.ts` for plugin-level registration.

### Doc updates that ride along

- `src/agentMode/CLAUDE.md`: add `skills/` to the numbered layer list
  with a one-line description ("canonical-store discovery, symlink
  lifecycle, reconciliation; no agent-wire awareness"). Add `skills/`
  to the "What lives where (cheatsheet)" section too.
- This design doc — already reflects the new path under
  `src/agentMode/skills/`.

### M1 checkpoint add-on

`npm run lint` passes after the new boundary rules land — confirms
`skills/` cannot reach into `acp/`, `sdk/`, `backends/`, or `ui/`,
and that consumers (`backends/<id>/descriptor.ts`,
`SkillsSettings.tsx`, `main.ts`) can still import it.

## Decisions captured

- **One canonical home, no scopes.** Every managed skill lives at
  `<vault>/<skills-folder>/<name>/`, where `<skills-folder>` is the
  user-configurable `agentMode.skills.folder` (default
  `copilot/skills`). No scope badges, no Promote action, no
  project / user / managed distinction.
- **Skills folder is user-configurable.** `agentMode.skills.folder`
  lets users pick the vault-relative folder where managed skills
  live. Default `copilot/skills`. Changing the value doesn't
  auto-migrate existing skills — see §Skills folder setting.
- **Consent only when there's something to consent to.** Friendly
  card with one-click bulk move; quiet placeholder when there's
  nothing detected.
- **Shared frontmatter follows the agentskills.io spec.**
  Claude-only flags (`model`, `disable-model-invocation`,
  `user-invocable`) sit at top level in Claude's native kebab-case
  style so Claude's loader honors them directly. The single
  Copilot-only field lives under `metadata.copilot-enabled-agents`.
- **Three Claude Code-only fields.** `model`,
  `disable-model-invocation`, `user-invocable` are labeled
  "(Claude Code only)" in the UI. Claude's loader enforces the
  first two; `user-invocable` is enforced Copilot-side by hiding
  the skill from the chat slash menu (managed skills have no
  palette / right-click surface in v1 — see §M7). OpenCode and
  Codex silently ignore all three.
- **Slash unified.** Both legacy commands and managed skills go to
  the agent at runtime; nothing pastes into the input. Skill wins
  on name collision.
- **User-scope skills ignored entirely.** Not detected, not warned,
  not listed.
- **No skill-creator in v1.** Conversational skill creation deferred.
- **No Add CTA in v1.** Skills enter the managed store via the
  consent card, by hand-authoring SKILL.md, or by an agent writing
  one on the user's behalf (see next bullet). The Skills tab has no
  "New skill" button and the empty state is just one line of copy.
- **Edit settings is the single metadata surface.** The row's
  ⋯ menu offers `Edit SKILL.md · Edit settings · Delete`. Body
  editing goes through Obsidian's Markdown editor; frontmatter
  editing (name, description, allowed-tools, three Claude-only
  flags) goes through the modal. Renames are an atomic dir-rename
  - symlink-retarget op.
- **Delete confirmation lists concrete paths.** The modal body
  enumerates `copilot/skills/<name>/` and every agent symlink
  currently in `copilot-enabled-agents` so users can verify the
  blast radius before confirming.
- **Spawn-time system prompt steers skill creation into the
  managed folder.** Every backend's spawn descriptor injects a
  one-line directive: when the user asks the agent to create a
  skill, write `<vault>/<skills-folder>/<name>/SKILL.md` with
  spec-valid frontmatter and `metadata.copilot-enabled-agents`
  pre-set to the authoring agent. `<skills-folder>` is templated
  from `agentMode.skills.folder` at spawn time (default
  `copilot/skills`). Never write into the agent-specific paths —
  those are symlink-fanout locations Copilot reconciles
  automatically.
- **Custom Commands tab unchanged.** No migration UI; the two
  systems coexist permanently as far as v1 is concerned.

## Milestones

Each milestone is independently shippable and verifiable. Checkpoints
are concrete pass/fail steps the user can run by hand.

### M1 — Canonical-store discovery + read-only V1 grid + empty placeholder

**Goal**: every skill in `<vault>/copilot/skills/` shows up in the
Skills tab. Empty placeholder when none. Nothing is mutated.

**Scope**:

- `agentMode.skills.folder` setting wired in `src/settings/model.ts`
  with default `"copilot/skills"`. Settings UI exposes a "Skills
  folder" input with validation (no `..`, no empty, no leading `/`)
  and the one-time notice for old-folder symlinks.
- `src/agentMode/skills/SkillManager.ts` reads the configured folder
  via the settings singleton (top-level orchestration only — inner
  helpers receive the resolved absolute path as a parameter, per the
  "Avoiding Deep Dependency Chains in Tests" rule in AGENTS.md) and
  walks `<vault>/<skills-folder>/` only.
- `src/agentMode/skills/skillFormat.ts` parses + validates SKILL.md against
  the Agent Skills spec. Validates `name` (1–64 chars, lowercase
  a–z/0–9/hyphens, no leading/trailing/consecutive hyphens, must
  match parent dir) and `description` (1–1024 chars, non-empty).
- `SkillsSettings.tsx`: V1 Tidy list row grid. Toggles rendered but
  inert in this milestone.
- Empty placeholder when discovery returns zero skills.
- Legacy `CommandSettings.tsx` left in place.

**Checkpoints**:

1. Fresh vault, no managed skills → Skills tab shows the empty
   placeholder.
2. Hand-create `<vault>/copilot/skills/managedfoo/SKILL.md` with
   valid spec frontmatter → reload → row "managedfoo" appears.
3. Hand-create a SKILL.md with an invalid `name` (uppercase,
   leading hyphen, consecutive hyphens, mismatched parent dir) →
   the row is skipped with a one-line warning in the tab.
4. SKILL.md with extra `metadata` keys (e.g. `author`, `version`)
   → round-trip unit test confirms unknown `metadata` keys are
   preserved byte-equal.
5. Default setting → discovery walks `<vault>/copilot/skills/`.
   Change `agentMode.skills.folder` to `team-skills` → reload →
   discovery walks `<vault>/team-skills/`; the original
   `copilot/skills/` folder is ignored.
6. Validation: set the folder to `../escape` or `/abs/path` → the
   settings UI rejects the value and Save stays disabled. Empty
   string trims to the default `copilot/skills` on save.
7. Switching the folder while skills already exist in the old
   location surfaces the one-time notice in the Skills tab body,
   leaves the canonical files in the old folder untouched, and
   **removes every agent symlink whose target resolves into the
   old folder**. Flipping the setting back rebuilds those symlinks
   from each canonical SKILL.md's `copilot-enabled-agents`.

### M2 — Consent card + bulk move

**Goal**: existing skills under `.claude/skills/`,
`.agents/skills/`, `.opencode/skills/` can be imported into the
canonical store via the consent card.

**Scope**:

- Import detection walker scans every per-agent project path and
  emits candidates that are real directories (not symlinks pointing
  at `<vault>/copilot/skills/`).
- Consent card UI shown only when ≥1 candidate exists.
  **Bring them together** runs the bulk move; **Not now** dismisses
  the card and shows the placeholder / grid.
- `Find existing skills` header action re-runs detection.
- Bulk move per skill:
  - Move source dir → `copilot/skills/<name>/` via
    rename-with-retry. On name collision, smallest suffix
    `-2`, `-3`, ….
  - Verify SKILL.md parses; on failure, move back and surface a
    one-line error.
  - Stamp `metadata.copilot-enabled-agents` with the source agent.
  - Create symlink/junction at the original agent path → canonical
    (absolute target). On Windows EPERM, surface the one-time
    notice and proceed without the link.

**Checkpoints**:

1. Fresh vault with `.claude/skills/foo/`, `.agents/skills/bar/`,
   `.opencode/skills/baz/` (all real dirs) → open Skills tab →
   consent card lists all 3 grouped by source.
2. Click **Bring them together** →
   `<vault>/copilot/skills/{foo,bar,baz}/` exist with original
   contents; each agent folder has a symlink to the canonical;
   each SKILL.md has `metadata.copilot-enabled-agents` set to its
   source.
3. Click **Not now** on a separate fixture → nothing moves;
   placeholder / existing grid shown.
4. Click `Find existing skills` header action → consent card
   re-opens with current candidates.
5. Name collision (managed `foo` already exists, candidate `foo`
   under `.claude/skills/`) → imported as `foo-2`; both rows
   present in the grid.

### M3 — Per-agent toggles for managed skills (symlinks)

**Goal**: managed skills can be made visible to any subset of agents
via per-agent toggles. Edit and Delete actions wired up.

**Scope**:

- Toggle on for an agent → create a symlink (POSIX) / directory
  junction (Windows) at `<vault>/.<agent>/skills/<name>` →
  absolute path of `<vault>/copilot/skills/<name>`.
  Atomic-replace if the path already exists. Append the agent to
  `metadata.copilot-enabled-agents`.
- Toggle off → remove the link. Canonical copy untouched. Remove
  the agent from `metadata.copilot-enabled-agents`.
- On Windows without privilege: surface the one-time notice; the
  on-disk fanout is a no-op until Developer Mode is enabled.
- Edit action opens `<vault>/copilot/skills/<name>/SKILL.md` in the
  Obsidian editor.
- Delete action removes the canonical dir + every symlink (confirm
  dialog).
- Reconciliation pass on Skills-tab load and on relevant
  vault-watch events.

**Checkpoints**:

1. Managed card "managedfoo" with all three toggles off → no
   symlinks exist under any agent's project dir.
2. Toggle Claude on → `<vault>/.claude/skills/managedfoo` is a
   symlink to `<vault>/copilot/skills/managedfoo`;
   `metadata.copilot-enabled-agents` includes `claude`.
3. Toggle Claude off → symlink removed; canonical copy intact;
   `metadata.copilot-enabled-agents` no longer includes `claude`.
4. Toggle all three on → three symlinks (Claude / Codex / OpenCode).
5. Edit the canonical SKILL.md body → invoke `/managedfoo` from
   any enabled agent's session → updated body runs.
6. Click ⋯ → **Delete** → confirmation modal lists
   `<vault>/copilot/skills/managedfoo/` plus each agent's symlink
   currently in `copilot-enabled-agents`. Confirm → all listed
   paths removed; the canonical dir is gone; no orphan symlinks
   remain.
7. Manually `rm` a symlink that should exist per
   `copilot-enabled-agents` → reload Skills tab → reconciliation
   recreates it.

### M3.5 — Agent-authored skills land in the managed folder

**Goal**: when a user asks the active agent to create a skill, the
agent writes it under `<vault>/copilot/skills/<name>/` (not into an
agent-specific path), and the Skills tab picks it up on the next
reconciliation pass. Depends on M3's reconciliation.

**Scope**:

- Extend each backend's spawn-time system prompt with a one-line
  directive (templated with the authoring agent's kebab-case name
  so the skill comes out pre-enabled for it):

  > When the user asks you to create a skill, write
  > `<vault>/<skills-folder>/<name>/SKILL.md` with valid Agent
  > Skills spec frontmatter — at minimum `name`, `description`,
  > and `metadata.copilot-enabled-agents: "<this-agent>"` where
  > `<this-agent>` is `claude` / `codex` / `opencode` for this
  > session, and `<skills-folder>` is the value of
  > `agentMode.skills.folder` interpolated at spawn time (default
  > `copilot/skills`). Do not write into `.claude/skills/`,
  > `.agents/skills/`, or `.opencode/skills/` — those are symlink
  > locations managed by Copilot; the symlink for this agent will
  > be created automatically on the next Skills-tab reconciliation.

- Wire the directive in
  `src/agentMode/backends/{claude,codex,opencode}/descriptor.ts`
  alongside existing spawn-prompt assembly.
- Reconciliation already lives in M3 — no changes needed here. If
  the agent forgets the `copilot-enabled-agents` metadata, the row
  appears with all toggles off and the user can flip them by hand.

**Checkpoints**:

1. In a Claude session, ask "create a skill that critiques prose" →
   `<vault>/copilot/skills/<name>/SKILL.md` exists with spec-valid
   frontmatter and `metadata.copilot-enabled-agents: "claude"`.
   Reload Skills tab → row appears with Claude toggle on, others
   off. The Claude symlink at `.claude/skills/<name>` exists.
2. Repeat in an OpenCode session → same flow, OpenCode toggle on
   by default and `.opencode/skills/<name>` symlink created.
3. In a Claude session, explicitly say "save it under
   `.claude/skills/`" → the agent should still steer the user back
   to `copilot/skills/` (verifies directive strength). If it
   complies with the user instead, the file is still picked up by
   reconciliation only after the next Skills-tab import detection,
   not automatically — which is the expected fallback behavior.

### M4 — Edit settings modal

**Goal**: per-skill name, description, and advanced options exposed
via the row's ⋯ menu under **Edit settings**.

**Scope**:

- Modal with six fields: `name`, `description`, `allowed-tools`,
  `model`, `disable-model-invocation`, `user-invocable`. All six
  are top-level frontmatter keys. The three Claude-only fields
  carry the "(Claude Code only)" label.
- Name edit triggers the rename mechanics (atomic dir-rename +
  symlink retarget per agent in `copilot-enabled-agents`).
- Collision on rename → inline error, modal stays open, no
  filesystem mutation.
- Round-trip preserves unknown top-level keys and unknown
  `metadata` keys.

**Checkpoints**:

1. Open Edit settings on `foo`, set `allowed-tools: "Read Grep"`,
   `model: "claude-opus-4-7"`, `disable-model-invocation: true` →
   reload → all values round-trip as top-level keys.
2. Inspect SKILL.md against Claude's native loader → Claude reads
   `model` and `disable-model-invocation` directly.
3. Manually add a `metadata.author: "alice"` key → edit settings →
   save → the foreign key is preserved byte-for-byte.
4. Change `description` only → file rewritten with new
   description; no symlink work performed.
5. Rename `foo` → `bar` (with Claude and OpenCode toggles on) →
   `copilot/skills/bar/` exists, `copilot/skills/foo/` gone,
   `.claude/skills/bar` and `.opencode/skills/bar` are symlinks to
   the renamed canonical, old symlinks gone, SKILL.md `name:` is
   `bar`. Atomic — no in-between state where the symlinks dangle.
6. Rename `foo` to an existing name `baz` → inline collision error
   in the dialog; nothing on disk changes.
7. Rename `foo` to an invalid name (uppercase, leading hyphen, etc.)
   → inline validation error; nothing on disk changes.

### M5 — Spawn-time deny (cross-discovery only)

**Goal**: cross-discovery deny emits correctly per backend.
Claude-only flags need no deny synthesis — Claude's loader honors
them natively.

**Scope**:

- OpenCode `permission.skill` per-name deny for every managed skill
  in `cross_discovered_for_opencode − enabled_for_opencode`.
- Claude (SDK) deny mechanism wired for symmetry; the deny set is
  usually empty (Claude has no cross-discovery surface). Useful as
  defense-in-depth.
- Codex: no per-skill deny; managed via symlink presence only.

**Checkpoints**:

1. Managed skill `foo` with `copilot-enabled-agents: "claude"` →
   Claude session sees `foo`; OpenCode session has `foo` denied
   via `permission.skill: { foo: "deny" }` in injected config
   (verify by inspecting the spawn descriptor).
2. Set `disable-model-invocation: true` on `foo` at the top level
   → Claude session auto-invocation of `foo` is blocked (verify
   via Claude's native loader behavior, not via our deny rules).
   User-invocation surfaces unaffected.
3. Toggle OpenCode on for `foo` → next OpenCode spawn no longer
   denies it; `foo` runs normally.

### M6 — Slash-command runtime unification

**Goal**: both managed skills and legacy custom commands run via
the active agent at runtime. UX is visually identical.

**Scope**:

- `SlashCommandPlugin.tsx`: replace today's paste-into-input
  handler with a send that delegates to the active agent session.
  The slash menu lists managed skills enabled for the active agent
  plus legacy commands not hidden by collision.
- Legacy custom command path: pass the command body to the agent
  at runtime (not pasted into the input).
- Managed skill path: do nothing special — the user message
  contains `/skill-name` and the agent's native resolver picks it
  up via the symlink.
- Plain-LLM fallback when no agent backend is configured.

**Checkpoints**:

1. With Claude backend live and a managed skill `summarize`
   (Claude toggle on), type `/summarize text` and hit Enter →
   chat shows `/summarize text`; agent loads SKILL.md via the
   symlink and runs it. Nothing was pasted into the input.
2. Repeat with a legacy `/oldcmd` → identical UX: chat shows
   `/oldcmd`; agent receives the command body at runtime.
3. Slash-name collision: managed `dup` exists and legacy `dup`
   exists → only the managed skill is offered in the slash menu;
   the command still resolves via its palette entry.
4. Disable Claude toggle on `summarize` → slash menu no longer
   lists it for the active Claude session.
5. With Agent Mode disabled and no backend → `/summarize text`
   works via plain-LLM fallback (verify network call goes to the
   user's configured LLM provider).

### M7 — Quick-command surface (palette + right-click) — **out of scope for v1**

A previous iteration of this design proposed surfacing every
enabled managed skill (and every non-shadowed legacy command) on
the Obsidian command palette and the editor right-click context
menu, with a read-only spawn profile. That surface is **explicitly
out of scope for v1** — not deferred, not a follow-up. Managed
skills are reachable only via the chat slash menu (M6); legacy
custom commands continue to surface on the palette and right-click
via their existing `CustomCommandRegister` wiring, unchanged.

Rationale: the slash menu already covers the user-invocable case,
and a duplicate palette / right-click surface introduced collision
rules and a read-only-profile dependency without a clear win over
the chat surface. If we revisit this later it will be a fresh
design pass, not a resurrection of the prior plan.
