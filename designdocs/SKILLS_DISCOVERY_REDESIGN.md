# Skills Discovery Redesign

## 1. Context

Today the Skills settings tab requires users to click a "Find existing skills" button to discover skills that live under agent project folders (`.claude/skills/`, `.agents/skills/`, `.opencode/skills/`). The button clears an import skip-list, re-runs detection, and pops an `ImportConsentDialog` that bulk-moves candidates into the canonical `copilot/skills/` folder.

This is confusing for two reasons:

1. The user has working skills sitting in agent project folders, but they are invisible in the Skills tab until they click an unfamiliar button.
2. The bulk-import-to-canonical model assumes every skill must be migrated to share with Copilot. In practice, many users never plan to use a skill in more than one agent — the unconditional move is unnecessary churn.

Other recurring pain points:

- Users with the same skill duplicated across agents (a common state after they manually copied a SKILL.md from one project to another) currently see it twice; both copies look like un-imported candidates and the consent dialog asks them to import both as separate skills.
- The spawn-time directive that forces every backend to write new skills into the canonical folder fights the agent's own native conventions (Claude expects `.claude/skills/`, Codex expects `.agents/skills/`, etc.).

The redesign reverses the default: the Skills tab discovers skills wherever they live (canonical OR any agent project folder). Migration to canonical happens lazily, only when the user actually wants to share a skill across agents. Identical duplicates across agents collapse into one row. Agents go back to writing skills at their native paths and discovery picks them up.

This doc references [`SKILLS_MANAGEMENT.md`](./SKILLS_MANAGEMENT.md) as the foundation (per-agent layout, frontmatter format, reconciliation pass, symlink fanout, EPERM handling — all unchanged) and only specifies what changes.

## 2. Goals

- Skills tab shows every discoverable skill on open — no rescan button, no consent dialog on first paint.
- Skills that live in agent project folders stay there until the user actually needs them shared.
- Identical duplicates across agents (same name, same directory contents) merge into one row showing both agents enabled.
- Cross-agent sharing surfaces a single, explanatory confirmation that the user can suppress for the rest of their setup time.
- Existing canonical-managed skills behave exactly as today.

## 3. Non-goals

- No change to the SKILL.md format, the `metadata.copilot-enabled-agents` source-of-truth field, the symlink fanout in `.<agent>/skills/`, or the reconciliation pass that heals drift on canonical-managed skills.
- No new slash-command behavior.
- No change to delete, rename, or properties-edit flows for canonical-managed skills.
- Skills with the same name but **different** contents across agents are not auto-resolved; they stay as separate rows with disambiguated display labels.
- No background auto-migration. Migration always follows an explicit user action.

## 4. Mental model: three skill location states

A managed skill is in exactly one of three states based on where its `SKILL.md` lives:

| State | Where SKILL.md lives | Enabled-agents source of truth | Notes |
|---|---|---|---|
| **Canonical** | `<vault>/copilot/skills/<name>/SKILL.md` | `metadata.copilot-enabled-agents` in frontmatter | Today's only state. Agent folders hold symlinks. |
| **Project (single)** | `<vault>/.<agent>/skills/<name>/SKILL.md` for exactly one agent | Inferred from the folder path | The skill belongs to one agent; no canonical copy, no symlinks. |
| **Project (mirrored)** | Identical `SKILL.md` directory trees in two or more `<vault>/.<agent>/skills/<name>/` | Inferred from which agent folders contain the identical copy | Common after a user manually copied a skill between agents; collapses to one row in the UI. |

Identity rule: skills are identified by name. Two skills with the same name and identical directory contents (full recursive content hash, SKILL.md plus every support file) merge. Same name with **different** contents do not merge; see §10 (Edge cases).

## 5. Discovery — what the Skills tab walks

Replace today's canonical-only discovery (`discoverManagedSkills.ts`) with a unified discovery that walks four roots and merges:

