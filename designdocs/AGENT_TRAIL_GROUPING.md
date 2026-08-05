# Agent trail grouping

How the Agent Mode trail folds a turn's activity into readable units, and why
each rule is shaped the way it is. `src/agentMode/ui/agentTrail.ts` builds the
render tree; `src/agentMode/ui/activityGroups.ts` folds that tree into activity
groups.

## The problem

A turn's `AgentMessagePart[]` interleaves tool calls, reasoning, and prose. The
shipping trail compacts only **runs of consecutive same-`toolKey` tool calls**,
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
one collapsed row summarizing the work: `Ran 1 skill, 12 commands, thought for
51s`. A run of one member keeps its own row — a single `Read` gets no group
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

Families are named in first-appearance order, capped at three, then `+N more`.
Two rules came out of the replay:

- **Unregistered tools keep their own identity.** Bucketing everything
  unrecognized into "tool calls" produced lines like `Made 16 tool calls` on
  real sessions, which lean heavily on tools with no built-in summary. They key
  on their own name instead: `Design sync ×16`. MCP tools key per server.
- **A verb that repeats the previous phrase's is dropped.** `Ran 1 skill, ran 12
commands` reads as two facts; `Ran 1 skill, 12 commands` reads as one.

Reasoning duration is **not** derivable from the parts — `kind: "thought"`
carries no timestamps. The caller measures it live and passes `thinkingMs` to
`summarizeActivity`, the same way `ReasoningBlock` measures its own timer today.

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

## Planned deletions

Activity groups subsume `AggregateCard` and the homogeneous `aggregate` render
node. When grouping is wired into `AgentTrailView`, all three of these go:

- the `aggregate` branch of `foldNodes` in `agentTrail.ts`
- `AggregateCard.tsx`
- `ToolSummary.aggregate` and its ~20 per-family implementations in
  `toolSummaries.ts`

Until then `aggregate` nodes still exist, so `foldActivityGroups` flattens them
back into their member parts. That branch is deleted along with the rest.
