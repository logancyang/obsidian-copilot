# Playbook: migrate `AGENT_MODE_TODOS.md` to GitHub issues

This playbook tells an orchestrator agent how to convert every pending
top-level item in `designdocs/todo/AGENT_MODE_TODOS.md` into a GitHub issue
in `logancyang/obsidian-copilot-preview`, replacing each migrated TODO line
with a link to its issue.

The orchestrator does **not** write issues itself. It triages, then spawns a
pair of subagents per chunk — an *author* that drafts, and a *reviewer* that
re-verifies, revises, and pushes. The orchestrator owns the source-file
write to avoid races.

## Goal

For every pending top-level `- [ ]` item in `AGENT_MODE_TODOS.md`:

1. Open a GitHub issue in `logancyang/obsidian-copilot-preview` using the
   `/create-agent-issue` skill standard.
2. Replace the TODO line with a markdown link to the new issue (checkbox
   stays unchecked).

As of 2026-05-28 the file has **33 pending top-level items**:
P0 = 7, P1 = 17, P2 = 7, P3 = 2.

## Prerequisites

- `gh` CLI authenticated with WRITE access on
  `logancyang/obsidian-copilot-preview`. Verify with
  `gh repo view logancyang/obsidian-copilot-preview --json viewerPermission`.
- `.claude/skills/create-agent-issue/SKILL.md` present (this is the
  single-issue standard the subagents follow).
- `.context/issues/` directory exists. The orchestrator creates it on first
  run: `mkdir -p .context/issues`.

There is **no human approval gate** in this playbook. The orchestrator
proceeds autonomously once invoked.

## Why two subagents per chunk

The user does not review issues by hand. To maintain quality without a human
gate, every chunk goes through two passes:

- **Author subagent** investigates the relevant `src/` surface and writes a
  draft to `.context/issues/<chunk-id>.md` (`stage=draft`). Does not touch
  GitHub.
- **Reviewer subagent** loads the draft, **independently** re-investigates
  the same surface (does not trust the author's `investigated:` frontmatter
  blindly — uses it as a starting point and verifies), applies the rubric
  defined in the skill, revises the draft in place (up to 2 passes), and
  only then pushes via `gh` (`stage=review-and-push`).

Each subagent runs in its own context, so each has a full token budget for
code reading. Doing 33 chunks in a single context blurs detail and produces
lookalike issues.

## Step 1 — Triage (orchestrator decides autonomously)

Walk every pending top-level `- [ ]` in `AGENT_MODE_TODOS.md`. For each, build
a chunk record.

**Sub-bullet rules:**

- **Non-checkbox** sub-bullets (plain `-`) are always elaboration of the
  parent. Fold them into the parent issue's `## Context` or
  `## Proposed behavior`. Never split.
- **Checkbox** sub-bullets (`- [ ]`) are decided per case:
  - **Fold** when sub-items are refinements of one behavior. Example:
    "support compaction" → manual trigger + auto-compact toggles fit in one
    issue with a `- [ ]` checklist in `## Proposed behavior`.
  - **Split** when each sub-item is independently shippable with its own
    surface and success criteria. Example: "Integrate copilot plus tool
    calls" → the 5 children (vault search, web search, deprecate
    edit/composer, YouTube transcription, Obsidian CLI) each get their own
    issue.

**Record the triage** in `.context/issue-migration-plan.md` as a table:

```md
| chunk-id | parent line | priority | folded sub-lines | split-out sub-lines | source-line-range |
|----------|-------------|----------|------------------|---------------------|-------------------|
| windows-test | 7 | P0 | 8 | — | 7-8 |
| ...
```

- `chunk-id` is a short kebab-case slug (e.g. `windows-test`, `mcp-oauth`,
  `compaction`). It is used to name the draft file at
  `.context/issues/<chunk-id>.md`.
