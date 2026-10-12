import type { RecordedParse } from "@/agentMode/ui/renderedDiff/testing/recordedParserApp";

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

export const TASK_BLOCK_INSERTED: RenderedDiffFixture = {
  path: "Daily/2026-09-16.md",
  before: null,
  after: "- [ ] Book it\n",
};

export const TASK_LIST_REORDERED: RenderedDiffFixture = {
  path: "Daily/2026-09-16.md",
  before: "- [ ] Draft the migration runbook\n- [ ] Book the review slot\n- [ ] Send the invite\n",
  after: "- [ ] Send the invite\n- [ ] Draft the migration runbook\n- [ ] Book the review slot\n",
};

export const LIST_ITEM_WITH_CODE_EDIT: RenderedDiffFixture = {
  path: "projects/Alpha/Queries.md",
  before: "- Run the checks:\n  ```bash\n  npm run verify\n  ```\n- Ship the build\n",
  after: "- Run the checks:\n  ```bash\n  npm run verify --strict\n  ```\n- Ship the build\n",
};

export const ORDERED_LIST_ITEM_APPENDED: RenderedDiffFixture = {
  path: "projects/Alpha/Open questions.md",
  before: "1. Draft\n2. Review\n3. Ship\n",
  after: "1. Draft\n2. Review\n3. Ship\n4. Announce\n",
};

export const LIST_HEAD_REMOVED: RenderedDiffFixture = {
  path: "projects/Alpha/Open questions.md",
  before: "Questions:\n\n- One\n- Two\n",
  after: "Questions:\n\n- Two\n",
};

export const LOOSE_LIST_ITEM_EDIT: RenderedDiffFixture = {
  path: "projects/Alpha/Open questions.md",
  before: "- Who owns the runbook?\n\n- What does the rollback look like?\n",
  after: "- Who owns the runbook?\n\n- What does the rollback look like today?\n",
};

export const CRLF_TO_LF_CONVERSION: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "# Alpha\r\n\r\nBody\r\n",
  after: "# Alpha\n\nBody\n",
};

export const BLANK_LINE_ADDED: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "Alpha\n\nBeta\n",
  after: "Alpha\n\n\nBeta\n",
};

export const TRAILING_SPACES_ADDED: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "The pilot runs.\nWe report weekly.\n",
  after: "The pilot runs.  \nWe report weekly.\n",
};

export const TABLE_COLUMN_ADDED: RenderedDiffFixture = {
  path: "projects/Alpha/Capacity.md",
  before: "| Region | Partners |\n| --- | --- |\n| EMEA | 2 |\n",
  after: "| Region | Partners | Status |\n| --- | --- | --- |\n| EMEA | 2 | Ready |\n",
};

