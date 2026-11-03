import type { BuiltinSkill } from "./builtinSkills";

export const OBSIDIAN_SKILLS_UPSTREAM_REVISION = "a1dc48e68138490d522c04cbf5822214c6eb1202";

// In the Obsidian skills eval Claude and Codex wrote this syntax as well without the skills, except
// Codex building Bases views. https://github.com/Brevilabs/obsidian-copilot-private/issues/726
const OPENCODE_ONLY = { disabledAgents: ["claude", "codex"] };
const FORMAT_SKILL_VERSION = 3;
const MARKDOWN_SKILL_VERSION = 4;

const UPSTREAM_LICENSE = String.raw`MIT License

Copyright (c) 2026 Steph Ango (@kepano)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const OBSIDIAN_MARKDOWN_SKILL_MD = String.raw`---
name: obsidian-markdown
description: Create and edit Obsidian-specific Markdown in .md notes, including wikilinks, block IDs (^id) with block and list embeds, heading embeds, callouts, properties and frontmatter, tags, aliases, and comments. Load before adding or changing any of these in a note, such as linking or embedding a paragraph, list or section, or setting a note's properties.
license: MIT
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${MARKDOWN_SKILL_VERSION}"
  copilot-upstream-revision: "${OBSIDIAN_SKILLS_UPSTREAM_REVISION}"
---

# Obsidian Markdown

Use Obsidian-specific syntax accurately. Do not spend tokens explaining ordinary
CommonMark or GFM unless the user asks.

## Workflow

1. Preserve existing frontmatter keys and formatting when editing a note.
2. Use wikilinks for vault notes and Markdown links for external URLs.
3. Use embeds, callouts, properties, tags, comments, and block references only
   when they improve the requested note.
4. Check link targets, YAML validity, and block IDs after editing.
5. Read the focused reference file when the task needs more syntax detail.

## Wikilinks and block references

