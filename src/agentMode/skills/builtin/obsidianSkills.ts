import type { BuiltinSkill } from "./builtinSkills";

/** Pinned source revision for the adapted Obsidian skills. */
export const OBSIDIAN_SKILLS_UPSTREAM_REVISION = "a1dc48e68138490d522c04cbf5822214c6eb1202";

const ENABLED_AGENTS = ["claude", "codex", "opencode"] as const;
const FORMAT_SKILL_VERSION = 1;
const OBSIDIAN_CLI_VERSION = 2;

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
description: Create and edit Obsidian-specific Markdown syntax, including wikilinks, embeds, block references, callouts, properties, tags, and comments. Use for Obsidian notes when these extensions matter; ordinary Markdown is assumed knowledge.
license: MIT
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${FORMAT_SKILL_VERSION}"
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

Put a block ID on its own line after a list or quote block.

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
| Link | <code>related: "[[Other Note]]"</code> |

Obsidian reserves <code>tags</code>, <code>aliases</code>, and
<code>cssclasses</code> for their built-in behaviors. Tags may contain letters,
numbers (not as the first character), underscores, hyphens, and forward slashes.
Prefer YAML lists when a property naturally has multiple values.
`;

const OBSIDIAN_BASES_SKILL_MD = String.raw`---
name: obsidian-bases
description: Create and edit Obsidian Bases (.base files) with valid YAML schemas, filters, formulas, properties, summaries, and views. Use for database-like Obsidian views or when the user mentions Bases, .base files, table/card/list views, filters, formulas, or summaries.
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
  days_until_due: 'if(due, (date(due) - today()).days, "")'

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
      - formula.days_until_due
    groupBy:
      property: status
      direction: ASC
    summaries:
      formula.days_until_due: Average
~~~

