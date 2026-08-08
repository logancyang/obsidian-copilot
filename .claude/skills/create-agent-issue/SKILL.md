---
name: create-agent-issue
description: |
  Create a single high-quality GitHub issue in
  logancyang/obsidian-copilot-preview from a TODO item, design-doc punch list
  entry, or ad-hoc feature/bug request. Each invocation is exactly one issue
  end-to-end: investigate the surface in src/, draft against the standard,
  ensure labels exist, push via gh, and (if a source file + line were given)
  edit that line to point at the new issue. Use when asked to "file an issue
  for X", "open a ticket", or "convert this TODO to an issue".
allowed-tools:
  - Bash
  - Read
  - Edit
  - Grep
  - Glob
---

# `/create-agent-issue` — produce one high-quality GitHub issue

This skill creates **one** GitHub issue at a time in
`logancyang/obsidian-copilot-preview`. It is designed to be invoked either by
a human (one-shot, end-to-end) or by two cooperating subagents (one drafts,
one reviews and pushes).

The skill is deliberately scoped to a single issue. It does not loop, batch,
or reason about other items.

## Inputs

The caller passes (free-form for ad-hoc use, structured for subagent use):

- **TODO text** — the line(s) describing the work.
- **Priority** — `P0` / `P1` / `P2` / `P3`.
- **Folded sub-items** _(optional)_ — secondary bullets that should appear as a
  checklist in the issue body.
- **Source file + line range** _(optional)_ — file path and 1-based line range
  whose lines should be replaced with a link to the new issue after the push.
- **`chunk-id`** _(optional)_ — string used to name the draft artifact file.
  Required when `stage=draft` or when running under a reviewer flow.
- **`stage`** — one of:
  - `stage=draft` — investigate + write draft to
    `.context/issues/<chunk-id>.md`. No GitHub call. No source-file edit.
  - `stage=review-and-push` — load the draft, independently verify, revise if
    needed, push via `gh`, edit the source file (or return the replacement
    line).
  - `stage=all` _(default for ad-hoc use)_ — do both back-to-back in the same
    context. Used when no reviewer step is required.
- **`source-edit`** _(optional, only with `review-and-push` / `all`)_ —
  `apply` (default; skill edits the file) or `return-only` (skill reports the
  proposed replacement line and does not touch the file).

## Investigation (mandatory for `stage=draft` and `stage=all`; the reviewer in `stage=review-and-push` repeats it independently)

Before drafting:

1. **Locate the relevant surface in `src/`.** Grep for keywords from the TODO.
   Common entry points for Agent Mode work:
   - `src/LLMProviders/`
   - `src/agentMode/` (if present)
   - `src/components/Chat/`
   - `src/tools/`
   - `src/mcp/`
   - `src/skills/`
2. **Read any design doc referenced by the TODO line.** Examples currently
   present in `designdocs/todo/`:
   - `MCP_EXTERNALLY_MANAGED_SERVERS.md`
   - `AGENT_PLANNING_REFLECTION_V0.md`
   - `AGENT_REASONING_BLOCK.md`
   - `ACP_DESIGN.md`

   If the TODO references a doc that does not exist
   (e.g. `designdocs/SKILLS_DISCOVERY_REDESIGN.md` is referenced today but
   not yet written), flag this in the issue's Open questions section and
   proceed with the TODO text alone.

3. **Note the current behavior in one or two sentences.** This anchors the
   `## Context` section. The sentence must reference at least one real file
   path or symbol the investigator just read.
4. **Identify the observable changes the user would see when resolved.** This
   anchors `## Proposed behavior` and `## Success criteria`.
5. **Look for "design needed" markers** in the TODO sub-bullets. When
   present, the issue body should call this out in `## Open questions /
Risks` and `## Proposed behavior` should remain intentionally open-ended
   ("design a UI that …" rather than prescribing pixels).

## Title standard

Imperative sentence. No trailing period. ≤80 characters. No area prefix.

Good examples:

- "Validate Agent Mode end-to-end on Windows"
- "Upgrade pinned opencode binary to latest version"
- "Pass Copilot system prompt to opencode, Claude Code, and Codex"
- "Verify agents cannot edit files outside the user vault (sandbox mode)"
- "Render AskUserQuestion prompts inline in chat"

Bad examples:

- "Agent mode: validate end-to-end behavior on Windows" (area prefix)
- "Make the chat better." (vague, trailing period)
- "I think we should probably do something about Windows" (not imperative)

## Body template

Exact section order. Markdown. No other top-level sections.

```markdown
## Context

<1–3 sentences anchored in the current code/behavior the investigator just
verified. Name the user pain or the gap. Link to a design doc in
`designdocs/todo/` if one is directly relevant. Do not link back to any
source TODO file.>

## Proposed behavior

<Bullet list of observable end-user behaviors after this issue is resolved.
Not implementation details. If sub-tasks were folded in, include them as a
checklist:>

- [ ] Sub-behavior 1
- [ ] Sub-behavior 2

## Success criteria

<Bulleted, verifiable list. Each item must be testable by a reviewer without
re-asking the author. Mix automated and manual where appropriate. At least
one bullet must reference a real test or command.>

- Behavior X is visible in the chat card before approval.
- `npm run test` passes including new unit tests for <module>.
- Manual: run `npm run test:vault`, exercise <flow>, observe <outcome>.

## Open questions / Risks

<Bullets. OK to be short. "None known." is acceptable when truly N/A.
If the source TODO is marked "design needed", lead this section with
`Design needed:` and list the specific design questions surfaced during
investigation.>
```

