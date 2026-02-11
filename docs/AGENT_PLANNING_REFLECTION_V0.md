# Agent Planning + Reflection Visibility (v0)

**Date:** 2026-02-10  
**Status:** Draft  
**Scope:** Autonomous Agent (`AutonomousAgentChainRunner`) only

## 1. Problem Statement

The current autonomous agent loop is functional and simple, but it has two gaps:

1. No explicit machine-readable plan state in the ReAct loop.
2. Reasoning visibility is mostly tool-call/result summaries, with weak iteration-level reflection.

Today, planning is implicit in model text and tool order. The UI (`AgentReasoningBlock`) only sees serialized step strings, so users cannot clearly track "what is the current plan" vs "what just happened".

## 2. Current Baseline (What We Have)

- ReAct loop with native tool calling in `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`.
- Reasoning block state/serialization in `src/LLMProviders/chainRunner/utils/AgentReasoningState.ts`.
- Reasoning UI rendering in `src/components/chat-components/AgentReasoningBlock.tsx` and parsing in `src/components/chat-components/ChatSingleMessage.tsx`.
- Tool registry and metadata model in `src/tools/ToolRegistry.ts` and `src/tools/builtinTools.ts`.

This is already a solid base for a minimal planner because:

- The loop already supports iterative tool decisions.
- The reasoning block already supports rolling vs full history.
- Tools are already typed with Zod and routed through one registry.

## 3. Goals

1. Add a minimal planning primitive (`write_todos`) that fits the existing sequential ReAct loop.
2. Improve per-iteration reasoning visibility without exposing chain-of-thought.
3. Keep the implementation robust with minimal new state.
4. Prepare a clean extension point for future subagents and context encapsulation.

## 4. Non-Goals (v0)

1. No multi-agent orchestration in this phase.
2. No persistent cross-turn planner memory.
3. No complex planner DAG or dependency graph.
4. No major UI rewrite of Reasoning Block.

## 5. v0 Design Overview

### 5.1 Add a Minimal Planner Tool: `write_todos`

Introduce a lightweight built-in tool that updates the agent's execution checklist.

Tool semantics:

- Input is the full current todo snapshot (replace semantics, not patch semantics).
- Output is a compact structured acknowledgement.
- No file I/O, no vault mutation, no side effects outside the in-memory run state.

Example schema:

```ts
const writeTodosSchema = z.object({
  todos: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        content: z.string().min(1).max(140),
        status: z.enum(["pending", "in_progress", "completed"]),
      })
    )
    .min(1)
    .max(8),
  focus: z.string().max(40).optional(),
  note: z.string().max(200).optional(),
});
```

Example result payload:

```json
{
  "ok": true,
  "revision": 3,
  "todoCount": 4,
  "inProgress": "read_note_context"
}
```

Why replace semantics:

- Easier for model to reason about.
- Deterministic state transitions.
- No merge/conflict logic in runner.

### 5.2 ReAct Loop Integration (Minimal Changes)

In `runReActLoop`:

- Keep one loop and one tool execution path.
- Special-case `write_todos` before normal tool execution.
- Convert planner updates into reasoning events and a compact `ToolMessage` acknowledgement.

Pseudo-flow:

1. Model returns `tool_calls`.
2. If call is `write_todos`, apply/update in-memory planner state.
3. Emit reasoning step(s) with `[Plan]` prefix.
4. Push tool result message so model can continue.
5. Continue loop unchanged for normal tools.

Guardrails:

- Max 2 consecutive planner-only iterations.
- If planner loops, return tool error: `"planner_overuse_execute_next_step"`.
- If planner args invalid, return schema error and continue loop.

### 5.3 Better Reflection Visibility in Existing Reasoning Block

Keep the existing component but make steps more legible by phase-tagging events.

Step tags (string prefix only, no UI rewrite required):

- `[Plan]` todo updates and step ordering
- `[Act]` tool call intent
- `[Obs]` tool result summary
- `[Reflect]` model's concise iteration reflection

