import type { AgentMessagePart } from "@/agentMode/session/types";

export type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;
export type ThoughtPart = Extract<AgentMessagePart, { kind: "thought" }>;
export type TextPart = Extract<AgentMessagePart, { kind: "text" }>;
export type PlanPart = Extract<AgentMessagePart, { kind: "plan" }>;

/**
 * One renderable unit in the agent trail. The flat `AgentMessagePart[]`
 * stream from the session is folded into this tree at render time; the
 * store stays flat and this transformation is purely derivational.
 */
export type RenderNode =
  | { type: "action"; part: ToolCallPart }
  | { type: "aggregate"; toolKey: string; parts: ToolCallPart[] }
  | { type: "subagent"; parent: ToolCallPart; children: RenderNode[]; truncated?: boolean }
  | { type: "reasoning"; part: ThoughtPart }
  | { type: "text"; part: TextPart }
  | { type: "plan"; part: PlanPart };

export interface BuildAgentTrailOptions {
  /** Recursion cap for sub-agent nesting. Beyond this, deeper sub-agents render as
   *  collapsed stubs so deep traces don't become horizontal noise. Default 3. */
  maxDepth?: number;
}

/**
 * Aggregate stat for a tool call — used as the compaction `toolKey`. The
 * vendor name (when present) gives finer-grained grouping (e.g. Claude
 * Code's `MultiEdit` vs `Edit`); the ACP `toolKind` is the portable
 * fallback.
 */
export function toolKeyFor(part: ToolCallPart): string {
  return part.vendorToolName ?? part.toolKind ?? "other";
}

/**
 * `ToolSearch` is Claude Code's deferred-tool schema loader — invoked
 * before every `ExitPlanMode` to fetch its schema. Hiding it removes
 * meaningless "tool calls" cards at the end of plan mode.
 */
function isHiddenTool(part: AgentMessagePart): boolean {
  return part.kind === "tool_call" && part.vendorToolName === "ToolSearch";
}

/**
 * Fold a flat `AgentMessagePart[]` into a render tree. Compaction folds
 * runs of `N >= 2` consecutive same-`toolKey` peers into one aggregate
 * node; sub-agents (parts whose id is referenced by another part's
 * `parentToolCallId`) absorb their children. Strict — no heuristics
 * beyond what the design doc spells out.
 */
export function buildAgentTrail(
  parts: AgentMessagePart[],
  opts: BuildAgentTrailOptions = {}
): RenderNode[] {
  const maxDepth = opts.maxDepth ?? 3;
  // Drop harness-internal tools before any structural work — siblings around
  // a hidden tool then re-aggregate naturally, and any orphaned children of a
  // hidden parent fall through to the existing top-level orphan path.
  parts = parts.filter((p) => !isHiddenTool(p));
  // Index every tool_call by id so children can be looked up cheaply.
  const byId = new Map<string, ToolCallPart>();
  for (const p of parts) {
    if (p.kind === "tool_call") byId.set(p.id, p);
  }
  // Group children by parent id, in original stream order.
  const childrenByParent = new Map<string, ToolCallPart[]>();
  for (const p of parts) {
    if (p.kind !== "tool_call") continue;
    const parentId = p.parentToolCallId;
    // Only treat as a child if the referenced parent is actually in this turn's
    // part list — otherwise an orphan reference (e.g. dropped frame) shouldn't
    // hide the part from the trail entirely.
    if (parentId && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(p);
      childrenByParent.set(parentId, list);
    }
  }

  // Top-level walk: skip parts that are children of some parent in this turn —
  // they'll be rendered inside the parent's subagent node.
  const topLevel = parts.filter((p) => {
    if (p.kind !== "tool_call") return true;
    const parentId = p.parentToolCallId;
    return !(parentId && byId.has(parentId));
  });

  return foldNodes(topLevel, childrenByParent, maxDepth, 0);
}

/**
 * Recursive helper: builds nodes for a peer level, applies compaction,
 * and recurses into each sub-agent's children.
 *
 * Compaction applies at every depth — only same-`toolKey` adjacent peers
 * collapse, so unrelated tool calls never merge. Any intervening `text`,
 * `thought`, `plan`, sub-agent, or different-tool call breaks the run and
 * forces the next same-tool call to start a fresh aggregate.
 */
function foldNodes(
  peers: AgentMessagePart[],
  childrenByParent: Map<string, ToolCallPart[]>,
  maxDepth: number,
  depth: number
): RenderNode[] {
  const out: RenderNode[] = [];
  for (const p of peers) {
    if (p.kind === "thought") {
      out.push({ type: "reasoning", part: p });
      continue;
    }
    if (p.kind === "text") {
      // Streamed prose breaks compaction (design doc §"Compaction"): a text
      // part between two same-tool calls disqualifies grouping. Pushing
      // straight to `out` here naturally enforces that — the next tool_call
      // can't see a prior aggregate/action of the same key as `prev`.
      // Skip empty/whitespace-only text parts so they don't become a flex
      // child contributing `gap-1` plus their own padding to the trail.
      if (p.text.trim().length === 0) continue;
      out.push({ type: "text", part: p });
      continue;
    }
    if (p.kind === "plan") {
      out.push({ type: "plan", part: p });
      continue;
    }
    // tool_call
    const children = childrenByParent.get(p.id);
    if (children && children.length > 0) {
      // Sub-agent: flush any pending compaction first (sub-agent boundary
      // breaks compaction), then emit the subagent node.
      const childNodes =
        depth + 1 >= maxDepth ? [] : foldNodes(children, childrenByParent, maxDepth, depth + 1);
      out.push({
        type: "subagent",
        parent: p,
        children: childNodes,
        truncated: depth + 1 >= maxDepth,
      });
      continue;
    }
    // Plain action — try to compact with the previous node.
    const prev = out[out.length - 1];
    const key = toolKeyFor(p);
    if (prev && prev.type === "action" && toolKeyFor(prev.part) === key) {
      out[out.length - 1] = { type: "aggregate", toolKey: key, parts: [prev.part, p] };
    } else if (prev && prev.type === "aggregate" && prev.toolKey === key) {
      prev.parts.push(p);
    } else {
      out.push({ type: "action", part: p });
    }
  }
  return out;
}