## Labels

Apply:

- **`agent-mode`** — always for Agent Mode work.
- **One priority label** — exactly one of `P0` / `P1` / `P2` / `P3`,
  matching the TODO prefix.
- **Type label** — `enhancement` or `bug` when obvious; skip otherwise.

Before applying, run
`gh label list --repo logancyang/obsidian-copilot-preview` and create any
missing label via `gh label create --repo logancyang/obsidian-copilot-preview
<name> --color <hex>`. Palette:

| Label        | Color     |
| ------------ | --------- |
| `agent-mode` | `#5319e7` |
| `P0`         | `#b60205` |
| `P1`         | `#d93f0b` |
| `P2`         | `#fbca04` |
| `P3`         | `#0e8a16` |

`enhancement` and `bug` already exist in the repo with their default colors.

## Draft artifact format (`stage=draft` output)

Write to `.context/issues/<chunk-id>.md` with this exact shape so the reviewer
can parse deterministically:

```md
---
chunk-id: <id>
title: <issue title>
labels: [agent-mode, P1, enhancement]
priority: P1
source-file: <path or null>
source-lines: <start-end or null>
investigated:
  - src/agentMode/binaryDetection.ts
  - src/LLMProviders/opencode/launch.ts
---

## Context

...

## Proposed behavior

...

## Success criteria

...

## Open questions / Risks

...
```

The `investigated` field lists every file the author actually read. The
reviewer uses this to spot-check: re-grep, re-read at least one cited file,
and confirm the Context section's claims hold.

If the author could not locate the relevant surface in `src/`, set
`investigated: []` and explain in the issue's Open questions section that
the surface was not identified during investigation.

## Reviewer rubric (`stage=review-and-push`)

Before pushing, the reviewer applies this checklist to the draft. Each line
must pass; if any fail, the reviewer revises the draft in place and re-checks.

**Hard cap: 2 revision passes.** If still failing after the second revision,
abort and report the specific failures so the caller can re-spawn a fresh
author with the reviewer's feedback.

- **Title**: imperative, ≤80 chars, no trailing period, no area prefix.
- **Context**: anchored in real code or real current behavior. The reviewer
  **must** re-grep at least one symbol or path from the `investigated:` list
  and confirm it exists and behaves as the Context section claims. Generic
  prose ("the current implementation doesn't handle X well") without a file
  reference fails.
- **Proposed behavior**: observable end-user behaviors, not implementation
  details. Multi-part proposals use `- [ ]` checklists.
- **Success criteria**: every bullet is verifiable by a reviewer without
  re-asking the author. At least one bullet references a real test or
  command (e.g. `npm run test`, `npm run test:vault`, a specific manual
  flow). "Works correctly" is not a success criterion.
- **Open questions / Risks**: present and non-empty unless truly N/A. If the
  source TODO is marked "design needed", this section leads with
  `Design needed:` and enumerates the specific open design questions.
- **Labels**: includes `agent-mode` + exactly one priority label
  (`P0`/`P1`/`P2`/`P3`) + optional `enhancement` or `bug`.
- **No leakage**: body contains no references to any source TODO file, no
  scaffolding chatter ("as requested by user"), no internal coordination
  comments.

## Push step (reviewer-owned in `stage=review-and-push` and `stage=all`)

After all rubric items pass:

1. Run `gh label list --repo logancyang/obsidian-copilot-preview` and create
   any missing labels from the palette above.
2. Write the issue body to a temporary file (e.g.
   `/tmp/create-agent-issue-<chunk-id>.md`) — passing a body file is more
   robust than `--body` for multi-line markdown.
3. `gh issue create --repo logancyang/obsidian-copilot-preview --title "<title>"
--label "<comma-separated labels>" --body-file <tmpfile>`. Capture the
   returned URL.
4. Parse the issue number from the URL.

## Source-file backfill (reviewer-owned, only in `stage=review-and-push` and `stage=all`, only when invoked with a source file + line range)

Replace the given source line(s) with a link to the new issue.

For a single line like:

```md
- [ ] P1: Improve binary detection
```

transform to:

```md
- [ ] P1: [Improve binary detection](https://github.com/logancyang/obsidian-copilot-preview/issues/123)
```

The checkbox stays unchecked. (Closing the checkbox happens later, when the
GitHub issue itself closes — that sweep is not part of this skill.)

If the issue folded in sub-items, the caller is expected to pass the full
line range to replace; the skill does what it's told and does not infer.

**`source-edit=return-only` mode.** If the caller passes `source-edit=return-only`,
compute the proposed replacement line(s) and return them in the report
without touching the file. Used when a caller wants to serialize file writes
itself.

If no source file is passed, skip this step entirely.

## Report back

Return a structured summary the caller can parse:

- `Created #<N>: <title> → <url>`
- `Source edit: <path>:<lines>` _or_ `Source edit: returned <line>` _or_
  `Source edit: none`
- `Revision passes: <N>` _(only in `stage=review-and-push` / `stage=all`)_
- `Rubric: pass` _or_ `Rubric: abort — <reason>` _(only in
  `stage=review-and-push` / `stage=all`)_

If `Rubric: abort`, no issue was created and no source edit was made.

## What this skill does not do

- Process multiple items in one invocation. One issue per call.
- Decide whether sub-items should be folded vs. split. The caller decides
  and passes the result in.
- Reason about other items, sequencing, batching, or any external workflow.
- Close issues, assign users, set milestones, or sync GitHub state back into
  any source file.
- Create pull requests.