export const UNCHANGED_HEADING_AND_LIST: RenderedDiffFixture = {
  path: "projects/Alpha/Project brief.md",
  before: "# Alpha\n\n- One\n- Two\n",
  after: "# Alpha\n\n- One\n- Two\n",
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

// Recorded from Obsidian 1.14.4's computeMetadataAsync on each Markdown fixture, with CRLF read as LF,
// so unit tests split blocks the way the app does: https://github.com/Brevilabs/obsidian-copilot-private/issues/348
export const RECORDED_PARSES: ReadonlyMap<
  RenderedDiffFixture,
  { before: RecordedParse; after: RecordedParse }
> = new Map([
  [
    WORDING_CHANGE,
    { before: { sections: [["paragraph", 0, 1]] }, after: { sections: [["paragraph", 0, 1]] } },
  ],
  [
    HEADING_LEVEL_CHANGE,
    {
      before: {
        sections: [
          ["heading", 0, 0],
          ["paragraph", 2, 2],
        ],
      },
      after: {
        sections: [
          ["heading", 0, 0],
          ["paragraph", 2, 2],
        ],
      },
    },
  ],
  [
    ADDED_LIST_ITEM,
    {
      before: {
        sections: [["list", 0, 1]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
        ],
      },
      after: {
        sections: [["list", 0, 2]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
          [2, 2, -1],
        ],
      },
    },
  ],
  [
    REMOVED_LIST_ITEM,
    {
      before: {
        sections: [["list", 0, 2]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
          [2, 2, -1],
        ],
      },
      after: {
        sections: [["list", 0, 1]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
        ],
      },
    },
  ],
  [
    TASK_CHECKBOX_TOGGLED,
    {
      before: {
        sections: [["list", 0, 1]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
        ],
      },
      after: {
        sections: [["list", 0, 1]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
        ],
      },
    },
  ],
  [
    LINK_HREF_CHANGE,
    { before: { sections: [["paragraph", 0, 0]] }, after: { sections: [["paragraph", 0, 0]] } },
  ],
  [
    WIKILINK_RENAME,
    { before: { sections: [["paragraph", 0, 0]] }, after: { sections: [["paragraph", 0, 0]] } },
  ],
  [
    TABLE_CELL_EDIT,
    { before: { sections: [["table", 0, 3]] }, after: { sections: [["table", 0, 3]] } },
  ],
  [
    TABLE_ROW_ADDED,
    { before: { sections: [["table", 0, 2]] }, after: { sections: [["table", 0, 3]] } },
  ],
  [
    TABLE_ROW_REMOVED,
    { before: { sections: [["table", 0, 3]] }, after: { sections: [["table", 0, 2]] } },
  ],
  [
    CODE_BLOCK_LINE_CHANGE,
    {
      before: {
        sections: [
          ["paragraph", 0, 0],
          ["code", 2, 5],
        ],
      },
      after: {
        sections: [
          ["paragraph", 0, 0],
          ["code", 2, 5],
        ],
      },
    },
  ],
  [
    FRONTMATTER_TAG_ADDED,
    {
      before: {
        sections: [
          ["yaml", 0, 4],
          ["paragraph", 6, 6],
        ],
      },
      after: {
        sections: [
          ["yaml", 0, 5],
          ["paragraph", 7, 7],
        ],
      },
    },
  ],
  [
    FRONTMATTER_UNCHANGED_BODY_EDIT,
    {
      before: {
        sections: [
          ["yaml", 0, 4],
          ["paragraph", 6, 6],
        ],
      },
      after: {
        sections: [
          ["yaml", 0, 4],
          ["paragraph", 6, 6],
        ],
      },
    },
  ],
  [
    BLOCK_MOVED,
    {
      before: {
        sections: [
          ["paragraph", 0, 0],
          ["paragraph", 2, 2],
          ["paragraph", 4, 4],
        ],
      },
      after: {
        sections: [
          ["paragraph", 0, 0],
          ["paragraph", 2, 2],
          ["paragraph", 4, 4],
        ],
      },
    },
  ],
  [
    CJK_EDIT,
    { before: { sections: [["paragraph", 0, 0]] }, after: { sections: [["paragraph", 0, 0]] } },
  ],
  [
    FILE_CREATED,
    {
      before: { sections: [] },
      after: {
        sections: [
          ["heading", 0, 0],
          ["paragraph", 2, 2],
          ["list", 4, 5],
        ],
        listItems: [
          [4, 4, -4],
          [5, 5, -4],
        ],
      },
    },
  ],
  [
    FILE_EMPTIED,
    {
      before: {
        sections: [
          ["heading", 0, 0],
          ["paragraph", 2, 2],
          ["list", 4, 4],
        ],
        listItems: [[4, 4, -4]],
      },
      after: { sections: [] },
    },
  ],
  [
    TASK_BLOCK_INSERTED,
    { before: { sections: [] }, after: { sections: [["list", 0, 0]], listItems: [[0, 0, -1]] } },
  ],
  [
    TASK_LIST_REORDERED,
    {
      before: {
        sections: [["list", 0, 2]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
          [2, 2, -1],
        ],
      },
      after: {
        sections: [["list", 0, 2]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
          [2, 2, -1],
        ],
      },
    },
  ],
  [
    LIST_ITEM_WITH_CODE_EDIT,
    {
      before: {
        sections: [["list", 0, 4]],
        listItems: [
          [0, 3, -1],
          [4, 4, -1],
        ],
      },
      after: {
        sections: [["list", 0, 4]],
        listItems: [
          [0, 3, -1],
          [4, 4, -1],
        ],
      },
    },
  ],
  [
    ORDERED_LIST_ITEM_APPENDED,
    {
      before: {
        sections: [["list", 0, 2]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
          [2, 2, -1],
        ],
      },
      after: {
        sections: [["list", 0, 3]],
        listItems: [
          [0, 0, -1],
          [1, 1, -1],
          [2, 2, -1],
          [3, 3, -1],
        ],
      },
    },
  ],
  [
    LIST_HEAD_REMOVED,
    {
      before: {
        sections: [
          ["paragraph", 0, 0],
          ["list", 2, 3],
        ],
        listItems: [
          [2, 2, -2],
          [3, 3, -2],
        ],
      },
      after: {
        sections: [
          ["paragraph", 0, 0],
          ["list", 2, 2],
        ],
        listItems: [[2, 2, -2]],
      },
    },
  ],
  [
    LOOSE_LIST_ITEM_EDIT,
    {
      before: {
        sections: [["list", 0, 2]],
        listItems: [
          [0, 1, -1],
          [2, 2, -1],
        ],
      },
      after: {
        sections: [["list", 0, 2]],
        listItems: [
          [0, 1, -1],
          [2, 2, -1],
        ],
      },
    },
  ],
  [
    CRLF_TO_LF_CONVERSION,
    {
      before: {
        sections: [
          ["heading", 0, 0],
          ["paragraph", 2, 2],
        ],
      },
      after: {
        sections: [
          ["heading", 0, 0],
          ["paragraph", 2, 2],
        ],
      },
    },
  ],
  [
    BLANK_LINE_ADDED,
    {
      before: {
        sections: [
          ["paragraph", 0, 0],
          ["paragraph", 2, 2],
        ],
      },
      after: {
        sections: [
          ["paragraph", 0, 0],
          ["paragraph", 3, 3],
        ],
      },
    },
  ],
  [
    TRAILING_SPACES_ADDED,
    { before: { sections: [["paragraph", 0, 1]] }, after: { sections: [["paragraph", 0, 1]] } },
  ],
  [
    TABLE_COLUMN_ADDED,
    { before: { sections: [["table", 0, 2]] }, after: { sections: [["table", 0, 2]] } },
  ],
  [
    UNCHANGED_HEADING_AND_LIST,
    {
      before: {
        sections: [
          ["heading", 0, 0],
          ["list", 2, 3],
        ],
        listItems: [
          [2, 2, -2],
          [3, 3, -2],
        ],
      },
      after: {
        sections: [
          ["heading", 0, 0],
          ["list", 2, 3],
        ],
        listItems: [
          [2, 2, -2],
          [3, 3, -2],
        ],
      },
    },
  ],
  [
    WHOLE_NOTE,
    {
      before: {
        sections: [
          ["yaml", 0, 4],
          ["heading", 6, 6],
          ["paragraph", 8, 9],
          ["heading", 11, 11],
          ["list", 13, 15],
          ["heading", 17, 17],
          ["table", 19, 22],
          ["heading", 24, 24],
          ["code", 26, 29],
          ["paragraph", 31, 31],
        ],
        listItems: [
          [13, 13, -13],
          [14, 14, -13],
          [15, 15, -13],
        ],
      },
      after: {
        sections: [
          ["yaml", 0, 5],
          ["heading", 7, 7],
          ["paragraph", 9, 10],
          ["heading", 12, 12],
          ["list", 14, 16],
          ["heading", 18, 18],
          ["table", 20, 23],
          ["heading", 25, 25],
          ["code", 27, 30],
          ["paragraph", 32, 32],
        ],
        listItems: [
          [14, 14, -14],
          [15, 15, -14],
          [16, 16, -14],
        ],
      },
    },
  ],
]);
