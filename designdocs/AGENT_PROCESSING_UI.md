# Agent Processing UI — Design Doc

## Context

Agent mode streams a mix of events while a turn is in flight: tool calls, tool results, model reasoning tokens, sub-agent invocations, plan proposals, and prose deltas. The UI has to make this trail **scannable, verifiable, and unobtrusive** for knowledge workers — without devolving into a debug log.

Today the chat surface renders a flat list of tool-call cards, prose, and a (legacy) reasoning block. It works for simple turns but breaks down on three patterns we now hit regularly:

1. **Burst tool calls** — the agent fires 5 consecutive `Edit`s and floods the message with near-identical cards.
2. **Sub-agents** — Claude Code's Task tool spawns a child agent whose tool calls and reasoning currently render as flat top-level entries, indistinguishable from the parent's work.
3. **Reasoning streams** — agent-mode `thought` parts exist in the data model but aren't hooked to the existing `AgentReasoningBlock` UI, so reasoning either disappears or renders as a static `<details>` block.

This doc proposes a unified component model that handles all three, and the visual rules that make it readable.

## Design principles

1. **What was consulted matters more than how the model thought.** Tool calls are the primary signal. Reasoning is secondary, collapsed by default after streaming.
2. **One visual rhythm.** Every action — tool, sub-agent, reasoning — follows the same `icon · verb · target · outcome` pattern, so the eye learns to scan once.
3. **Progressive disclosure.** Default = one dense line. Expand for details. Re-expand for raw payloads. Never dump full tool results inline.
4. **Verifiable.** Every claim in the prose answer must be traceable to a card; every card must show _which note / URL / line range_ it touched.
5. **Compact > complete.** A 5-action turn = 5 lines, not 5 paragraphs. Prefer aggregation (one `Edited 5 notes` card) over enumeration when actions are homogeneous.
6. **Don't invent abstractions over the data model.** The backend already emits tool calls, reasoning, and parent-child links. The UI's job is to render them well, not to introduce a separate "Chain of Thought" or "Task" layer on top.

## Component taxonomy

We collapse the four Vercel SDK concepts (Reasoning, Tool, Task, Chain of Thought) into **two render primitives**:

| Primitive           | Renders                                                                             | Source                                                          |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Action card**     | A tool call, an aggregate of consecutive same-tool calls, OR a sub-agent invocation | `AgentMessagePart.tool_call` (with optional `parentToolCallId`) |
| **Reasoning block** | The model's internal thinking tokens                                                | `AgentMessagePart.thought`                                      |

Sub-agents reuse the action-card primitive — they're just an action whose "result" is a nested trail of more action cards. **No separate `Task` or `Chain of Thought` component.**

## Action card

### Anatomy (collapsed)

```
┌─────────────────────────────────────────────────────┐
│ 🔍 Searched web · "jazz piano voicings"      ✓  ⌄ │
│    5 results · 1.2s                                 │
└─────────────────────────────────────────────────────┘
```

- **Icon** — tool family (search, read, edit, fetch, vault, agent, time, …)
- **Verb · target** — past-tense action + the thing acted on
- **Outcome line** — small, muted: count + duration
- **Status** — `⟳` running, `✓` done, `⚠` failed, `∅` empty result
- **Affordance** — `⌄` to expand

### Tool-aware summaries

The collapsed line speaks the user's language per tool. Same shape, tool-specific outcome:

```
📄 Read  music-theory.md · lines 10–48                  ✓
🗂️ Searched vault · "scales" · 12 matches               ✓
🔗 Fetched  pianogroove.com/voicings                    ✓
✏️ Edited  practice-log.md · +12 / −0 lines             ✓
🧠 Indexed 47 notes · jazz folder                       ✓
🕒 Time     "what day is today"                         ✓
```

### Expanded view

