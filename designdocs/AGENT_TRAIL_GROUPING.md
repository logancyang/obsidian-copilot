# Agent trail grouping

How the Agent Mode trail folds a turn's activity into readable units, and why
each rule is shaped the way it is. `src/agentMode/ui/agentTrail.ts` builds the
render tree; `src/agentMode/ui/activityGroups.ts` folds that tree into activity
groups.

## The problem

A turn's `AgentMessagePart[]` interleaves tool calls, reasoning, and prose. The
trail used to compact only **runs of consecutive same-`toolKey` tool calls**,
which almost never fires: the agent emits a `thought` between nearly every pair
of tool calls, and a thought breaks the run. The result is one row per tool call
plus one row per thought, and the turn's actual writing ends up buried under
them.

An earlier fix collapsed the whole trail once a turn ended. It was removed
because it hid content the user was mid-read — a visible-to-hidden transition
they never asked for — and because a turn's closing line ("done") is often less
informative than the explanation above it.

## The measurement

The rules below were validated by replaying 56 recorded Claude Agent SDK turns
(1,956 tool calls, 510 reasoning blocks) from the frame log through both the
shipping renderer and the proposed one. The metric is the **wall**: the longest
run of machine rows before the next piece of prose.

|                          | ships today | grouped |
| ------------------------ | ----------- | ------- |
| longest wall, worst turn | 21 rows     | 5       |
| turns with a wall over 5 | 19 of 56    | 0       |
| reasoning rows           | 510         | 90      |
| total rows               | 1,839       | 1,088   |

## What an activity group is

A maximal run of consecutive **tool calls and reasoning blocks**, folded into
one collapsed row summarizing the work: `Read 2 files, ran 12 commands, thought
for 51s`. A run of one member keeps its own row — a single `Read` gets no group
chrome.

### What breaks a run

- **Prose.** A `text` part always renders at full size, in place. This is what
  keeps a mid-turn explanation visible instead of buried under the closing line.
- **Sub-agent launches.** A delegation owns a nested trail and a report of its
  own, so it stays its own row rather than becoming a count inside someone
  else's summary. Costs 17 rows across the sample and raises the worst-case wall
  from 2 to 5.
- **Interactive tool calls** — `AskUserQuestion`, `ExitPlanMode`,
  `EnterPlanMode`. Folding a question the agent is waiting on would hide the
  thing the user has to act on.
- **Plan checklists.** Status, not work.

### What folds in

- **Reasoning**, as `thought for Xs` at the end of the line. This is the single
  largest win — larger than folding tool calls — because a thought sits between
  nearly every pair of tool calls.
- **Every tool family**, heterogeneously. Unlike the shipping compaction, a
  `Read` and a `Bash` in the same run fold into one row.

### How the line reads

The vocabulary is deliberately coarse — three families plus reasoning, named in
first-appearance order:

- **read** — `Read` / `NotebookRead` by vendor name, or the ACP
  `toolKind: "read"` fallback, so a backend that sends no vendor names still
  says `read 2 files`.
- **edit** — `Edit` / `MultiEdit` / `Write` / `NotebookEdit`, or
  `toolKind: "edit"`.
- **command** — everything else, no exceptions: shell commands, searches,
  fetches, skills, MCP calls, tools that do not exist yet.

`Read 2 files, edited 1 file, ran 5 commands, thought for 51s` is the longest
shape the line can take. An earlier revision named more families (searches,
fetches, skills), kept unregistered tools under their own name (`Design sync
×16`), and keyed MCP tools per server — which then needed a family cap with
`+N more` and verb dedup to stay readable. It was dropped: every new tool was
new phrasing surface, and the identity the coarse line gives up is one click
away in the expanded rows, which show each call's own summary. Calling a fetch
or an MCP call a "command" is a stretch that only lasts until the group is
opened — and a lone call never enters a group at all, so it keeps its precise
row.

Reasoning duration is **not** derivable from the parts — `kind: "thought"`
carries no timestamps. The caller measures it live and passes `thinkingMs` to
`summarizeActivity`, the same way `ReasoningBlock` measures its own timer today.

### Measured at pane width

Rendered in a real leaf pane, a three-family line plus `thought for Xs` runs
about 59 characters and needs ~377px. A chat leaf gives the line 228px at 300px
wide and 328px at 400px, so roughly 36–51 characters fit and the tail truncates;
it only fits whole at 600px. Truncation is graceful — the families the agent
spent the most on are named first and the full detail is one click away — but
the cap of three families is tuned for row count, not for pane width. Narrowing
it, or moving the reasoning duration off the line, is unvalidated: both change
what the replay measured.

## Interaction invariants

These are what make grouping safe where the removed auto-fold was not:

1. **A group is born collapsed and never closes itself.** There is no
   expanded-to-collapsed transition. Nothing the user is reading disappears,
   because it was never expanded to begin with.
2. **User expansion is sticky.** Once opened, a group stays open for the life of
   the session, including as new members stream into it.
3. **Motion lives only at the live edge.** While a group has work in flight it
   renders one transient row showing the current step, which swaps as the agent
   moves on and retires when the group goes quiet. One row changing, never a
   list collapsing.

Invariant 2 requires a group identity that survives streaming. Groups are
identified by their **ordinal within the trail**: parts are append-only, so a
group's position never changes once it exists, and appending a member does not
change its id. Keying React state by array index instead would remount an open
group whenever the node list changed shape.

## What grouping replaced

Activity groups subsume the homogeneous `aggregate` render node, so the
compaction branch of `foldNodes`, `toolKeyFor`, `AggregateCard.tsx`, and
`ToolSummary.aggregate` with its per-family implementations are all gone.
`buildAgentTrail` is now purely structural — one node per part, sub-agents
absorbing their children — and every run of peers is pooled by
`foldActivityGroups` a layer up.

`AgentTrailView` owns what a group cannot own itself: `useTrailExpansion` holds
open/closed state above the node list (see invariant 2), and each group gets its
own `useThinkingClock` via a per-group child component, because the trail's
node list is a loop and hooks are not.