~~~markdown
[[Note Name]]
[[Note Name|Display Text]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
[[#Heading in this note]]

This paragraph is addressable. ^block-id
~~~

Put a block ID on its own line after a list or quote block, with a blank line
before and after it; without the line before it marks only the last item.

## Embeds

Prefix a wikilink with <code>!</code>:

~~~markdown
![[Note Name]]
![[Note Name#Heading]]
![[image.png|300]]
![[document.pdf#page=3]]
~~~

See [Embeds](references/EMBEDS.md) for media, PDF, and query forms.

## Callouts

~~~markdown
> [!warning] Custom title
> Important content.

> [!faq]- Collapsed by default
> Foldable content.
~~~

See [Callouts](references/CALLOUTS.md) for types, aliases, folding, and nesting.

## Properties, tags, and comments

~~~yaml
---
title: My Note
date: 2026-07-21
tags:
  - project
aliases:
  - Alternate Name
related: "[[Other Note]]"
---
~~~

Quote wikilinks used as YAML values. See
[Properties](references/PROPERTIES.md) for supported property types and tag rules.

Use <code>#nested/tag</code> for inline tags. Hide content from reading view with
<code>%%inline comments%%</code> or a matching pair of <code>%%</code> markers on
separate lines.

## Render-safe math

- In a table, write a pipe inside math as <code>\lvert</code>/<code>\rvert</code>
  and anywhere else as <code>\|</code>; a bare <code>|</code> starts a new column.
- When a script inserts <code>$$</code>, use a literal or function replacement
  (JavaScript <code>replace</code> turns <code>$$</code> into <code>$</code>), then
  recount the delimiters in every changed file.

~~~markdown
| Name | Formula |
| --- | --- |
| Absolute value | $\lvert x \rvert$ |
~~~

## Attribution

Adapted from <code>kepano/obsidian-skills</code> at revision
<code>${OBSIDIAN_SKILLS_UPSTREAM_REVISION}</code>. See <code>LICENSE</code>.
`;

const MARKDOWN_CALLOUTS_REFERENCE = String.raw`# Callouts reference

## Folding and nesting

~~~markdown
> [!faq]- Collapsed by default
> Hidden until expanded.

> [!faq]+ Expanded by default
> Visible but collapsible.

> [!question] Outer
> > [!note] Inner
> > Nested content.
~~~

## Built-in types

| Type | Aliases |
| --- | --- |
| note | — |
| abstract | summary, tldr |
| info | — |
| todo | — |
| tip | hint, important |
| success | check, done |
| question | help, faq |
| warning | caution, attention |
| failure | fail, missing |
| danger | error |
| bug | — |
| example | — |
| quote | cite |
`;

const MARKDOWN_EMBEDS_REFERENCE = String.raw`# Embeds reference

~~~markdown
![[Note Name]]
![[Note Name#Heading]]
![[Note Name#^block-id]]

![[image.png]]
![[image.png|640x480]]
![[image.png|300]]

![[audio.mp3]]
![[video.mp4]]

![[document.pdf]]
![[document.pdf#page=3]]
![[document.pdf#height=400]]
~~~

A list embed needs a block ID after the list. An embedded search uses an
Obsidian query block:

~~~~markdown
~~~query
tag:#project status:done
~~~
~~~~
`;

const MARKDOWN_PROPERTIES_REFERENCE = String.raw`# Properties reference

Properties are YAML frontmatter at the very start of a note.

| Property type | Example |
| --- | --- |
| Text | <code>title: My title</code> |
| Number | <code>rating: 4.5</code> |
| Checkbox | <code>completed: true</code> |
| Date | <code>date: 2026-07-21</code> |
| Date and time | <code>due: 2026-07-21T14:30:00</code> |
| List | <code>tags: [one, two]</code> or a YAML list |
| Link | A quoted wikilink, as below |

~~~yaml
related: "[[Other Note]]"
~~~

Obsidian reserves <code>tags</code>, <code>aliases</code>, and
<code>cssclasses</code> for their built-in behaviors. Tags may contain letters,
numbers (not as the first character), underscores, hyphens, and forward slashes.
Prefer YAML lists when a property naturally has multiple values.
`;

const OBSIDIAN_BASES_SKILL_MD = String.raw`---
name: obsidian-bases
description: Create and edit Obsidian Bases (.base files) with valid YAML filters, formulas, properties, summaries, and table/cards/list views, including the columns a view shows (order) and its row sorting (sort). Load before writing or changing any .base file or embedding a base view, or when the user mentions Bases, database-like views, filters, formulas, sorting, grouping, or summaries.
license: MIT
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${FORMAT_SKILL_VERSION}"
  copilot-upstream-revision: "${OBSIDIAN_SKILLS_UPSTREAM_REVISION}"
---

# Obsidian Bases

## Workflow

1. Read the existing <code>.base</code> file before editing it.
2. Define global scope with <code>filters</code>.
3. Add computed values under <code>formulas</code> only when needed.
4. Configure property display names and one or more views.
5. Validate YAML, formula references, quoting, and date/duration operations.
6. Open or query the Base in Obsidian when the CLI is available.

## Schema

~~~yaml
filters:
  and:
    - 'file.ext == "md"'
    - 'status != "archived"'

formulas:
  days_until_due: 'if(due, (date(due) - today()).days.round(), "")'

properties:
  status:
    displayName: Status
  formula.days_until_due:
    displayName: "Days Until Due"

summaries:
  mean_rounded: 'values.mean().round(2)'

views:
  - type: table
    name: Active
    limit: 50
    filters:
      and:
        - 'status != "done"'
    order:
      - file.name
      - status
      - due
      - formula.days_until_due
    sort:
      - property: due
        direction: ASC
    groupBy:
      property: status
      direction: ASC
    summaries:
      formula.days_until_due: Average
~~~

Views may be <code>table</code>, <code>cards</code>, or <code>list</code>.
A <code>map</code> view depends on compatible map support.

<code>order</code> sets which properties a view shows; <code>sort</code> sets
row order, one <code>property</code>/<code>direction</code> entry per key,
applied in turn. Obsidian sorts only by properties that are also listed in
<code>order</code>, so include every sort property there.

## Filters and properties

Filters may be a single expression or recursively nested <code>and</code>,
<code>or</code>, and <code>not</code> objects. Property namespaces are:

- note properties: <code>status</code> or <code>note.status</code>
- file metadata: <code>file.name</code>, <code>file.path</code>,
  <code>file.folder</code>, <code>file.ctime</code>, <code>file.mtime</code>,
  <code>file.tags</code>, <code>file.links</code>, and
  <code>file.backlinks</code>
- formulas: <code>formula.days_until_due</code>

Use <code>file.hasTag()</code>, <code>file.hasLink()</code>,
<code>file.hasProperty()</code>, and <code>file.inFolder()</code> for indexed
file relationships. The <code>this</code> value refers to the Base itself, the
embedding note, or the active file depending on where the Base is rendered.

## Formula rules

- Guard optional properties with <code>if()</code>.
- Date subtraction returns a Duration, not a number. Access
  <code>.days</code>, <code>.hours</code>, or another numeric field before
  calling number methods such as <code>.round()</code>. Round day counts:
  across a daylight-saving change <code>.days</code> can be fractional.
- Every <code>formula.X</code> used by a view or property configuration must
  have a matching <code>X</code> entry under <code>formulas</code>.
- Wrap formulas containing double quotes in YAML single quotes.
- Quote YAML strings containing special characters, especially colons and
  leading punctuation.

Read [Functions reference](references/FUNCTIONS_REFERENCE.md) for function and
type-specific operations, and [Examples](references/EXAMPLES.md) for complete
task-tracker and daily-notes Bases.

## Validation checklist

- The document parses as YAML and has a <code>views</code> list.
- View <code>order</code>, <code>groupBy</code>, and summaries reference defined
  note, file, or formula properties.
- Formula quoting is balanced and duration math accesses a numeric field.
- Every <code>sort</code> property also appears in that view's <code>order</code>.
- An embed names the view exactly as its <code>name</code>:

~~~markdown
![[My Base.base#View Name]]
~~~

## Attribution

Adapted from <code>kepano/obsidian-skills</code> at revision
<code>${OBSIDIAN_SKILLS_UPSTREAM_REVISION}</code>. See <code>LICENSE</code>.
`;

const BASES_FUNCTIONS_REFERENCE = String.raw`# Bases functions reference

## Global functions

| Function | Purpose |
| --- | --- |
| <code>date(value)</code> | Parse a date string |
| <code>duration(value)</code> | Parse a duration string |
| <code>now()</code> / <code>today()</code> | Current date-time / date |
| <code>if(condition, yes, no?)</code> | Conditional value |
| <code>number(value)</code> | Convert to number |
| <code>link(path, display?)</code> | Create a link |
| <code>file(path)</code> | Resolve a file object |
| <code>list(value)</code> | Normalize a value to a list |
| <code>image(path)</code> / <code>icon(name)</code> | Create renderable values |

## Common methods

- String: <code>contains</code>, <code>startsWith</code>, <code>endsWith</code>,
  <code>lower</code>, <code>trim</code>, <code>replace</code>,
  <code>split</code>, <code>isEmpty</code>.
- Number: <code>abs</code>, <code>ceil</code>, <code>floor</code>,
  <code>round</code>, <code>toFixed</code>.
- List: <code>contains</code>, <code>containsAll</code>,
  <code>containsAny</code>, <code>filter</code>, <code>map</code>,
  <code>reduce</code>, <code>flat</code>, <code>join</code>,
  <code>sort</code>, <code>unique</code>.
- File: <code>asLink</code>, <code>hasLink</code>, <code>hasTag</code>,
  <code>hasProperty</code>, <code>inFolder</code>.
- Link: <code>asFile</code>, <code>linksTo</code>.
- Object: <code>keys</code>, <code>values</code>, <code>isEmpty</code>.
- Regular expression: <code>matches</code>.

Date fields include <code>year</code>, <code>month</code>, <code>day</code>,
<code>hour</code>, <code>minute</code>, and <code>second</code>. Date methods
include <code>date()</code>, <code>format()</code>, <code>time()</code>, and
<code>relative()</code>.

Duration fields are <code>days</code>, <code>hours</code>,
<code>minutes</code>, <code>seconds</code>, and <code>milliseconds</code>.
Duration does not directly support number rounding methods.
`;

const BASES_EXAMPLES = String.raw`# Bases examples

## Task tracker

~~~yaml
filters:
  and:
    - file.hasTag("task")
    - 'file.ext == "md"'

formulas:
  days_until_due: 'if(due, (date(due) - today()).days.round(), "")'
  is_overdue: 'if(due, date(due) < today() && status != "done", false)'

properties:
  formula.days_until_due:
    displayName: "Days Until Due"

views:
  - type: table
    name: Active
    filters:
      and:
        - 'status != "done"'
    order:
      - file.name
      - status
      - due
      - formula.days_until_due
    groupBy:
      property: status
      direction: ASC
~~~

## Daily notes index

~~~yaml
filters:
  and:
    - file.inFolder("Daily Notes")
    - '/^\d{4}-\d{2}-\d{2}$/.matches(file.basename)'

formulas:
  day_of_week: 'date(file.basename).format("dddd")'
  word_estimate: '(file.size / 5).round(0)'

views:
  - type: table
    name: Recent notes
    limit: 30
    order:
      - file.name
      - formula.day_of_week
      - formula.word_estimate
      - file.mtime
~~~
`;

const JSON_CANVAS_SKILL_MD = String.raw`---
name: json-canvas
description: Create and edit JSON Canvas (.canvas) files with valid text, file, link, and group nodes, edges, colors, layout, and IDs, including file cards that show one section or block of a note (subpath). Load before writing or changing any .canvas file, or for Obsidian Canvas boards, visual maps, flowcharts, or any request involving the JSON Canvas format.
license: MIT
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${FORMAT_SKILL_VERSION}"
  copilot-upstream-revision: "${OBSIDIAN_SKILLS_UPSTREAM_REVISION}"
---

# JSON Canvas

Follow JSON Canvas 1.0. A <code>.canvas</code> document contains top-level
<code>nodes</code> and <code>edges</code> arrays.

## Workflow

1. Parse the existing JSON before editing it.
2. Generate a unique lowercase 16-character hexadecimal ID for each new node
   or edge.
3. Position nodes without overlap and preserve intentional existing layout.
4. Point every edge at existing node IDs.
5. Serialize valid JSON and run the validation checklist below.

## Nodes

Every node requires <code>id</code>, <code>type</code>, <code>x</code>,
<code>y</code>, <code>width</code>, and <code>height</code>.

| Type | Required content | Purpose |
| --- | --- | --- |
| <code>text</code> | <code>text</code> | Markdown content |
| <code>file</code> | <code>file</code> | Vault file; optional <code>subpath</code> |
| <code>link</code> | <code>url</code> | External URL |
| <code>group</code> | none | Visual container; optional label/background |

Array order controls z-index: earlier nodes are behind later nodes. Coordinates
may be negative. Position is the top-left corner, x increases right, and y
increases down.

~~~json
{
  "id": "6f0ad84f44ce9c17",
  "type": "text",
  "x": 0,
  "y": 0,
  "width": 360,
  "height": 180,
  "text": "# Main idea\n\nDetails",
  "color": "5"
}
~~~

Use actual JSON newline escapes in text values. Do not double-escape them into
literal backslash-n text.

## Edges

Every edge requires <code>id</code>, <code>fromNode</code>, and
<code>toNode</code>. Optional sides are <code>top</code>, <code>right</code>,
<code>bottom</code>, or <code>left</code>. Optional ends are <code>none</code>
or <code>arrow</code>.

~~~json
{
  "id": "0123456789abcdef",
  "fromNode": "6f0ad84f44ce9c17",
  "fromSide": "right",
  "toNode": "a1b2c3d4e5f67890",
  "toSide": "left",
  "toEnd": "arrow",
  "label": "leads to"
}
~~~

## Colors and layout

A color is a hex string or preset <code>"1"</code> through
<code>"6"</code>. Presets deliberately do not define exact hex colors. Leave
50–100 px between nodes, 20–50 px padding inside groups, and align to a simple
grid when creating a new layout.

## Validation checklist

- JSON parses successfully.
- IDs are unique across nodes and edges.
- Every <code>fromNode</code> and <code>toNode</code> exists in
  <code>nodes</code>.
- Each node type has its required content field.
- Sides, ends, and colors use allowed values.
- Nodes do not unintentionally overlap and group children sit inside bounds.

Read [Examples](references/EXAMPLES.md) for complete connected and grouped
canvases.

## Attribution

Adapted from <code>kepano/obsidian-skills</code> at revision
<code>${OBSIDIAN_SKILLS_UPSTREAM_REVISION}</code>. See <code>LICENSE</code>.
`;

const JSON_CANVAS_EXAMPLES = String.raw`# JSON Canvas examples

## Connected notes

~~~json
{
  "nodes": [
    {
      "id": "8a9b0c1d2e3f4a5b",
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 300,
      "height": 140,
      "text": "# Main idea"
    },
    {
      "id": "1a2b3c4d5e6f7a8b",
      "type": "file",
      "x": 400,
      "y": 0,
      "width": 300,
      "height": 200,
      "file": "Notes/Supporting note.md",
      "subpath": "#Evidence"
    }
  ],
  "edges": [
    {
      "id": "3c4d5e6f7a8b9c0d",
      "fromNode": "8a9b0c1d2e3f4a5b",
      "fromSide": "right",
      "toNode": "1a2b3c4d5e6f7a8b",
      "toSide": "left",
      "label": "supported by"
    }
  ]
}
~~~

## Grouped board

~~~json
{
  "nodes": [
    {
      "id": "5e6f7a8b9c0d1e2f",
      "type": "group",
      "x": 0,
      "y": 0,
      "width": 320,
      "height": 500,
      "label": "In progress",
      "color": "3"
    },
    {
      "id": "8b9c0d1e2f3a4b5c",
      "type": "text",
      "x": 30,
      "y": 60,
      "width": 260,
      "height": 100,
      "text": "## Task\n\nImplement the feature"
    }
  ],
  "edges": []
}
~~~
`;

const LICENSE_FILE = { path: "LICENSE", content: UPSTREAM_LICENSE } as const;

const OBSIDIAN_MARKDOWN: BuiltinSkill = {
  name: "obsidian-markdown",
  version: MARKDOWN_SKILL_VERSION,
  // Claude passed every render-safety eval case without this skill, so it stays off for Claude only.
  // https://github.com/logancyang/obsidian-copilot/issues/3868
  defaultPreference: { disabledAgents: ["claude"] },
  skillMd: OBSIDIAN_MARKDOWN_SKILL_MD,
  files: [
    { path: "references/CALLOUTS.md", content: MARKDOWN_CALLOUTS_REFERENCE },
    { path: "references/EMBEDS.md", content: MARKDOWN_EMBEDS_REFERENCE },
    { path: "references/PROPERTIES.md", content: MARKDOWN_PROPERTIES_REFERENCE },
    LICENSE_FILE,
  ],
};

const OBSIDIAN_BASES: BuiltinSkill = {
  name: "obsidian-bases",
  version: FORMAT_SKILL_VERSION,
  defaultPreference: { disabledAgents: ["claude"] },
  skillMd: OBSIDIAN_BASES_SKILL_MD,
  files: [
    { path: "references/FUNCTIONS_REFERENCE.md", content: BASES_FUNCTIONS_REFERENCE },
    { path: "references/EXAMPLES.md", content: BASES_EXAMPLES },
    LICENSE_FILE,
  ],
};

const JSON_CANVAS: BuiltinSkill = {
  name: "json-canvas",
  version: FORMAT_SKILL_VERSION,
  defaultPreference: OPENCODE_ONLY,
  skillMd: JSON_CANVAS_SKILL_MD,
  files: [{ path: "references/EXAMPLES.md", content: JSON_CANVAS_EXAMPLES }, LICENSE_FILE],
};

export const OBSIDIAN_SKILLS: readonly BuiltinSkill[] = [
  OBSIDIAN_MARKDOWN,
  OBSIDIAN_BASES,
  JSON_CANVAS,
];