1. `<vault>/<configured-skills-folder>/` → produces canonical-managed rows (today's behavior).
2. `<vault>/.claude/skills/` → produces project-managed rows tagged for `claude`.
3. `<vault>/.agents/skills/` → tagged for `codex`.
4. `<vault>/.opencode/skills/` → tagged for `opencode`.

(Agent paths are pulled from `BackendDescriptor.skillsProjectDir` as today.)

For each agent walk, an entry is included only if:

- It is a real directory (not a symlink whose target resolves into the canonical folder — those are the reconciliation symlinks).
- It contains a `SKILL.md` that parses against the Agent Skills spec.

Symlinks pointing into canonical are skipped at the discovery layer (they are already represented by the canonical row they point to). Symlinks pointing anywhere else are also skipped at this layer — reconciliation already covers the user-owned-symlink case.

After all four walks, results are merged by `(name, dirContentHash)`:

- Same name + same hash across multiple agent dirs → one project-mirrored row with `enabledAgents = [each agent dir it appeared in]`.
- Same name + different hash → separate rows; see §10.
- Canonical row always wins the name — if a canonical and a project row share a name, the project row is dropped from discovery (it's stale state that the reconciliation pass will heal by deleting the agent-folder real directory).

## 6. The `Skill` type

Extend the existing `Skill` interface (`src/agentMode/skills/types.ts`) with a `location` discriminator:

```ts
export type SkillLocation =
  | { kind: "canonical" }
  | { kind: "project"; agentDirs: BackendId[] };

export interface Skill {
  name: string;
  description: string;
  filePath: string;        // absolute path to the SKILL.md actually used for display/open
  dirPath: string;         // absolute path to the directory holding that SKILL.md
  body: string;
  // ...existing optional spec fields unchanged
  enabledAgents: BackendId[]; // For canonical skills: parsed from frontmatter.
                              // For project skills: equals location.agentDirs.
  location: SkillLocation;
  contentHash?: string;    // present for project skills; used to detect mirrored duplicates
}
```

For project-mirrored skills the chosen `filePath` / `dirPath` is the alphabetically-first agent's copy (deterministic). Reveal-in-vault and edit-in-Obsidian open that representative copy.

## 7. Toggling agents — what triggers a migration

The per-row agent toggle has three flavors based on current `Skill.location`:

| Current location | Toggle action | Effect | Confirmation? |
|---|---|---|---|
| Canonical | Toggle ON any agent | Update frontmatter; create symlink in `.<agent>/skills/`. | No (today's behavior). |
| Canonical | Toggle OFF any agent | Update frontmatter; remove symlink. SKILL.md stays in canonical. | No (today's behavior). |
| Project (single, agent A) | Toggle ON agent A | No-op (already enabled). | No. |
| **Project (single, agent A)** | **Toggle ON agent B** | **Migrate to canonical; create symlinks at A and B.** | **Yes** (unless suppressed). |
| **Project (single, agent A)** | **Toggle OFF agent A** | **Migrate to canonical with 0 enabled agents; SKILL.md is preserved under `copilot/skills/`; no symlinks.** | **Yes** (unless suppressed) — the dialog explains the file would otherwise have nowhere to live. |
| Project (mirrored, A+B) | Toggle ON A or B | No-op (already enabled). | No. |
| **Project (mirrored, A+B)** | **Toggle ON agent C** | **Migrate to canonical; delete the duplicate project folders; create symlinks at A, B, C.** | **Yes** (unless suppressed). |
| Project (mirrored, A+B) | Toggle OFF agent A (with B still enabled) | Delete `.A/skills/<name>/`. The skill remains a project row, now single-agent B. | No. Show a brief `Notice` (`Removed foo from Claude project folder; still active in Codex.`). |
| **Project (mirrored, A+B)** | **Toggle OFF the last remaining agent** | **Migrate the surviving copy to canonical with 0 enabled agents; delete the source project folder.** | **Yes** (unless suppressed) — same dialog as the project-single off case, body lists the one surviving copy. |

Migration always lands the SKILL.md in `<vault>/<configured-skills-folder>/<name>/`. Name collisions with an existing canonical skill use today's suffix-on-collision helper (`foo`, `foo-2`, `foo-3`, …) and the resulting name is shown in the confirmation before commit.

## 8. The migration confirmation dialog

Triggered only by the **bold** rows in §7 — expanding a project-managed skill's reach to a new agent, disabling its last enabled agent, or proactively consolidating a mirrored skill via the overflow menu (§10, §12).

Pattern: an Obsidian native `Modal` per `src/agentMode/CLAUDE.md` (Modals and dialogs). Component name: `MigrateSkillConfirmModal` under `src/agentMode/skills/ui/`.

A single dialog covers all variants; the body adapts.

**Project-single source** (skill currently at `.claude/skills/foo/`, user toggles ON Codex):

```
Move "foo" to share with Codex?

This skill currently lives only in your Claude project folder.
To enable it for Codex, Copilot needs to move it to a shared location
so both agents stay in sync.

Copilot will:
  • Move    <vault>/.claude/skills/foo/   →   <vault>/copilot/skills/foo/
  • Create  <vault>/.claude/skills/foo    (shortcut to the new location)
  • Create  <vault>/.codex/skills/foo     (shortcut to the new location)

You can still edit the skill exactly as before — there's just one copy now,
so changes are visible to both agents immediately.

[ ] Don't ask again for future migrations

[ Cancel ]  [ Move and enable Codex ]
```

**Project-mirrored source** (identical copies at `.claude/skills/foo/` and `.codex/skills/foo/`, user toggles ON OpenCode):

```
Consolidate "foo" and share with OpenCode?

The same skill is currently duplicated in two project folders:
  • <vault>/.claude/skills/foo/
  • <vault>/.codex/skills/foo/

To enable it for OpenCode, Copilot will replace these duplicates with
one shared copy.

Copilot will:
  • Move    <vault>/.claude/skills/foo/   →   <vault>/copilot/skills/foo/
  • Delete  <vault>/.codex/skills/foo/    (identical duplicate)
  • Create  <vault>/.claude/skills/foo    (shortcut to the new location)
  • Create  <vault>/.codex/skills/foo     (shortcut to the new location)
  • Create  <vault>/.opencode/skills/foo  (shortcut to the new location)

After this, edits to the skill are visible to all three agents.

[ ] Don't ask again for future migrations

[ Cancel ]  [ Move and enable OpenCode ]
```

**Disable-last-agent source** (skill currently at `.claude/skills/foo/` only, user toggles Claude OFF):

```
Move "foo" to your shared folder before disabling Claude?

This skill currently lives only in:
  • <vault>/.claude/skills/foo/

If you disable Claude, the file has nowhere to live in your Claude
project folder. Copilot can preserve it by moving the skill to your
shared skills folder with no agents enabled — you can toggle agents
back on any time, or delete it later from the Skills tab.

Copilot will:
  • Move    <vault>/.claude/skills/foo/   →   <vault>/copilot/skills/foo/
  • Not create any shortcuts (no agents enabled).

[ ] Don't ask again for future migrations

[ Cancel ]  [ Move and disable Claude ]
```

The same body shape is used when the user toggles OFF the last remaining agent on a project-mirrored skill (the source path list reflects the one surviving copy).

**Proactive-consolidate source** (skill is project-mirrored across two or more agents, user clicked overflow → Migrate; see §12 for the menu lockdown that surfaces this entry point):

```
Consolidate "foo" into your shared folder?

The same skill is currently duplicated in:
  • <vault>/.claude/skills/foo/
  • <vault>/.codex/skills/foo/

Editing, renaming, or deleting one copy would silently diverge from the
other. Copilot can consolidate them into a single shared location, with
a shortcut in each agent folder so both agents still see the skill.

Copilot will:
  • Move    <vault>/.claude/skills/foo/   →   <vault>/copilot/skills/foo/
  • Delete  <vault>/.codex/skills/foo/    (identical duplicate)
  • Create  <vault>/.claude/skills/foo    (shortcut to the new location)
  • Create  <vault>/.codex/skills/foo     (shortcut to the new location)

After this, your edits stay in sync across both agents automatically.

[ ] Don't ask again for future migrations

[ Cancel ]  [ Consolidate ]
```

When the canonical name would collide with an existing canonical skill, a line appears in the body before the action list: `The name "foo" is already taken in your shared folder. The migrated skill will be named "foo-2".` The action list then references the suffixed name. This applies to every variant of the dialog.

The confirm button is the primary action. The cancel button reverts the toggle in the row (the toggle was treated as a request, not a commit). For the proactive-consolidate variant there is no pending toggle to revert — cancel simply closes the dialog.

**Persistence of the checkbox**: a new boolean lives at `agentMode.skills.suppressMigrationConfirm` in data.json (see §11). When true, the dialog is bypassed and the migration runs immediately; a `Notice` toast confirms what happened (`Moved foo to copilot/skills/ and enabled Codex.`) so the user is never blind to the move.

## 9. Reconciliation, EPERM, watchers — unchanged for canonical

The reconciliation pass (`reconcile.ts`), EPERM banner, vault-watcher debounce, and symlink-fanout lifecycle are untouched. They only care about canonical-managed skills; project-managed skills are not part of reconciliation because no agent dir holds a symlink for them — the real directory is the skill.

The vault watcher does need its watched-paths list to keep including `.<agent>/skills/`. It already does (`SkillManager.normalizedAgentDirs`), so the only change is that vault events under those paths now trigger a discovery pass that re-merges, instead of triggering a re-detection-for-import pass.

External edit propagation: if the user edits `.claude/skills/foo/SKILL.md` directly in their editor while `foo` is project-mirrored with `.codex/skills/foo/`, the next discovery pass recomputes hashes, the two copies no longer match, and the row splits in the UI. No code needs to handle this specifically — it falls out of the merge rule.

## 10. Edge cases

**Same name, different content across agents.** Discovery keeps them as separate rows. Each row's display name is suffixed with its source agent in parentheses (e.g., `foo (claude)`, `foo (codex)`) only in the Skills tab list — the on-disk frontmatter `name` is unchanged. Toggling another agent on either row triggers the migration confirm with a suffixed canonical name (`foo` if free, else `foo-2`). The other row is unaffected.

**Same name, one canonical + one project.** The project row is dropped from discovery (canonical wins). On the next reconciliation pass, the agent folder's real directory is treated as orphaned and is removed (reverse-sync). This matches today's behavior for stray real directories under agent folders.

**User deletes a project-managed (single-agent) skill via overflow → Delete.** Same `DeleteConfirmModal`, paths now reference the project folder location.

**User renames a project-single skill.** Rename in place (rename the `.<agent>/skills/<name>/` directory and rewrite the frontmatter `name`). No migration.

**User opens the overflow menu on a project-mirrored skill — lockdown.** The mirrored state is fragile: modifying one copy diverges it from the others, breaking the merge silently. To prevent that, the overflow menu collapses to a single actionable entry when `skill.location.kind === "project"` and `skill.location.agentDirs.length >= 2`:

- The four normal entries — *Edit SKILL.md*, *Edit properties*, *Rename*, *Delete* — render in their muted/disabled state (greyed text, no hover affordance, `aria-disabled="true"`). Clicking them does nothing.
- A single new entry, **Migrate to shared folder**, renders at the top of the menu in its enabled state. Clicking it opens the proactive-consolidate variant of `MigrateSkillConfirmModal` described in §8.
- Hovering anywhere on the menu (or specifically on any muted entry) reveals a tooltip with the verbatim copy:

  > This skill is duplicated in {N} agent folders. Editing one copy would silently diverge from the others. Migrate it to your shared folder first to enable edits.

  ({N} is the live count, e.g. `2 agent folders`.)
- *Reveal in vault* is the one read-only action that stays enabled. It opens whichever copy `Skill.dirPath` resolved to (alphabetically-first agent dir, deterministic).

Once migration completes, the skill is canonical and the overflow menu returns to its normal full state on the next render. No menu state needs to be remembered across renders — the lockdown is a pure function of `Skill.location`.

**User edits a project-mirrored skill's SKILL.md outside Obsidian** (e.g., directly in an external editor or via another agent writing to disk). Vault watcher fires, discovery re-runs, hashes diverge, the row splits in the UI (as described in §9). No special handling needed.

**User toggles the global `suppressMigrationConfirm` back on** (via Settings → Advanced or by deleting it from data.json). The dialog re-appears on the next qualifying toggle.

**Mobile / no `FileSystemAdapter`.** Discovery still walks the canonical folder using Obsidian's adapter. Project folders under `.<agent>/skills/` are not indexed by mobile Obsidian; the agent-dir walk returns empty. This is the same baseline as today's import detection.

## 11. Settings changes

```ts
agentMode: {
  skills: {
    folder: string;                          // unchanged
    suppressMigrationConfirm?: boolean;      // NEW — default undefined/false
    importSkipList?: string[];               // DEPRECATED — to be removed
  };
};
```

Migration of existing `data.json`:

- `importSkipList` is silently dropped on next save. (It was only relevant to the bulk-import flow that no longer exists; nothing references it after this change.)
- No new field defaults are written unless the user explicitly opts in via the checkbox.

## 11b. Spawn-time directive removal — agents write to their own project folder

Today, every backend's spawn-time system prompt is augmented with `buildSkillCreationDirective(agent, skillsFolder, agentSkillsDirs)` (in `src/agentMode/skills/spawnDirective.ts`). The directive steers the agent to write new skills into `<vault>/<configured-skills-folder>/<name>/SKILL.md` and explicitly to **avoid** writing into `.claude/skills/`, `.agents/skills/`, `.opencode/skills/`. It also forces `metadata.copilot-enabled-agents: "<agent>"` on the created file.

With unified discovery, this directive is no longer necessary:

- Agents have their own conventions for where SKILL.md lives (Claude writes to `.claude/skills/`, Codex to `.agents/skills/`, OpenCode to `.opencode/skills/`). These match the agent's own docs and tooling.
- The new discovery picks those up as project-managed skills automatically, with `enabledAgents` inferred from the folder location — no `metadata.copilot-enabled-agents` field needed for the project-managed state.
- If the user later wants to share that skill across agents, the migration confirm runs and stamps the metadata at canonical-creation time.

The directive is removed entirely. The agents create skills at their natural default locations and the Skills tab shows them on the next refresh.

**Files affected:**

- Delete `src/agentMode/skills/spawnDirective.ts` and `src/agentMode/skills/spawnDirective.test.ts`.
- Drop the re-export from `src/agentMode/skills/index.ts`.
- `src/agentMode/backends/claude/descriptor.ts` — drop `buildSkillCreationDirective` import and the system-prompt composition.
- `src/agentMode/backends/codex/CodexBackend.ts` — drop the import and remove the directive from the composed prompt (keep `buildPillSyntaxDirective`).
- `src/agentMode/backends/opencode/OpencodeBackend.ts` — same as Codex.

**Risk surface:** an agent that previously would have been told "write to `copilot/skills/`" will now write to `.claude/skills/` (or its native equivalent). For users with a non-default `agentMode.skills.folder`, the spec-mandated location is no longer steered — but the unified discovery catches it regardless. No data is lost; the worst case is "skill lands in a different folder than before, but the UI shows it the same way."

## 12. UI changes

**`SkillsSettings.tsx`**

- Remove the "Find existing skills" button and the import detection effect on mount.
- Remove the `ImportConsentDialog` mount and all import-phase state.
- Remove the `dismissedRef` session-local sticky flag.
- Keep search, count, EPERM banner, sync-folder banner, and the skill row list.
- Toolbar shrinks to: search input + skill count.

**`SkillRow.tsx`**

- Add a small location indicator next to the skill name when `location.kind === "project"`. Suggested copy: a tiny subdued label like `in .claude/skills` (single) or `mirrored in .claude, .codex` (mirrored), rendered with the existing muted-text token.
- Toggle behavior wraps `handleToggleAgent` with the migration check (described in §7) before calling `SkillManager.toggleAgent`.
- Overflow-menu state is a pure function of `skill.location`:
  - `kind === "canonical"`: render the existing four entries (Edit SKILL.md, Edit properties, Rename, Delete) plus Reveal in vault. Unchanged from today.
  - `kind === "project"` with one agent dir: same as canonical (single-source edits are safe).
  - `kind === "project"` with two or more agent dirs (mirrored): render **Migrate to shared folder** as the only enabled action; the existing four entries render in their disabled-item state with `aria-disabled="true"`; Reveal in vault stays enabled. A Radix tooltip attached to the menu (or to each muted entry, whichever sits better with the existing `dropdown-menu` primitive) shows the lockdown copy from §10.
- The Migrate entry callback opens `MigrateSkillConfirmModal` in proactive-consolidate mode (no pending agent toggle); on confirm it calls `SkillManager.consolidateMirroredSkill(skill, suppressFuture)`.

**`EmptyPlaceholder.tsx`**

- Copy updates: today it implies the user needs to add skills to `copilot/skills/`. New copy mentions that skills under `.claude/skills/`, `.agents/skills/`, or `.opencode/skills/` will show up here automatically too.

**New modal: `MigrateSkillConfirmModal`** (`src/agentMode/skills/ui/MigrateSkillConfirmModal.ts`)

- Obsidian native `Modal` subclass, mirrors the `DeleteConfirmModal` pattern.
- Constructor takes the source `Skill`, the target `BackendId` being enabled, the resolved canonical name (after collision suffixing), the absolute paths involved, and an `onConfirm(suppressFuture: boolean)` callback.
- Renders the title, body, paths list, "Don't ask again" checkbox, and Cancel / Confirm buttons.

## 13. Code changes outline (for the implementing PR)

Modules to add:

- `src/agentMode/skills/discoverProjectSkills.ts` — walks each agent dir, parses SKILL.md, returns `ProjectSkillCandidate[]`.
- `src/agentMode/skills/mergeDiscovery.ts` — combines canonical + per-agent walks into the final `Skill[]`, applying the name/hash merge rule.
- `src/agentMode/skills/dirHash.ts` — recursive content hash for a skill directory (POSIX-stable, sorts entries, includes filename + content). Pure function over an injected FS adapter.
- `src/agentMode/skills/migrateProjectSkill.ts` — orchestrates the migration: pick canonical name (with collision suffix), move the chosen source folder, delete duplicate sources (mirrored case), create symlinks, stamp `metadata.copilot-enabled-agents`. Reuses primitives from today's `bulkMove.ts` and `toggleAgent.ts`.
- `src/agentMode/skills/ui/MigrateSkillConfirmModal.ts` — described in §12.

Modules to modify:

- `src/agentMode/skills/types.ts` — extend `Skill` per §6.
- `src/agentMode/skills/SkillManager.ts`:
  - `runOnce()` calls the new unified discovery instead of `discoverManagedSkills`.
  - `toggleAgent()` inspects `skill.location` and either calls migration first (with confirm) or the existing fanout.
  - Add `consolidateMirroredSkill()` — the proactive-consolidate variant called from the overflow menu's Migrate entry; runs the same `migrateProjectSkill` orchestration but with the existing `enabledAgents` (no agent being toggled on or off).
  - Add `getSuppressMigrationConfirm()` / `setSuppressMigrationConfirm()` for the settings checkbox.
  - Remove `detectImports()`, `runImport()`, `clearImportSkipList()`.
- `src/agentMode/skills/ui/SkillsSettings.tsx` — per §12.
- `src/agentMode/skills/ui/SkillRow.tsx` — per §12.
- `src/agentMode/skills/ui/EmptyPlaceholder.tsx` — per §12.
- `src/settings/model.ts` — add `suppressMigrationConfirm` to the `agentMode.skills` schema; drop `importSkipList`.

Modules to delete:

- `src/agentMode/skills/importDetector.ts` (logic absorbed into `discoverProjectSkills.ts`, but with a different return shape).
- `src/agentMode/skills/bulkMove.ts` (primitives are extracted into `migrateProjectSkill.ts`; the file may be kept and trimmed instead of fully deleted, depending on what stays useful).
- `src/agentMode/skills/ui/ImportConsentDialog.tsx`.
- `src/agentMode/skills/spawnDirective.ts` and `src/agentMode/skills/spawnDirective.test.ts` (see §11b).

Backends affected by directive removal:

- `src/agentMode/backends/claude/descriptor.ts` — drop `buildSkillCreationDirective` import + usage.
- `src/agentMode/backends/codex/CodexBackend.ts` — drop import + usage.
- `src/agentMode/backends/opencode/OpencodeBackend.ts` — drop import + usage.

## 14. Verification

End-to-end manual test cases the implementer must walk through, all in `$COPILOT_TEST_VAULT_PATH` after `npm run test:vault`:

1. **Discovery, canonical only.** Pre-populate a `copilot/skills/foo/SKILL.md`, open the Skills tab. Row appears; no migration UI shows.
2. **Discovery, project-single.** Pre-populate a `.claude/skills/bar/SKILL.md` with no canonical copy. Open the Skills tab. `bar` appears with claude toggled ON, codex/opencode OFF, and a `in .claude/skills` indicator. No rescan button anywhere.
3. **Migration confirm, project-single → multi.** From state #2, toggle Codex on `bar`. Migration dialog appears with the exact body in §8. Confirm. Verify: `copilot/skills/bar/SKILL.md` exists with `metadata.copilot-enabled-agents: claude,codex`; `.claude/skills/bar` and `.codex/skills/bar` are symlinks pointing into canonical.
4. **Project-mirrored merge.** Duplicate `bar/SKILL.md` from `.claude/skills/` into `.agents/skills/` byte-for-byte. Reload. One row, both claude and codex toggled ON, indicator says `mirrored in .claude, .agents`.
5. **Project-mirrored migration.** From state #4, toggle OpenCode on `bar`. Migration dialog with the mirrored body. Confirm. Verify: canonical exists, both former real directories are now symlinks, opencode symlink exists.
6. **Same name, different content.** Put a `baz/SKILL.md` in both `.claude/skills/` and `.codex/skills/` with different bodies. Reload. Two rows appear with the disambiguated labels `baz (claude)` and `baz (codex)`.
7. **Confirm on last-agent off.** From state #2, toggle Claude OFF on `bar`. Migration dialog appears with the disable-last-agent body in §8. Confirm. Verify: `copilot/skills/bar/SKILL.md` exists with `metadata.copilot-enabled-agents:` empty, no agent symlinks, source `.claude/skills/bar/` is gone. Run the same flow on a separate skill and click **Cancel** — verify the toggle reverts and the source is untouched.
8. **Suppress checkbox.** Re-create state #2 with a new skill `qux`. Toggle Codex; in the dialog check "Don't ask again" and confirm. Re-create state #2 with `quux`; toggle OpenCode. Verify: no dialog, migration runs silently, toast confirms.
9. **Suppress persists.** Reload Obsidian (`obsidian reload`). Confirm `data.json` shows `agentMode.skills.suppressMigrationConfirm: true`. Repeat #8 with a fresh skill — still silent.
10. **No `importSkipList` write.** `data.json` should not gain an `importSkipList` field after any of the above flows. Existing values are dropped on first save.
11. **Reconciliation unchanged.** Toggle Claude off then on for a canonical-managed skill; symlink lifecycle matches today.
12. **Agent-authored skills land in the agent's own folder.** Start an Agent-mode chat with Claude (resp. Codex, OpenCode) and ask it to create a new skill. Verify the new SKILL.md lands at `<vault>/.claude/skills/<name>/SKILL.md` (resp. `.agents/`, `.opencode/`), **not** under `copilot/skills/`. Open the Skills tab — the new skill appears as project-managed, toggled ON only for the authoring agent.
13. **Mirrored overflow menu lockdown.** From state #4 (project-mirrored `bar`), open the overflow menu. Verify: Edit SKILL.md, Edit properties, Rename, and Delete are rendered in the muted/disabled state; Migrate to shared folder is the only enabled action other than Reveal in vault. Hover any muted entry — the tooltip shows the lockdown copy from §10. Clicking a muted entry does nothing. Click Migrate; the proactive-consolidate dialog from §8 appears. Confirm; verify canonical exists, duplicates are deleted, both `.claude/skills/bar` and `.agents/skills/bar` are symlinks into canonical, and the overflow menu now shows the full normal set on the next open.

Automated coverage: unit tests for `dirHash.ts`, `mergeDiscovery.ts` (merge rule with every combination of canonical / project / mirrored / collision), and `migrateProjectSkill.ts` (single-source and mirrored-source paths, with collision suffixing).

## 15. Critical files (for the implementer)

Reference paths the design doc points at:

- `src/agentMode/skills/SkillManager.ts`
- `src/agentMode/skills/discoverManagedSkills.ts`
- `src/agentMode/skills/importDetector.ts`
- `src/agentMode/skills/bulkMove.ts`
- `src/agentMode/skills/reconcile.ts`
- `src/agentMode/skills/toggleAgent.ts`
- `src/agentMode/skills/skillFormat.ts`
- `src/agentMode/skills/types.ts`
- `src/agentMode/skills/spawnDirective.ts`
- `src/agentMode/backends/claude/descriptor.ts`
- `src/agentMode/backends/codex/CodexBackend.ts`
- `src/agentMode/backends/opencode/OpencodeBackend.ts`
- `src/agentMode/skills/ui/SkillsSettings.tsx`
- `src/agentMode/skills/ui/SkillRow.tsx`
- `src/agentMode/skills/ui/ImportConsentDialog.tsx`
- `src/agentMode/skills/ui/DeleteConfirmDialog.tsx`
- `src/settings/model.ts`

## 16. Decisions captured

- **Merge criterion is full directory hash, not SKILL.md alone.** Supporting files matter (templates, helpers). Identical SKILL.md with different support files would diverge under the agent's runtime — merging them would hide that. Catching divergence at discovery is cheap and avoids one-way-mirror bugs.
- **Disabling the last enabled agent on a project-managed skill triggers the migration confirm.** The skill's only home is the agent's project folder, so disabling that agent would orphan the file. The dialog explains the preservation move (to canonical with 0 enabled agents) and offers Cancel. The user's intent on disabling is "stop using it in this agent," not "throw away the SKILL.md," so the action preserves the file; the confirm exists because moving the file across the vault is visible enough to deserve an explicit ack. The same global "Don't ask again" flag suppresses this confirm too — once dismissed, the move runs silently and a `Notice` toast confirms what happened.
- **"Don't ask again" is a single global flag.** Per-source-agent or per-pair variants were considered but rejected: the dialog body is the same shape regardless of which agent the source is, and the user's mental model is "I trust Copilot to do migrations" or "I want to be asked each time." More granular suppression complicates the settings surface without adding clarity.
- **The migration dialog is a confirmation, not a wizard.** No source-selection UI; the rows that need migration are already disambiguated by the discovery merge.
- **Project-managed skills are not part of reconciliation.** Reconciliation is about keeping agent symlinks in sync with canonical frontmatter. A project-managed skill has no canonical SKILL.md to disagree with.
- **Project-mirrored skills lock down their overflow menu to a single Migrate action.** Alternative: apply the user's edit/rename/delete to every copy atomically. Rejected because it hides the duplicate-state from the user (the next external edit to one copy still diverges them silently, and there is no UI signal that they were ever in a fragile state). The lockdown teaches the user that the duplicates need to be resolved before edits, and the Migrate entry is one click away. The tooltip explains *why* on hover so the lockdown does not feel arbitrary.
- **The spawn-time skill-creation directive is removed entirely** (see §11b). With unified discovery, an agent writing to its own native skills directory (`.claude/skills/`, `.agents/skills/`, `.opencode/skills/`) is the desired behavior — discovery will pick the new skill up as project-managed. Telling each agent to override its native convention and write into `copilot/skills/` was a workaround for the canonical-only discovery model and serves no purpose under the new model.

## 17. References

- [`SKILLS_MANAGEMENT.md`](./SKILLS_MANAGEMENT.md) — foundation (frontmatter, fanout, reconciliation, EPERM).
- `src/agentMode/CLAUDE.md` — agent-mode layer rules and the "Modals and dialogs" guidance.
