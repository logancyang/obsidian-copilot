export interface RenderedDiffFixture {
  path: string;
  before: string | null;
  after: string | null;
}

export const WORDING_CHANGE: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before:
    "The pilot runs for six weeks with two design partners.\nWe report progress every Friday.\n",
  after:
    "The pilot runs for eight weeks with three design partners.\nWe report progress every Friday.\n",
};

export const HEADING_LEVEL_CHANGE: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "## Rollout plan\n\nStaged by region, starting with EMEA.\n",
  after: "### Rollout plan\n\nStaged by region, starting with EMEA.\n",
};

export const ADDED_LIST_ITEM: RenderedDiffFixture = {
  path: "projects/Alpha/Open questions.md",
  before: "- Who owns the migration runbook?\n- What does the rollback look like?\n",
  after:
    "- Who owns the migration runbook?\n- What does the rollback look like?\n- How long do we keep the old index?\n",
};

export const REMOVED_LIST_ITEM: RenderedDiffFixture = {
  path: "projects/Alpha/Open questions.md",
  before:
    "- Who owns the migration runbook?\n- Do we still need the staging vault?\n- What does the rollback look like?\n",
  after: "- Who owns the migration runbook?\n- What does the rollback look like?\n",
};

export const TASK_CHECKBOX_TOGGLED: RenderedDiffFixture = {
  path: "Daily/2026-09-16.md",
  before: "- [ ] Draft the migration runbook\n- [ ] Book the review slot\n",
  after: "- [x] Draft the migration runbook\n- [ ] Book the review slot\n",
};

export const LINK_HREF_CHANGE: RenderedDiffFixture = {
  path: "projects/Alpha/Resources.md",
  before: "See the [rollout checklist](https://example.com/checklists/v1) before you start.\n",
  after: "See the [rollout checklist](https://example.com/checklists/v2) before you start.\n",
};

export const WIKILINK_RENAME: RenderedDiffFixture = {
  path: "projects/Alpha/Resources.md",
  before: "Context lives in [[Migration runbook]] and nowhere else.\n",
  after: "Context lives in [[Migration runbook 2026]] and nowhere else.\n",
};

export const TABLE_CELL_EDIT: RenderedDiffFixture = {
  path: "projects/Alpha/Capacity.md",
  before:
    "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n| APAC | 1 | Blocked |\n",
  after:
    "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 3 | Ready |\n| APAC | 1 | Blocked |\n",
};

export const TABLE_ROW_ADDED: RenderedDiffFixture = {
  path: "projects/Alpha/Capacity.md",
  before: "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n",
  after:
    "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n| AMER | 4 | Ready |\n",
};

export const TABLE_ROW_REMOVED: RenderedDiffFixture = {
  path: "projects/Alpha/Capacity.md",
  before:
    "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n| APAC | 1 | Blocked |\n",
  after: "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n",
};

export const CODE_BLOCK_LINE_CHANGE: RenderedDiffFixture = {
  path: "projects/Alpha/Queries.md",
  before:
    "Run this before the migration:\n\n```bash\nnpm run migrate --dry-run\nnpm run verify\n```\n",
  after:
    "Run this before the migration:\n\n```bash\nnpm run migrate --dry-run --verbose\nnpm run verify\n```\n",
};

export const FRONTMATTER_TAG_ADDED: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "---\ntags:\n  - project\nstatus: draft\n---\n\nThe pilot runs for six weeks.\n",
  after:
    "---\ntags:\n  - project\n  - rollout\nstatus: draft\n---\n\nThe pilot runs for six weeks.\n",
};

export const FRONTMATTER_UNCHANGED_BODY_EDIT: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "---\ntags:\n  - project\nstatus: draft\n---\n\nThe pilot runs for six weeks.\n",
  after: "---\ntags:\n  - project\nstatus: draft\n---\n\nThe pilot runs for eight weeks.\n",
};

export const BLOCK_MOVED: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before:
    "Budget is fixed for the quarter.\n\nThe pilot runs for six weeks.\n\nWe report progress every Friday.\n",
  after:
    "The pilot runs for six weeks.\n\nWe report progress every Friday.\n\nBudget is fixed for the quarter.\n",
};

export const CJK_EDIT: RenderedDiffFixture = {
  path: "会议/2026-09-16.md",
  before: "本周的重点是发布准备，下周开始灰度。\n",
  after: "本周的重点是发布验收，下周开始灰度。\n",
};

export const FILE_CREATED: RenderedDiffFixture = {
  path: "Meeting 2026-09-16.md",
  before: null,
  after:
    "# Migration review\n\nAttendees: Ana, Bo, Kit.\n\n- Runbook is drafted\n- Rollback still open\n",
};

export const FILE_EMPTIED: RenderedDiffFixture = {
  path: "Inbox/Scratch.md",
  before: "# Scratch\n\nParked ideas from the migration review.\n\n- Try a shadow index\n",
  after: "",
};

export const NON_MARKDOWN_FILE: RenderedDiffFixture = {
  path: "projects/Alpha/Board.canvas",
  before: '{\n  "nodes": [\n    { "id": "a", "text": "Pilot" }\n  ]\n}\n',
  after:
    '{\n  "nodes": [\n    { "id": "a", "text": "Pilot" },\n    { "id": "b", "text": "Rollout" }\n  ]\n}\n',
};

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
