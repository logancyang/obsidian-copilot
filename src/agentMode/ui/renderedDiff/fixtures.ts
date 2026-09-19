/** One before/after pair of a changed file, shared by the rendered-diff tests and stories. */
export interface RenderedDiffFixture {
  path: string;
  before: string | null;
  after: string | null;
}

/** A sentence rewritten in place: the commonest edit an agent makes. */
export const WORDING_CHANGE: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before:
    "The pilot runs for six weeks with two design partners.\nWe report progress every Friday.\n",
  after:
    "The pilot runs for eight weeks with three design partners.\nWe report progress every Friday.\n",
};

/** A section demoted one level, which changes the syntax rather than the prose. */
export const HEADING_LEVEL_CHANGE: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "## Rollout plan\n\nStaged by region, starting with EMEA.\n",
  after: "### Rollout plan\n\nStaged by region, starting with EMEA.\n",
};

/** A bullet appended to an existing list. */
export const ADDED_LIST_ITEM: RenderedDiffFixture = {
  path: "projects/Alpha/Open questions.md",
  before: "- Who owns the migration runbook?\n- What does the rollback look like?\n",
  after:
    "- Who owns the migration runbook?\n- What does the rollback look like?\n- How long do we keep the old index?\n",
};

/** A bullet dropped from the middle of a list. */
export const REMOVED_LIST_ITEM: RenderedDiffFixture = {
  path: "projects/Alpha/Open questions.md",
  before:
    "- Who owns the migration runbook?\n- Do we still need the staging vault?\n- What does the rollback look like?\n",
  after: "- Who owns the migration runbook?\n- What does the rollback look like?\n",
};

/** A task ticked off, which lives entirely in the checkbox syntax. */
export const TASK_CHECKBOX_TOGGLED: RenderedDiffFixture = {
  path: "Daily/2026-09-16.md",
  before: "- [ ] Draft the migration runbook\n- [ ] Book the review slot\n",
  after: "- [x] Draft the migration runbook\n- [ ] Book the review slot\n",
};

/** Same link text, different destination: the change is invisible unless the URL is diffed. */
export const LINK_HREF_CHANGE: RenderedDiffFixture = {
  path: "projects/Alpha/Resources.md",
  before: "See the [rollout checklist](https://example.com/checklists/v1) before you start.\n",
  after: "See the [rollout checklist](https://example.com/checklists/v2) before you start.\n",
};

/** A renamed note, so every wikilink pointing at it moves. */
export const WIKILINK_RENAME: RenderedDiffFixture = {
  path: "projects/Alpha/Resources.md",
  before: "Context lives in [[Migration runbook]] and nowhere else.\n",
  after: "Context lives in [[Migration runbook 2026]] and nowhere else.\n",
};

/** One cell corrected inside an otherwise untouched table. */
export const TABLE_CELL_EDIT: RenderedDiffFixture = {
  path: "projects/Alpha/Capacity.md",
  before:
    "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n| APAC | 1 | Blocked |\n",
  after:
    "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 3 | Ready |\n| APAC | 1 | Blocked |\n",
};

/** A whole row appended to a table. */
export const TABLE_ROW_ADDED: RenderedDiffFixture = {
  path: "projects/Alpha/Capacity.md",
  before: "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n",
  after:
    "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n| AMER | 4 | Ready |\n",
};

/** A whole row dropped from a table. */
export const TABLE_ROW_REMOVED: RenderedDiffFixture = {
  path: "projects/Alpha/Capacity.md",
  before:
    "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n| APAC | 1 | Blocked |\n",
  after: "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n",
};

/** One line of a fenced code block rewritten. */
export const CODE_BLOCK_LINE_CHANGE: RenderedDiffFixture = {
  path: "projects/Alpha/Queries.md",
  before:
    "Run this before the migration:\n\n```bash\nnpm run migrate --dry-run\nnpm run verify\n```\n",
  after:
    "Run this before the migration:\n\n```bash\nnpm run migrate --dry-run --verbose\nnpm run verify\n```\n",
};