Implementation detail:

- Reuse current `addReasoningStep` and `allReasoningSteps`.
- Add small extraction helper for reflection text from `AIMessage.content` per iteration.
- Enforce short reflection summaries (single sentence, capped length).

This gives better visibility immediately with minimal parser/rendering changes.

### 5.4 Prompting Updates

Add tool guidance for `write_todos` via tool metadata and agent prompt section.

Rules:

1. Use `write_todos` for multi-step tasks (>=2 meaningful actions).
2. First planner call should happen before the first expensive external tool when task is non-trivial.
3. Keep todos short and action-oriented.
4. Update statuses as execution progresses.
5. Do not repeatedly rewrite unchanged todos.

## 6. Data Model (v0 Sidecar State)

Add in-memory runtime state in `AutonomousAgentChainRunner`:

```ts
interface PlannerState {
  revision: number;
  todos: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>;
  focus?: string;
  updatedAt: number;
}

interface ReasoningEvent {
  phase: "plan" | "act" | "obs" | "reflect";
  summary: string;
  iteration: number;
  timestamp: number;
}
```

No persistence changes are required for v0. Existing chat persistence already strips reasoning markers.

## 7. Extensibility Path: Context Capsule for Future Subagents

To support near-future subagents without redesigning the loop, add one abstraction now:

```ts
interface ContextCapsule {
  goal: string;
  planSnapshot?: PlannerState;
  keyFindings: string[];
  artifacts: Array<{ type: string; ref: string; summary: string }>;
  nextActions?: string[];
}
```

v0 usage:

- Single agent creates this in-memory as a byproduct (optional, debug-only).

Future subagent usage:

- Parent agent passes a scoped goal.
- Subagent returns only a compact `ContextCapsule` (not full transcript).
- Parent injects capsule summary into next decision turn as tool result.

This keeps context encapsulated and token usage bounded.

## 8. Minimal File-Level Change Plan

1. Add `src/tools/PlannerTools.ts` with `write_todos` tool.
2. Register tool in `src/tools/builtinTools.ts`.
3. Update `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`:
   - planner sidecar state
   - special handling for `write_todos`
   - tagged reasoning events (`[Plan]/[Act]/[Obs]/[Reflect]`)
4. Optional small helper updates in `src/LLMProviders/chainRunner/utils/AgentReasoningState.ts` for reflection extraction formatting.
5. Add tests:
   - planner tool schema/validation
   - loop behavior with planner-only + mixed tool calls
   - reasoning step tagging regression

## 9. Acceptance Criteria

1. Complex user query shows at least one `[Plan]`, one `[Act]`, and one `[Obs]` in reasoning steps.
2. Planner updates do not break normal ReAct completion behavior.
3. Agent still terminates on timeout/max-iterations as before.
4. No regression in non-planner queries.

## 10. Risks and Mitigations

1. Model ignores planner tool:
   - Mitigation: planner is optional; loop still works exactly as today.
2. Planner spam:
   - Mitigation: cap consecutive planner-only iterations.
3. Token bloat from verbose todos:
   - Mitigation: hard limits on item count and text length.
4. Over-exposure of hidden reasoning:
   - Mitigation: only allow concise operational reflection summaries.

## 11. Rollout

1. Ship behind a feature flag (e.g., `enableAgentPlannerV0`).
2. Enable for internal testing first.
3. Validate on representative flows: search-heavy, note reading, and composer edit tasks.
4. Enable by default after stability pass.

## 12. Open Questions

1. Should `write_todos` be always enabled or user-configurable?
2. Should planner state be exposed in any UI beyond Reasoning Block?
3. Should we persist final plan snapshot in message metadata for debugging?

---

This v0 keeps the architecture simple: one sequential ReAct loop, one lightweight planning tool, and better reasoning visibility now, while setting up a clean context-capsule path for subagents later.