Views may be <code>table</code>, <code>cards</code>, or <code>list</code>.
A <code>map</code> view depends on compatible map support.

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
  calling number methods such as <code>.round()</code>.
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
- Embedded view names match exactly: <code>![[My Base.base#View Name]]</code>.

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
  days_until_due: 'if(due, (date(due) - today()).days, "")'
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
description: Create and edit JSON Canvas (.canvas) files with valid nodes, edges, groups, colors, layout, IDs, and referential integrity. Use for Obsidian Canvas files, visual maps, flowcharts, project boards, or any request involving the JSON Canvas format.
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

const OBSIDIAN_CLI_SKILL_MD = String.raw`---
name: obsidian-cli
description: Use the official Obsidian CLI when a task needs Obsidian's running app, index, configured features, command registry, or developer runtime. Use for currently open notes and tabs, workspace state, daily notes, typed properties, tasks, links/backlinks, Bases queries, template resolution, link-aware moves, plugin commands, and plugin/theme debugging; do not use it for ordinary filesystem operations.
license: MIT
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${OBSIDIAN_CLI_VERSION}"
  copilot-upstream-revision: "${OBSIDIAN_SKILLS_UPSTREAM_REVISION}"
---

# Obsidian CLI

Use the CLI only for behavior that depends on Obsidian's running application,
indexes, settings, command registry, or developer runtime. Use normal shell
filesystem tools for ordinary file reads, writes, directory listing, and text
search.

## Capability probe and fallback

Copilot exposes the terminal-capable executable from the running Obsidian
installation as <code>COPILOT_OBSIDIAN_CLI</code> when it can resolve one.
Prefer that exact path over <code>obsidian</code> from <code>PATH</code>, and
always invoke it as a quoted executable rather than constructing a command
string. Before relying on the CLI, probe it using the active shell:

~~~bash
obsidian_cli="${"${COPILOT_OBSIDIAN_CLI:-obsidian}"}"
"$obsidian_cli" version
~~~

~~~powershell
$obsidianCli = if ($env:COPILOT_OBSIDIAN_CLI) { $env:COPILOT_OBSIDIAN_CLI } else { "obsidian" }
& $obsidianCli version
~~~

A command being present on PATH is not sufficient: the probe must exit
successfully. Use the selected executable in place of <code>obsidian</code> in
the examples below, resolving it again in a later shell call when necessary. If
the probe fails, continue with ordinary filesystem tools where they can satisfy
the request. Briefly tell the user only when the missing runtime capability
matters. Do not install Obsidian, change PATH, register the CLI, or raise the
plugin's minimum Obsidian version on the user's behalf.

The CLI requires a compatible Obsidian installer and a running app. Commands
can differ by version, so inspect live help before using a command whose syntax
is not already established:

~~~bash
obsidian help <command>
~~~

When a request truly needs the runtime capability and the probe fails, tell the
user to open Obsidian and enable **Settings → General → Command line
interface** using a compatible installer. Leave registration and any platform
repair steps to the user.

## Target precisely

Put <code>vault=&lt;name-or-id&gt;</code> before the command whenever the vault is
known. Use <code>path=</code> for an exact vault-relative path. Use
<code>file=</code> only when Obsidian's wikilink-style name resolution is
desired. Do not rely on the active vault or active file when a precise target
is available.

~~~bash
obsidian vault="My Vault" backlinks path="Projects/Plan.md" format=json
~~~

Parameters use <code>name=value</code>; boolean flags have no value. Quote
values containing spaces or shell-special characters.

## High-value indexed and configured operations

Use live help for exact parameters, then prefer these families when they add
meaning beyond raw files:

- Configured daily notes: <code>daily</code>, <code>daily:path</code>,
  <code>daily:read</code>, <code>daily:append</code>,
  <code>daily:prepend</code>.
- Typed properties and parsed metadata: <code>properties</code>,
  <code>property:read</code>, <code>property:set</code>,
  <code>property:remove</code>, <code>tags</code>, <code>tag</code>, and
  <code>aliases</code>. Supply a <code>type=</code> to
  <code>property:set</code> when the property is not plain text.
- Tasks: <code>tasks</code> for indexed listing and <code>task</code> with a
  stable <code>ref=path:line</code> or exact file/line for status changes.
- Link graph: <code>backlinks</code>, <code>links</code>,
  <code>unresolved</code>, <code>orphans</code>, and <code>deadends</code>.
- Bases: <code>bases</code>, <code>base:views</code>, and
  <code>base:query</code>. Prefer <code>format=json</code> for structured agent
  consumption.
- Templates: <code>templates</code> and <code>template:read ... resolve</code>
  when configured template resolution is required.
- Live workspace state: <code>tabs ids</code> lists the currently open tabs and
  their IDs, while <code>workspace ids</code> shows the workspace tree and its
  item IDs.
- Link-aware refactors: <code>move</code> and <code>rename</code> when the vault
  setting to update internal links should be honored.

### Inspect open notes

When the user asks about notes currently open in Obsidian:

~~~bash
obsidian vault="My Vault" tabs ids
obsidian vault="My Vault" workspace ids
~~~

Use <code>tabs ids</code> as the source of truth for open tabs. Keep entries
verbatim and classify them only when the output provides enough evidence:

- a Markdown note has an explicit vault path ending in <code>.md</code>
  (case-insensitive)
- another file-backed tab has an explicit vault path with a different extension
- a non-file view, such as search, graph, settings, or a plugin view, has no
  vault path

Do not infer a path from a display title, view type, or tab ID, and do not
discard entries that cannot be classified. For a request about open notes,
extract the Markdown paths while retaining the other tabs as workspace context.
Use <code>workspace ids</code> when tab groups or workspace hierarchy matter. Do
not substitute <code>recents</code>, which includes files that are no longer open.

If the tab output does not expose paths or view types clearly, correlate its tab
IDs with this read-only, structured workspace query:

~~~bash
obsidian vault="My Vault" eval code='JSON.stringify((()=>{const tabs=[];const active=app.workspace.getMostRecentLeaf();app.workspace.iterateAllLeaves(leaf=>{const path=leaf.view.file?.path??null;tabs.push({id:leaf.id,title:leaf.getDisplayText(),viewType:leaf.view.getViewType(),path,kind:path===null?"view":path.toLowerCase().endsWith(".md")?"markdown":"file",active:leaf===active})});return tabs})())'
~~~

The workspace query also returns sidebar and floating leaves. Only call an entry
an open tab when its ID appears in <code>tabs ids</code>; retain query-only
entries separately as workspace context. Preserve tab entries that have no
matching workspace entry instead of guessing their identity.

If the user asks for the single currently focused note and the tab output does
not identify it, use a read-only app query:

~~~bash
obsidian vault="My Vault" eval code="app.workspace.getMostRecentLeaf()?.view.file?.path ?? ''"
~~~

Use normal filesystem tools only for explicit paths returned by Obsidian, and
choose a reader appropriate to the file type. Do not read every open note when
paths or titles alone answer the request.

## Obsidian and plugin commands

<code>commands</code> lists registered command IDs, including commands provided
by plugins. Filter by an ID prefix, then execute the selected command with
<code>command id=&lt;command-id&gt;</code>. Never guess a command ID when it can be
discovered. Do not execute a discovered command whose effect is prohibited by
the host-session rules below.

~~~bash
obsidian vault="My Vault" commands filter="my-plugin:"
obsidian vault="My Vault" command id="my-plugin:run-action"
~~~

## Plugin and theme development

Use the CLI as the first choice for runtime verification after the normal build
or test command has produced artifacts:

1. For a plugin other than Copilot, reload with
   <code>plugin:reload id=&lt;plugin-id&gt;</code> when needed. Never reload the
   Copilot plugin from a Copilot-hosted agent session.
2. Inspect <code>dev:errors</code> and <code>dev:console level=error</code>.
3. Verify UI state with <code>dev:screenshot path=...</code>,
   <code>dev:dom selector=...</code>, and <code>dev:css selector=...</code>.
4. Use <code>dev:mobile on</code> only when mobile emulation is relevant, and
   turn it off afterward.

Read-only <code>eval</code> and <code>dev:cdp</code> queries are appropriate for
state that the documented inspection commands cannot expose. Keep expressions
small and return serializable values. Treat any expression or CDP call that
mutates application state as a risky operation requiring explicit user intent.

## Preserve the host session

Never reload or restart the Obsidian app or window from an agent session. Never
reload, disable, or uninstall the Copilot plugin that is hosting the agent. In
particular, do not use:

- any CLI command that reloads or restarts the app, window, or renderer
- any plugin reload, disable, or uninstall operation targeting Copilot
- any restricted-mode change
- a command ID, JavaScript expression, or CDP call that performs an equivalent
  app, window, renderer, or Copilot-plugin teardown

These actions terminate the in-flight agent and can discard its work. This is a
hard prohibition, not a confirmation-gated operation. If verification requires
one, finish all non-destructive checks and tell the user to perform the reload
manually after the agent session has ended.

## Risky operations require explicit intent

Do not perform the following merely because they are available:

- permanent deletion
- local-history or Sync restoration
- publishing or unpublishing
- plugin or theme installation/uninstallation
- mutating JavaScript evaluation or CDP calls

Confirm that the user's request clearly authorizes the exact target and effect.
Prefer reversible variants, such as trash-backed deletion, when they satisfy
the request. Explicit intent does not override the host-session prohibition
above.

## Exclusions

Do not teach or use the TUI, clipboard output, undocumented flags, platform
registration repairs, or CLI equivalents of generic filesystem operations in
this skill.

## Attribution

Adapted from <code>kepano/obsidian-skills</code> at revision
<code>${OBSIDIAN_SKILLS_UPSTREAM_REVISION}</code>. See <code>LICENSE</code>.
`;

const LICENSE_FILE = { path: "LICENSE", content: UPSTREAM_LICENSE } as const;

const OBSIDIAN_MARKDOWN: BuiltinSkill = {
  name: "obsidian-markdown",
  version: FORMAT_SKILL_VERSION,
  enabledAgents: ENABLED_AGENTS,
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
  enabledAgents: ENABLED_AGENTS,
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
  enabledAgents: ENABLED_AGENTS,
  skillMd: JSON_CANVAS_SKILL_MD,
  files: [{ path: "references/EXAMPLES.md", content: JSON_CANVAS_EXAMPLES }, LICENSE_FILE],
};

const OBSIDIAN_CLI: BuiltinSkill = {
  name: "obsidian-cli",
  version: OBSIDIAN_CLI_VERSION,
  enabledAgents: ENABLED_AGENTS,
  skillMd: OBSIDIAN_CLI_SKILL_MD,
  files: [LICENSE_FILE],
};

/** Obsidian-native skills seeded for every supported Agent Mode backend. */
export const OBSIDIAN_SKILLS: readonly BuiltinSkill[] = [
  OBSIDIAN_MARKDOWN,
  OBSIDIAN_BASES,
  JSON_CANVAS,
  OBSIDIAN_CLI,
];
