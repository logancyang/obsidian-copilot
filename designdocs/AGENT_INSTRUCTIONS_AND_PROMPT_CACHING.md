# Agent Instructions and Prompt Caching

Why Agent Mode reads user instructions from `AGENTS.md` and nothing else, why the
Chat-mode custom system prompt settings are going away, and why those two changes
are really the same change as making the request prefix cacheable.

Written to be read start to finish by someone who has not touched this code.
The work landed in [PR 2706](https://github.com/logancyang/obsidian-copilot/pull/2706),
against [issue 238](https://github.com/logancyang/obsidian-copilot-preview/issues/238).

## The two problems

### Problem 1: user instructions had three different homes

If a user wanted to tell the agent "always cite your sources", there were three different places that text could have lived, and which one worked depended on how they got there:

1. **A Chat system prompt file**, selected in Settings. Agent Mode copied whichever prompt was currently selected into the prompt it sent to the model.
2. **The Project System Prompt box** in the project editor, which wrote into the project's `project.md` file. Copilot then generated an `AGENTS.md` mirror of that text so the agent could see it.
3. **A hand-written `AGENTS.md` or `CLAUDE.md`** in the vault, which the agent backends found on their own without Copilot's involvement.

Three homes for one idea is already bad. The specific failures were worse:

- The generated `AGENTS.md` mirror was Copilot-owned. If the user edited it, Copilot could overwrite their edits on the next regeneration. So the file the agent read was the one file the user was not safe to touch.
- Only Claude reads `CLAUDE.md`. A user who wrote instructions there and then switched the backend to OpenCode or Codex silently got nothing.
- Nothing kept the Project System Prompt box and the generated mirror in agreement over time. They drifted.
- The selected Chat prompt bled into Agent Mode. Switching prompts for a chat task quietly changed how the agent behaved, and restarted the agent backend as a side effect.

This is the problem a teammate reported from the outside: _"the user can also manually edit that agents.md, will we overwrite their changes? Should the project system prompt be fully in sync with AGENTS.md instead?"_ Both questions dissolve once there is only one file and the user owns it.

### Problem 2: the one region we controlled was the one we kept changing

Every major provider caches the prefix of a request. The cache matches from byte zero forward and stops at the first byte that differs from last time. Everything before that point is billed at a large discount and processed instantly. Everything after it is paid for and processed again, even if it is identical to last time.

Copilot writes exactly one region of an Agent Mode request: the product prompt, the string assigned to the harness's own prompt field. That region sits near the front, which makes it valuable. And it was carrying the selected Chat prompt and the project's instruction text, which means it changed whenever the user switched prompt or project.

So the single region we could have kept permanently cached was instead the one that moved most often.

## Before: what a real request looked like

This is one captured request, OpenCode 1.16.0, session opened at the vault root. Character counts are for the complete serialized sections, not the visible excerpt.

> Update (2026-08-10): the managed OpenCode pin advanced to 1.18.16 after a
> real ACP initialize/session/config-option/prompt smoke test. The measurements
> below remain the historical 1.16.0 capture; they were not relabeled as new
> wire evidence.

```text
  ┌─ Tool definitions ─────────────────────── 49,940 chars ─┐
  ├─ System message (OpenCode joins 4 parts)   47,781 chars ─┤
  │     1. Copilot product prompt ··········    6,162 chars  │
  │     2. OpenCode runtime block ··········      367 chars  │
  │     3. Discovered instruction files ····    3,970 chars  │
  │     4. Skill catalog (63 skills) ·······   37,279 chars  │
  ├─ First user message ─────────────────────     362 chars ─┤
  └─ Conversation history ───────────────────       0 chars ─┘

        provider reported: 51,200 cached tokens · 1,320 fresh tokens
```

### What each part actually is

| Part                            | What it holds                                                                                                                                                                                                                                                      | Who owns it                               | What makes it change                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Tool definitions                | Name, description and JSON Schema for OpenCode's 10 built-in tools, sorted by name. The descriptions are real instruction texts: `task` is 2,305 characters, `todowrite` 2,012, `edit` 1,369, `read` 1,158.                                                        | OpenCode                                  | The pinned OpenCode version changes                                                                   |
| 1. Copilot product prompt       | Whatever string Copilot assigns to `cfg.agent.<id>.prompt`. The Obsidian-assistant identity, the skill steering, the pill-syntax directive.                                                                                                                        | Copilot                                   | We edit the prompt source. Before this change: also whenever the user switched Chat prompt or project |
| 2. OpenCode runtime block       | Live facts OpenCode stamps in itself: model id, working directory, workspace root, git status, platform, and today's date.                                                                                                                                         | OpenCode                                  | Every day at midnight, and on every model, project or vault switch                                    |
| 3. Discovered instruction files | Each instruction file OpenCode found by itself, each one prefixed with the literal line `Instructions from: <absolute path>` followed by the file body. In this capture: the global `~/.claude/CLAUDE.md` (2,132 chars) and the vault's `CLAUDE.md` (1,837 chars). | The user, plus OpenCode's discovery rules | The user edits an instruction file, or switches project                                               |
| 4. Skill catalog                | OpenCode's rendering of all 63 skills it discovered, one name and description block each.                                                                                                                                                                          | OpenCode                                  | A skill is added, removed or enabled                                                                  |

### Where the money leaked

The runtime block is the wall. It sits only 6,162 characters into a 47,781-character system message, and it carries today's date.

When the date rolls over, or the user switches model or project, that block changes. Everything after it is new to the cache: **41,249 characters of instructions and skills get re-processed even though not one character of them changed.**

Copilot cannot move that block. It is OpenCode's, stamped inside OpenCode, and there is no supported way to reposition it. What Copilot owns is part 1, the only region sitting _before_ the wall, and that is exactly where the user's variable text was living.

**Why the cache still reported a hit.** The capture shows 51,200 cached tokens, so prefix caching clearly worked. That is the _same-day, same-project_ case, where the runtime block happens not to have changed. The 41,249 characters after the wall are cached right up until the moment anything in that 367-character block moves, which in practice is daily.

## After: one prompt, two files, clear ownership

```text
COPILOT WRITES                          THE USER OWNS

  Product prompt                          <vault>/AGENTS.md
  Identical bytes in every vault,         vault-wide instructions
  project, model and session.
  Only a product source edit              <project>/AGENTS.md
  changes it.                             per-project instructions

        │                                       │
        │                                       │
        └───────────────┬───────────────────────┘
                        │
              each backend loads both
              through its own native
              instruction discovery
                        │
                        ▼
                  the LLM request
```

Three rules, and they are the whole design:

1. **The product prompt contains no user data.** No selected prompt, no project instructions, no vault path, no date, no model id, no session id. Only product-owned copy and product capability toggles can change it, and when they do, that is a deliberate new prefix.
2. **`AGENTS.md` is the only user-authored instruction source.** `<vault>/AGENTS.md` for vault-wide, `<project>/AGENTS.md` for one project. Both are ordinary markdown files the user owns outright and Copilot never rewrites.
3. **`project.md` keeps context metadata only.** Folders, notes and URLs stay there. The instruction text moves out.

### The same request, after

```text
  ┌─ Tool definitions ───────────────── unchanged, fully cached ─┐
  ├─ System message ─────────────────────────────────────────────┤
  │     1. Copilot product prompt ···· IDENTICAL EVERYWHERE, ALWAYS │
  │     2. OpenCode runtime block ···· still the wall, still theirs │
  │     3. Discovered instruction files                            │
  │           <project>/AGENTS.md   ← the user's, nearest first     │
  │           <vault>/AGENTS.md     ← the user's                    │
  │     4. Skill catalog ············ unchanged                     │
  ├─ First user message ── project context block lives here ────────┤
  └─ Conversation history ──────────────────────────────────────────┘
```

Moving the user's text from part 1 to part 3 **costs nothing on the wire**. Part 3 already sits after the wall, in a region that was being re-processed anyway. What it buys is a part 1 that is byte-identical across every vault, project, model and session, which is the one thing we were previously throwing away.

### What the user experiences

| Before                                                                              | After                                                                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Instructions in a Settings prompt file, a project box, or a generated mirror        | Instructions in `AGENTS.md`, opened in Obsidian like any note                                      |
| Editing the generated `AGENTS.md` risked being overwritten                          | The file is yours. Copilot never rewrites it                                                       |
| Switching the selected Chat prompt changed agent behavior and restarted the backend | Chat prompts have no effect on Agent Mode, and no restart                                          |
| Claude-only instructions in `CLAUDE.md` were invisible to other backends            | A sibling `CLAUDE.md` containing `@AGENTS.md` gives Claude the same text every other backend reads |
| `AGENTS.md` and `CLAUDE.md` showed up in Copilot search results                     | Excluded from retrieval, since the agent already receives them as instructions                     |

### What happens to existing setups

This is where the design deliberately does two different things:

- **Vault level: nothing is copied.** `<vault>/AGENTS.md` starts blank. The selected Chat prompt is a Chat artifact users switch freely, and freezing whichever one happened to be selected at upgrade time into a permanent vault-wide file would be a surprise, not a migration. Instead, both the Basic and Advanced settings tabs show a notice, only to users who actually saved prompts, naming the folder those files are still in.
- **Project level: the text is moved.** Instructions typed into the old Project System Prompt box were never visible to the user as a file, so leaving them stranded would look like data loss. On the next session start, that text is written into the project's `AGENTS.md` and the field in `project.md` is cleared.

The move is guarded so it runs at most once and cannot lose text. It requires prompt text to move **and** no existing `AGENTS.md` to overwrite, it writes the new file **before** clearing the old field, and if the write fails, `project.md` is left exactly as it was.

## Deprecating the Chat custom system prompt settings

The Advanced settings tab loses two controls:

- **Default System Prompt** (the global picker). It set a Chat-mode default that Agent Mode no longer reads.
- **System Prompts Folder Name.** Already dead: the folder now derives from the single configurable Copilot root.

Nothing is deleted from disk. Prompt files stay where they are. The per-chat prompt picker inside the chat settings popover is untouched, which is the control v3 Chat users actually use.

In their place, one notice, shown on both tabs and only when the user has saved prompts, pointing at the folder that still holds them.

**Why v3 Chat is not unified here.** v3 Chat's projects mode is gone, and Pi replaces that whole surface under the v4 agent architecture. Teaching v3 Chat to read `AGENTS.md` would be work on a surface that no longer has projects at all.

## How instructions actually reach each backend

The important discovery of this design work: **we do not need to configure anything for both files to arrive.** Each harness finds them.

### OpenCode (pinned 1.16.0)

Read from the pinned source, `packages/opencode/src/session/instruction.ts`, not from the documentation:

- It searches the filenames `AGENTS.md`, then `CLAUDE.md`, then the deprecated `CONTEXT.md`.
- For the first of those filenames that matches anywhere, `findUp` walks upward from the session working directory and collects **every** match on the way, nearest first. So a project session picks up `<project>/AGENTS.md` **and** `<vault>/AGENTS.md`.
- As soon as `AGENTS.md` matches, it stops. `CLAUDE.md` is never consulted at the project level.
- Each file is inserted as `Instructions from: <absolute path>` followed by the body.

Two useful consequences fall out of this:

1. The sibling `CLAUDE.md` Copilot writes for Claude (containing just `@AGENTS.md`) is **invisible to OpenCode**, because `AGENTS.md` already matched. No duplicate instructions, no stray `@AGENTS.md` line reaching the model.
2. Both scopes already load, so no configuration is needed to get them there.

### Codex and Claude

Codex discovers `AGENTS.md` natively from the working directory. Claude reads `CLAUDE.md`; the sibling file containing the single line `@AGENTS.md` makes Claude resolve the same text every other backend reads, without a second copy that can drift.

### The ordering problem, and how it is solved

OpenCode returns the files nearest first, which means the **project** file arrives **before** the vault file. That is the reverse of the intended broad-to-specific order, and Codex and Claude each have their own order that we also do not control.

The obvious fix does not work. OpenCode's config has a documented `instructions` array, and it looks like the right seam, but reading the source shows those paths are merged into the same `Set` that discovery already filled. A path discovery already found keeps its discovered position. The array cannot reorder anything, and adding it would be dead configuration.

So precedence is stated in prompt text instead, in the product prompt, where it holds for every backend at once and costs a few dozen bytes that are identical everywhere:

> The user's own instructions reach you as AGENTS.md files, in whatever order this runtime loads them. Judge them by scope, not by the order they appear in: an AGENTS.md inside the current project folder is more specific than the one at the vault root, so follow the project file wherever the two conflict.

## Walkthrough: what happens when a session starts

Concretely, for a user who opens Agent Mode inside a project called `Research`:

1. **Copilot resolves the scope.** Project scope, so the working directory will be `<vault>/copilot/projects/Research`.
2. **Copilot checks whether the project has legacy instruction text.** It reads the live `project.md` record. If its prompt field has text and the folder has no `AGENTS.md` yet, it writes that text to `<vault>/copilot/projects/Research/AGENTS.md` and then clears the field. If either condition fails, nothing happens: no file is created out of nothing, and a file the user already wrote is never touched.
3. **Copilot makes sure Claude can see the same thing.** If a sibling `CLAUDE.md` is missing, it writes one containing the single line `@AGENTS.md`. If one exists and already imports `AGENTS.md`, it is left alone. If it exists without the import, the line is appended once.
4. **Copilot builds the product prompt.** No arguments. Same bytes as every other session anywhere.
5. **The backend spawns** with that prompt on its documented prompt field, and the working directory set to the project folder.
6. **The backend finds the instruction files itself.** OpenCode walks up from the working directory and picks up `Research/AGENTS.md` and then `<vault>/AGENTS.md`. Codex does its own discovery. Claude reads the `CLAUDE.md` files and resolves the `@AGENTS.md` imports.
7. **Project context goes in the first user message**, not the system prompt, so the folders, notes and URLs a project points at never enter the cached prefix.

Every step above is idempotent. Starting a second session changes no file and triggers no backend restart.

## Questions this design answers

**"If a user hand-edits `AGENTS.md`, do we overwrite their changes?"**
No. Copilot writes an `AGENTS.md` only when the file is absent. There is no regeneration step and no marker-driven rewrite, because there is nothing left to regenerate from. The one legacy conversion (an old Copilot-generated mirror, recognizable by its marker comment) happens once and turns the file back into plain user-owned content.

**"Should the Project System Prompt box stay in sync with `AGENTS.md`?"**
The box is gone from Agent Mode, so there is nothing to sync. Two-way sync between a settings field and a file the user edits freely is a conflict-resolution problem with no good answer. One file, owned by the user, has no such problem.

**"Do we need to copy a `CLAUDE.md` every time we create an `AGENTS.md`?"**
We create one, but it is an import rather than a copy: a single `@AGENTS.md` line. A copy would be a second body of text that drifts the moment either side is edited. The import cannot drift. And because OpenCode stops at `AGENTS.md`, that file is invisible to every backend except Claude, which is the only one that needs it.

**"Does this actually save money?"**
It removes the reason the front of the request changed. It does not fix the harness-owned runtime block that still ends the reusable prefix daily. The honest framing: this makes the region Copilot controls permanently reusable, and leaves the larger harness-owned opportunity on the table until a documented public API exists for it.

## Making Claude's prefix stable too

The Claude Agent SDK builds its own system prompt from the `claude_code` preset, and that preset stamps in working directory, git status, and memory paths. Same problem as OpenCode's runtime block, except here there is a documented public option for it:

```ts
options.systemPrompt = {
  type: "preset",
  preset: "claude_code",
  excludeDynamicSections: true,
  append: copilotProductPrompt,
};
```

`excludeDynamicSections` strips those volatile sections out of the system prompt and re-injects them as the first user message. The model still has the facts, they simply stop sitting inside the cached prefix. It is sent unconditionally, because it concerns the preset rather than Copilot's append.

Tradeoff, stated plainly: working directory and git status become slightly less authoritative for steering the model, because they arrive in a user message instead of the system prompt, and the first user message grows a little.

## The decisions, and what was rejected

| Decision                                           | Why                                                                                          | What was rejected                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Precedence stated in the product prompt            | One line, byte-stable, holds on every backend                                                | OpenCode's `instructions` config array: the paths dedupe into the discovery `Set`, so it changes nothing |
| Vault `AGENTS.md` starts blank                     | The selected Chat prompt is a moving target; freezing it is a surprise, not a migration      | Seeding from `getEffectiveUserPrompt()` on first session start                                           |
| Project prompt text is moved and the field cleared | That text was never visible as a file, so stranding it reads as data loss                    | Copying without clearing, which leaves two sources of truth again                                        |
| `excludeDynamicSections` on the Claude preset      | Documented SDK seam for exactly this problem, one option                                     | Leaving Claude's prefix churning on cwd and date                                                         |
| v3 Chat left alone                                 | Its projects mode is gone and Pi replaces it                                                 | Building a v3 fallback that reads `AGENTS.md`                                                            |
| Advanced prompt controls removed                   | The global picker fed a behavior Agent Mode no longer reads; the folder box was already dead | Keeping them with clearer labels                                                                         |

### One decision that reversed during implementation

The plan called for removing a concurrency fix (`lastErrorSeq`) from this branch as unrelated scope. Implementation showed it is not unrelated.

This change adds an `await` before the backend spawns, to make sure instruction files are in place first. That extra await reorders the microtask chains of two concurrent session creations, so a session that succeeds can wipe an error banner a sibling session had just set. `lastErrorSeq` is a counter bumped on every recorded failure; a create snapshots it before its first await and only clears the banner if the count did not move.

Removing it fails a test that predates this whole branch. It is this change's own regression fix, and it stays.

## What was deliberately not done

Each of these would couple Copilot to OpenCode internals or provider-specific wire behavior, so they stay out:

1. **No reordering or splitting of OpenCode's joined system message.** The runtime block stays where it is.
2. **No cutting the tool array**, despite it being the single largest region at 49,940 characters. It is the best-behaved region we have: byte-identical on every request at a pinned version, sorted upstream, fully cached. The only lever is OpenCode's per-agent `tools: {write: false}` map, which its own documentation marks **deprecated**, and which is keyed by version-specific tool names. A rename on upgrade would silently re-enable what we disabled. That trades a cached-token saving for an upgrade-fragility bug.
3. **No suppression of the legacy `~/.claude/CLAUDE.md` global fallback.** Upstream-owned, observable, out of scope.
4. **No provider cache breakpoints, `cache_control` objects, or routing keys.** These vary by OpenCode version, SDK and provider.
5. **No OpenCode pin change in this analysis.** The later 1.18.16 bump was gated by a real ACP initialize/session/config-option/prompt smoke test; recapturing provider request bytes remains follow-up work.
6. **No Pi cache assessment.** The payload observer and normalized section capture belong to the Pi integration work.

## How the contract is enforced

The tests stop exactly at the boundary Copilot controls. We can guarantee the bytes we hand each harness. We cannot promise that an upstream harness keeps its own base prompt, tools or runtime envelope stable.

| Harness    | The seam Copilot controls                                                                     | What the test guarantees                                                               |
| ---------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| OpenCode   | `cfg.agent.build.prompt` and `cfg.agent.copilot-build.prompt`                                 | Both receive the exact same product prompt bytes                                       |
| Codex      | `CODEX_CONFIG.developer_instructions` and the legacy `-c developer_instructions=...` argument | Both paths encode the exact same bytes                                                 |
| Claude SDK | `systemPrompt.append` on the `claude_code` preset                                             | The append is the exact product prompt, and the preset is pinned to its cacheable form |

Every assertion uses byte equality, not containment. A containment check passes while stray bytes push everything after them out of the cached prefix, which is precisely the failure the contract exists to prevent.

Each seam also varies something a session carries but the prompt must never see, and asserts the bytes do not move:

| Mutation                                                             | May the product prompt change?          |
| -------------------------------------------------------------------- | --------------------------------------- |
| Product prompt source, or a product capability toggle                | Yes. This is a deliberate new prefix    |
| Selected Chat prompt                                                 | No                                      |
| Vault path, project path, working directory, date, model, session id | No                                      |
| Vault or project `AGENTS.md` edited                                  | No. Only the instruction region changes |
| User request or conversation history                                 | No                                      |

## What shipped

Six commits on [PR 2706](https://github.com/logancyang/obsidian-copilot/pull/2706), on top of a merge that brought the branch current with `v4-preview`:

| Commit     | What it does                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `fb603183` | Merge latest `v4-preview`. The generated mirror stays deleted; the retired prompts-folder control takes upstream's removal |
| `649ef193` | Add the precedence rule to the product prompt, and lock the cache contract with byte-equality tests                        |
| `b2cf0efb` | Move project prompt text into `<project>/AGENTS.md`; the vault file stops seeding from the Chat prompt                     |
| `a9916322` | Agent instructions row moves to Basic; Advanced's prompt controls retire behind one conditional notice                     |
| `f6a52c92` | Send `excludeDynamicSections: true` on the Claude preset                                                                   |
| `8fc020dd` | Exact-byte assertions at both OpenCode agent prompts and both Codex instruction paths                                      |

Net effect on the diff: 53 files, +1,485 / -1,773. The change removes more than it adds, because the generated-mirror machinery, the duplicate backend injection paths, and the prompt-editor UI all go away and are replaced by one small instruction-file module.

Test status at time of writing: 5,303 passing. Two failures in `dev/gallery/gen-gallery-stories.test.ts`, which fail identically on `v4-preview` (the generator imports `glob` from `node:fs/promises`, which Node 20.18.1 does not export). Pre-existing and unrelated.

## Open follow-ups

1. **A version-pinned wire smoke test.** Capture one real provider request against the pinned OpenCode binary, confirm the product prompt bytes arrive exactly once, and confirm no user or project text leaked into that block. This should gate any future pin bump.
2. **Pi normalized payload capture.** Once Pi lands, map its provider payload into the same section vocabulary so cache behavior can be compared across harnesses rather than asserted per harness.
3. **Measurement rather than assertion.** Record OpenAI `cached_tokens` / `cache_write_tokens` and Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens` across the acceptance scenarios. These stay measurements, not pass/fail gates, because most of the remaining prefix is harness-owned.

## References

- [PR 2706](https://github.com/logancyang/obsidian-copilot/pull/2706)
- [Issue 238](https://github.com/logancyang/obsidian-copilot-preview/issues/238)
- [OpenCode rules and AGENTS.md contract](https://opencode.ai/docs/rules/)
- [OpenCode 1.16.0 instruction discovery source](https://github.com/anomalyco/opencode/blob/6cb74317a6efacd656483cb0489d8e7e3701c12e/packages/opencode/src/session/instruction.ts)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