- `source-line-range` is the exact 1-based range in `AGENT_MODE_TODOS.md`
  whose lines should be replaced by a link to the new issue. For folded
  cases this includes the sub-lines; for split cases each split chunk gets
  its own one-line range.

The triage runs once at the start. No user approval gate — the orchestrator
proceeds.

## Step 2 — Per-chunk flow

For each chunk record:

### 2.1 Spawn the author

Use the `Agent` tool with `subagent_type: "general-purpose"` and the
**author prompt template** (see Step 4 below). The author:

1. Loads `.claude/skills/create-agent-issue/SKILL.md`.
2. Runs the investigation step.
3. Runs `stage=draft`, writing the draft to
   `.context/issues/<chunk-id>.md`.
4. Returns the draft file path in its summary.

### 2.2 Spawn the reviewer

Once the author returns, use `Agent` with `subagent_type: "general-purpose"`
and the **reviewer prompt template** (see Step 4 below). The reviewer:

1. Loads the skill.
2. Loads the draft at `.context/issues/<chunk-id>.md`.
3. Independently re-investigates the same surface (does not blindly trust
   the author's `investigated:` list).
4. Applies the rubric. Revises the draft in place up to 2 times.
5. On rubric pass: runs `stage=review-and-push` with
   `source-edit=return-only`, pushing the issue via `gh` and returning the
   issue URL plus the proposed replacement line.
6. On rubric abort: returns the specific rubric failures.

### 2.3 Orchestrator writes the source file

On reviewer success, the orchestrator (not the subagent) edits
`designdocs/todo/AGENT_MODE_TODOS.md` to replace the chunk's
`source-line-range` with the replacement line returned by the reviewer.

This centralized write is what makes parallelism safe — multiple subagents
can run concurrently because none of them touch the source file. The
orchestrator serializes its own writes.

### 2.4 On abort — one re-spawn

If the reviewer aborts, re-spawn a fresh author for that chunk with the
reviewer's feedback embedded in the prompt. **Max 1 re-spawn per chunk.** If
the re-spawn also aborts, append the chunk-id and reviewer feedback to
`.context/failed-chunks.md` and move on. Do not block other chunks on a
single failure.

## Step 3 — Parallelism

Run **up to 3 chunks in parallel** as independent author → reviewer
pipelines. Each pipeline is internally serial (the reviewer needs the
author's draft). The orchestrator's writes to `AGENT_MODE_TODOS.md` are
already serialized (Step 2.3), so parallel chunks do not race on the source
file.

Three is the recommended starting concurrency. Adjust downward if you
observe rate-limit pressure from `gh` or token-budget issues.

## Step 4 — Subagent prompt templates

Copy-paste these into the `Agent` tool's `prompt` field. Replace
`{placeholders}` with the chunk's actual values.

### Author prompt template

```
You are processing one TODO item from designdocs/todo/AGENT_MODE_TODOS.md and
producing a draft GitHub issue.

Chunk ID: {chunk_id}
Priority: {priority}
Source file: designdocs/todo/AGENT_MODE_TODOS.md
Source line range: {source_line_range}

TODO text (verbatim from the source file):
---
{parent_todo_text}
{folded_sub_lines}
---

Your steps:

1. Read `.claude/skills/create-agent-issue/SKILL.md` and follow its standard.
2. Run a real investigation pass against `src/`. Grep for keywords from the
   TODO text. Read at least one file from the relevant surface end-to-end so
   the issue's Context section can cite real code. Read any design doc the
   TODO references (look under `designdocs/todo/`).
3. Run the skill's `stage=draft` workflow. Write the draft to
   `.context/issues/{chunk_id}.md` following the exact frontmatter format in
   the skill. The `investigated:` frontmatter field must list every file you
   actually read during this investigation.
4. Do NOT run `gh issue create`. Do NOT edit the source TODO file.

Return:

- The full path to the draft file you wrote.
- A one-paragraph summary of what you found during investigation, including
  any open questions you surfaced.

If you cannot locate the relevant surface in `src/`, set `investigated: []`
in the draft frontmatter and call this out explicitly in the draft's Open
questions section. Do not invent file paths.
```

### Reviewer prompt template

```
You are reviewing a draft GitHub issue produced by another subagent. You may
revise it in place. You will be the one who pushes it to GitHub once you are
satisfied.

Chunk ID: {chunk_id}
Draft path: .context/issues/{chunk_id}.md
Source file: designdocs/todo/AGENT_MODE_TODOS.md
Source line range: {source_line_range}

Your steps:

1. Read `.claude/skills/create-agent-issue/SKILL.md` to load the standard
   and the reviewer rubric.
2. Read the draft at the path above.
3. Re-investigate INDEPENDENTLY. Do not trust the draft's `investigated:`
   frontmatter blindly. Pick at least one symbol or file path the draft
   cites in its Context section, grep for it, and confirm it exists and
   behaves as the draft claims. If the draft cites no concrete paths, that
   itself is a rubric failure.
4. Apply the rubric in the skill. For each failing item, edit the draft in
   place to fix it.
5. Hard cap: 2 revision passes. After the second revision, re-apply the
   rubric. If any item still fails, do NOT push — abort and return the
   specific rubric failures.
6. If the rubric passes, run the skill's `stage=review-and-push` workflow
   with `source-edit=return-only`. This will:
   - Ensure all required labels exist (create via `gh label create` if not).
   - Push the issue via `gh issue create`.
   - Compute (but not apply) the proposed replacement line for the source
     file.

Return (on push success):

- The GitHub issue URL and number.
- The proposed replacement line for `AGENT_MODE_TODOS.md` lines
  {source_line_range}. The orchestrator will apply the edit, not you.
- The number of revision passes you made.

Return (on rubric abort):

- The rubric items that failed, with specific examples from the draft.
- Any concrete suggestions for the next author run.
```

## Step 5 — Idempotency / resume

Before processing a chunk, the orchestrator checks two things:

- **Source line.** If `AGENT_MODE_TODOS.md` line(s) in the chunk's
  `source-line-range` already contain `https://github.com/.../issues/`, the
  chunk is already done — skip it.
- **Existing draft.** If `.context/issues/<chunk-id>.md` already exists,
  skip the author phase and feed the existing draft directly to a reviewer.
  Useful for resuming a partial run after an interruption.

## Step 6 — Final verification

Once all chunks are processed:

1. Confirm GitHub state:
   ```
   gh issue list --repo logancyang/obsidian-copilot-preview \
     --label agent-mode --state open --limit 100 | wc -l
   ```
   should be ≥ the number of chunks processed successfully (some chunks may
   have aborted and been logged to `.context/failed-chunks.md`).
2. Confirm source-file state:
   ```
   git diff designdocs/todo/AGENT_MODE_TODOS.md
   ```
   Every pending top-level `- [ ]` line should now contain a
   `github.com/.../issues/` link, except chunks listed in
   `.context/failed-chunks.md`.
3. Print a summary table to the user:
   ```
   | chunk-id | issue # | url | revision passes |
   ```
   Plus a list of any failed chunks with their abort reasons.

## Out of scope

- Closing GitHub issues. (Issues are created open and stay open until
  resolved in the repo's normal flow.)
- Syncing TODO checkboxes back to checked state when the GitHub issue
  closes. (Separate future sweep.)
- Migrating other TODO files in `designdocs/todo/` (`TECHDEBT.md`,
  `TODO-composer-tool-redesign.md`, `TOKEN_BUDGET_ENFORCEMENT.md`,
  `UI_RENDERING_PERFORMANCE.md`). This playbook targets only
  `AGENT_MODE_TODOS.md`.
- Creating pull requests, assigning users, or setting milestones.
- Any human-in-the-loop gate. The orchestrator runs end-to-end.