/** A tag added to the frontmatter, which never reaches the Markdown renderer. */
export const FRONTMATTER_TAG_ADDED: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "---\ntags:\n  - project\nstatus: draft\n---\n\nThe pilot runs for six weeks.\n",
  after:
    "---\ntags:\n  - project\n  - rollout\nstatus: draft\n---\n\nThe pilot runs for six weeks.\n",
};

/** Properties the turn left alone, which stay out of the diff entirely. */
export const FRONTMATTER_UNCHANGED_BODY_EDIT: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "---\ntags:\n  - project\nstatus: draft\n---\n\nThe pilot runs for six weeks.\n",
  after: "---\ntags:\n  - project\nstatus: draft\n---\n\nThe pilot runs for eight weeks.\n",
};

/** A paragraph relocated verbatim, which reads as a deletion and an insertion. */
export const BLOCK_MOVED: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before:
    "Budget is fixed for the quarter.\n\nThe pilot runs for six weeks.\n\nWe report progress every Friday.\n",
  after:
    "The pilot runs for six weeks.\n\nWe report progress every Friday.\n\nBudget is fixed for the quarter.\n",
};

/** Chinese prose, which carries no spaces and therefore diffs per character. */
export const CJK_EDIT: RenderedDiffFixture = {
  path: "会议/2026-09-16.md",
  before: "本周的重点是发布准备，下周开始灰度。\n",
  after: "本周的重点是发布验收，下周开始灰度。\n",
};

/** A note the agent created, so there is no before side at all. */
export const FILE_CREATED: RenderedDiffFixture = {
  path: "Meeting 2026-09-16.md",
  before: null,
  after:
    "# Migration review\n\nAttendees: Ana, Bo, Kit.\n\n- Runbook is drafted\n- Rollback still open\n",
};

/** A note the agent emptied, keeping the file but removing every line. */
export const FILE_EMPTIED: RenderedDiffFixture = {
  path: "Inbox/Scratch.md",
  before: "# Scratch\n\nParked ideas from the migration review.\n\n- Try a shadow index\n",
  after: "",
};

/** A canvas file, shown verbatim because rendering it would hide the change. */
export const NON_MARKDOWN_FILE: RenderedDiffFixture = {
  path: "projects/Alpha/Board.canvas",
  before: '{\n  "nodes": [\n    { "id": "a", "text": "Pilot" }\n  ]\n}\n',
  after:
    '{\n  "nodes": [\n    { "id": "a", "text": "Pilot" },\n    { "id": "b", "text": "Rollout" }\n  ]\n}\n',
};

/** Every block kind at once, so one screen shows how the whole document reads. */
export const WHOLE_NOTE: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: `---
tags:
  - project
status: draft
---

# Alpha pilot

The pilot runs for six weeks with two design partners. Context lives in
[[Migration runbook]] and the [rollout checklist](https://example.com/checklists/v1).

## Open questions

- [ ] Who owns the migration runbook?
- [ ] Do we still need the staging vault?
- [ ] What does the rollback look like?

## Capacity

| Region | Partners | Status |
| --- | --- | --- |
| EMEA | 2 | Ready |
| APAC | 1 | Blocked |

## Commands

\`\`\`bash
npm run migrate --dry-run
npm run verify
\`\`\`

Budget is fixed for the quarter.
`,
  after: `---
tags:
  - project
  - rollout
status: active
---

# Alpha pilot

The pilot runs for eight weeks with three design partners. Context lives in
[[Migration runbook 2026]] and the [rollout checklist](https://example.com/checklists/v2).

### Open questions

- [x] Who owns the migration runbook?
- [ ] What does the rollback look like?
- [ ] How long do we keep the old index?

## Capacity

| Region | Partners | Status |
| --- | --- | --- |
| EMEA | 3 | Ready |
| AMER | 4 | Ready |

## Commands

\`\`\`bash
npm run migrate --dry-run --verbose
npm run verify
\`\`\`

Budget is fixed for the quarter, and the pilot owns it.
`,
};