Shows **inputs** (so the user can verify the agent searched what they'd expect) and **outputs** in cited form (clickable note paths and URLs). Full result body is _not_ dumped — there's a second-level expand for the raw payload when needed.

```
┌─────────────────────────────────────────────────────┐
│ 🔍 Searched web · "jazz piano voicings"      ✓  ⌃ │
│    5 results · 1.2s                                 │
│  ─────────────────────────────────────────────────  │
│  Query: jazz piano voicings                         │
│                                                      │
│  Results:                                            │
│   1. Jazz Piano Voicings — pianogroove.com  ↗     │
│   2. Modern Jazz Voicings — open-studio.com ↗     │
│   3. Rootless Voicings Guide — jazzwise.com ↗     │
│   4. ...                                             │
└─────────────────────────────────────────────────────┘
```

### States

```
⟳  Searching web · "jazz piano voicings"…             (running, animated)
✓  Searched web · "jazz piano voicings" · 5 results   (done)
⚠  Search failed · network error             [retry]  (error)
∅  Read note · daily/2024-03-15.md · empty            (degenerate ok)
```

Empty results render explicitly — knowledge workers care about negative findings ("no, you don't have notes on this").

## Compaction (consecutive tool calls)

### Rule

At render time, fold a run of N ≥ 2 cards into a single aggregate when:

- **Same tool type** (all `Edit`, all `Read`, all `WebSearch`)
- **Strictly consecutive in the part stream** — no intervening tool of a different type, no streamed prose, no `thought` part between them
- **Same nesting level** — never compact across a sub-agent boundary

No fancier heuristics (no "detect read-edit cycles", no topic clustering). The backend may also pass an explicit `group_id`/`batch_id` in `_meta` to force-group; the UI honors it but doesn't depend on it.

### Aggregate card

The collapsed view shows a tool-aware aggregate stat, _not_ the first item:

```
✏️ Edited 5 notes · +47 / −12 lines                   ✓  ⌄
📄 Read 3 notes · 4.5k tokens                         ✓  ⌄
🔍 Searched web · 3 queries · 17 unique results       ✓  ⌄
🗂️ Searched vault · 4 queries · 28 matches            ✓  ⌄
```

Mixed status surfaces in the line: `✏️ Edited 5 notes · 4 ✓ · 1 ⚠`.

### Expanded aggregate

Per-item rows with their own micro-summary; each row is itself expandable to show the underlying card detail:

```
✏️ Edited 5 notes · +47 / −12 lines                   ✓  ⌃
   ─────────────────────────────────────────────────
   ✏️ practice-log.md       · +12 / −0
   ✏️ jazz/voicings.md      · +18 / −8
   ✏️ jazz/scales.md        · +8 / −2
   ✏️ daily/2024-03-15.md   · +6 / −0
   ✏️ ⚠ archive/old.md      · failed (file locked)
```

### What we lose

Strict per-call timestamps in the collapsed view. Acceptable: the expanded view restores everything, and 95% of the value is the aggregate stat.

## Sub-agent nesting

Sub-agents use the **same action-card primitive** with a different shape: the child trail lives inside the expanded card. They are identified by `parentToolCallId` on child tool parts (already extracted in `backendMeta.ts`; needs to be propagated into `AgentMessagePart`).

### Collapsed parent card

```
🤖 research-agent · "find all jazz voicings notes"   ✓  ⌄
   3 tools · 1 reasoning · 4.2s · 7 matches found
```

- Sub-agent identity (`research-agent`, `code-reviewer`, `explore`) is first-class — surfaced in the title.
- Outcome line summarizes both _the work_ (tool/reasoning counts, duration) and _the result_ (whatever the sub-agent returned).

### Expanded parent card — full nested trail

```
🤖 research-agent · "find all jazz voicings notes"   ✓  ⌃
   3 tools · 1 reasoning · 4.2s
   ┃
   ┃  🗂️ Searched vault · "voicings" · 7 matches      ✓
   ┃  💭 Reasoning · 250 tokens                       ⌄
   ┃  📄 Read voicings.md · 1.2k                      ✓
   ┃  📄 Read 2024-02-piano.md · 800                  ✓
   ┃  ─────────────────────────────────────────────
   ┃  Returned: 7 notes referencing voicings,
   ┃  primarily under jazz/ and practice/
```

A vertical guide rail (`┃`) and indentation make nesting unambiguous. Child cards are the _same components_ as top-level cards, just rendered inside a parent. Compaction applies inside the nest the same way (5 sub-agent edits → one aggregate inside the parent).

### Streaming behavior

Default for all sub-agents:

```
🤖 research-agent · "find all jazz voicings notes"   ⟳
   2 tools so far…
```

Collapsed parent shows running counter; expanding lets the user watch live. (Auto-expand-while-running, auto-collapse-on-done is a reasonable v2 enhancement for long primary sub-agents — defer until users ask for it.)

### Recursion

Cap visible nesting at 2–3 levels. Beyond the cap, deeper sub-agents render as collapsed `🤖 …` cards inside the parent — still clickable to drill in, but indentation stops growing. Without a cap, deep traces become unreadable horizontal noise.

### Sub-agent textual return values

Some sub-agents return prose. Render it as a quoted block at the bottom of the expanded parent — keeps the parent card self-contained, no scroll-elsewhere required:

```
🤖 code-reviewer · "review auth changes"             ✓  ⌃
   5 tools · 2 reasoning · 12s
   ┃  ...child cards...
   ┃  ─────────────────────────────────────────────
   ┃  > The migration is safe under concurrent
   ┃  > writes. The backfill default handles…
```

## Reasoning block

Renders the model's `thought` parts. Visually distinct from action cards — lower weight, no border, muted text — to signal "secondary information."

```
💭 Reasoning · 250 tokens · 1.8s                       ⌄
```

### Streaming

While streaming: a small pulse + live token counter, no auto-expand. (Vercel's auto-open-during-stream pattern is distracting in a chat UI; users can click to watch live if they want.)

### After streaming

Collapsed by default. Click to read. The block can show either raw thinking text or, if the backend emits structured reasoning steps, a step list — but the same component handles both.

## Composition with the chat message

```
You ▸ summarize what I've written about jazz voicings

Assistant
  🗂️ Searched vault · "voicings" · 7 matches            ✓
  💭 Reasoning · 250 tokens                              ⌄
  📄 Read 2 notes · 2.0k tokens                         ✓
  ─────────────────────────────────────────────────────
  Across your notes, you've explored three voicing
  families: rootless (Bill Evans style), quartal
  (McCoy Tyner), and shell voicings…

  [Sources: voicings.md, 2024-02-piano.md]
```

Action cards and reasoning blocks form a header strip above the prose answer. Citations at the bottom link prose claims back to specific notes — they tie the cards (process) to the prose (result).

## Edge cases

- **Parallel tool calls** (agent fires 3 reads in one turn): order chronologically by completion. If they're same-tool, compaction folds them naturally.
- **Mid-trail failure**: parent stays `⚠`, child cards remain visible — the partial trail is the most useful debugging artifact.
- **Empty results**: surface explicitly (`∅ Searched vault · 0 matches`). Don't collapse to "Done."
- **Permission-gated tools** (e.g., `ExitPlanMode` plan proposals): existing `PlanProposalCard` handles this — keep it as a specialized action-card variant, not a separate primitive.
- **Backend group hint**: an explicit `group_id` in `_meta` overrides the consecutive-same-tool heuristic, letting agent authors mark logically grouped operations even when interleaved.
- **Tool that produces no output** (fire-and-forget): show with `✓` and an outcome line like "no return value."

## Current state & gaps

References from `zero/acp-test`:

| Area                  | File                                                                                 | Status                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Streaming events      | `src/agentMode/acp/AcpBackendProcess.ts`, `src/agentMode/session/AgentSession.ts`    | ✅ tool_call / tool_call_update / agent_message_chunk / thought / plan all flowing                                       |
| Tool card UI          | `src/agentMode/ui/AgentToolCall.tsx`                                                 | ✅ renders `tool_call` / `thought` / `plan`, status icons, diff view, file annotations                                   |
| Plan proposal         | `src/agentMode/ui/PlanProposalCard.tsx` (commit `fa7a65d`)                           | ✅ specialized card, permission flow, preview view                                                                       |
| Backend meta          | `src/agentMode/session/backendMeta.ts`, `src/agentMode/backends/claude-code/meta.ts` | ✅ `parentToolCallId`, `vendorToolName`, `isPlanProposal` extracted                                                      |
| Reasoning UI          | `src/components/chat-components/AgentReasoningBlock.tsx`                             | ⚠ exists for legacy chat, **not wired** to agent-mode `thought` parts                                                    |
| **Sub-agent nesting** | —                                                                                    | ❌ `AgentMessagePart.tool_call` lacks a `parentToolCallId` field; tool parts are flattened in the store; no UI hierarchy |
| **Tool compaction**   | —                                                                                    | ❌ no aggregation/grouping logic; consecutive same-tool calls render as N separate cards                                 |
| **Aggregate stats**   | —                                                                                    | ❌ no tool-aware summary helpers (line deltas, token totals, unique-result counts)                                       |

### Implementation pointers (high-level — not a step-by-step plan)

- **Data model**: add `parentToolCallId?: string` to `AgentMessagePart.tool_call` and propagate it from `backendMeta.ts` into the store. This is the foundation for both sub-agent nesting and ensuring compaction never crosses a parent/child boundary.
- **Render-time grouping**: introduce a pure function that takes the flat `AgentMessagePart[]` for an assistant turn and returns a tree of render nodes — `Card | AggregateCard | SubAgentCard | ReasoningBlock`. Compaction is a fold over consecutive same-tool peers at each level. Keep this layer purely derivational so the store stays flat.
- **Tool-aware summary registry**: a small registry mapping tool name → `(parts) => { line: string, stat: string }`. Each tool family (read, edit, search, fetch, vault-search, …) contributes one entry. Falls back to a generic summary for unknown tools.
- **Reasoning hookup**: route agent-mode `thought` parts through `AgentReasoningBlock`. The legacy block already supports streaming + collapse-on-done; the gap is wiring, not new UI.
- **Sub-agent component**: a thin variant of `AgentToolCall` that, when expanded, renders its child render tree (recursively reusing the same renderer). Indentation + a left guide rail handles the visual.

## Verification

- **Unit**: cover the grouping/aggregation function with cases for (a) heterogeneous runs (no grouping), (b) consecutive same-tool, (c) interleaved with reasoning (no grouping), (d) sub-agent boundary (no grouping across), (e) explicit `group_id`.
- **Visual / live**: drive each case end-to-end via agent mode in Obsidian — single tool, 5-edit burst, sub-agent invocation (e.g., `Task` from Claude Code backend), reasoning-only turn, mixed turn. Use the Obsidian CLI (`obsidian dev:debug` / `dev:console`) to confirm the underlying parts and screenshot the rendered cards.
- **Regression**: existing flat-card layouts still render correctly when no nesting / grouping applies (single tool calls, plan proposals).

## Open questions

- Should the reasoning block live **inline among action cards** (as in the composition mockup), or always **at the top** of the assistant turn? Inline preserves chronological truth; top is calmer visually. Recommend inline; flag for review.
- Auto-collapse threshold for sub-agents — collapse on done always, or only when child count ≥ 3? Recommend always-collapse for consistency.
- Tool icon source — Lucide set, custom set, or per-backend overrides? Decide before implementation since it touches every card.
