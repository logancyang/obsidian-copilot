import type { AgentMessagePart } from "@/agentMode/session/types";
import { cleanMessageForCopy } from "@/utils";

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
 * Split a turn's parts into the trailing user-visible answer and everything
 * that came before (the "research"). The boundary is the last run of `text`
 * parts; a *visible* `tool_call`, `thought`, or non-empty `plan` after a text
 * run reclassifies that run as research. Top-level-invisible parts (hidden
 * ToolSearch, sub-agent children, an empty plan) are transparent: they stay in
 * `research` but do not break the trailing run, so a sentence split by one (e.g.
 * a background sub-agent event arriving mid-prose) stays whole in `final`. The
 * caller renders `final` as a single coalesced block to match.
 *
 * Used by the trail UI to fold the research portion into a single
 * "Worked for X" block once a turn has cleanly ended (`stopReason: end_turn`).
 * Streaming turns and cancelled / refused / errored turns keep the trail
 * uncollapsed — that's the caller's responsibility, not this helper's.
 */
export function splitTrailingText(parts: AgentMessagePart[]): {
  research: AgentMessagePart[];
  final: TextPart[];
} {
  const turnToolIds = toolCallIds(parts);
  const finalIdx = new Set<number>();
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.kind === "text") {
      finalIdx.add(i);
      continue;
    }
    if (isTopLevelInvisible(p, turnToolIds)) continue;
    break;
  }
  const research: AgentMessagePart[] = [];
  const final: TextPart[] = [];
  parts.forEach((p, i) => {
    if (finalIdx.has(i)) final.push(p as TextPart);
    else research.push(p);
  });
  return { research, final };
}

/**
 * The agent's full textual response across the turn, ready for the clipboard
 * or the editor. Derived from the folded trail so Copy/Insert matches what the
 * user sees: each top-level `text` node is one prose block — the trail coalesces
 * a run split only by a top-level-invisible part (hidden ToolSearch, sub-agent
 * child, empty plan) back into one — and distinct blocks (separated by a
 * *visible* tool card, reasoning, or non-empty plan) join with a blank line.
 * Interleaving research must not drop earlier prose, so every block is kept, not
 * just the trailing run. Run through the same sanitization legacy chat applies
 * (`cleanMessageForCopy`) so tool cards, reasoning, and chat-only artifacts
 * never leak in.
 * Returns `""` when the turn produced no prose (a tool-only turn, or one
 * cancelled mid-tool) — the trail UI uses that to gate the Copy / Insert
 * affordances off so they never sit under an empty bubble.
 */
export function agentResponseText(parts: AgentMessagePart[]): string {
  const blocks = buildAgentTrail(parts)
    .filter((n): n is Extract<RenderNode, { type: "text" }> => n.type === "text")
    .map((n) => n.part.text);
  return cleanMessageForCopy(blocks.join("\n\n"));
}

/**
 * Aggregate stat for a tool call — used as the compaction `toolKey`. The
 * vendor name (when present) gives finer-grained grouping (e.g. Claude
 * Code's `MultiEdit` vs `Edit`); the ACP `toolKind` is the portable
 * fallback.
 */
export function toolKeyFor(part: ToolCallPart): string {
  const base = part.vendorToolName ?? part.toolKind ?? "other";
  // MCP calls key per-server so they neither fold into a same-bare-named
  // native tool's aggregate nor merge across servers. That keeps the
  // `server ·` prefix on the aggregate line (see `lookupToolSummary`) accurate
  // for the whole group.
  return part.mcpServer ? `mcp:${part.mcpServer}:${base}` : base;
}

/**
 * `ToolSearch` is Claude Code's deferred-tool schema loader — invoked
 * before every `ExitPlanMode` to fetch its schema. Hiding it removes
 * meaningless "tool calls" cards at the end of plan mode.
 */
function isHiddenTool(part: AgentMessagePart): boolean {
  return part.kind === "tool_call" && part.vendorToolName === "ToolSearch";
}

/** Every `tool_call` id present in a turn — used to recognize sub-agent children
 *  (a `tool_call` whose `parentToolCallId` names one of these). */
function toolCallIds(parts: AgentMessagePart[]): Set<string> {
  const ids = new Set<string>();
  for (const p of parts) if (p.kind === "tool_call") ids.add(p.id);
  return ids;
}

/**
 * Parts that render to nothing at the *top level* of the trail: the hidden
 * `ToolSearch` loader, an empty `plan` (`PlanPill` returns null), and sub-agent
 * children (shown nested under their parent's card, never as a top-level peer).
 *
 * A prose run split only by these is one block: the store concatenates the
 * streamed deltas into `displayText` with no separator, so a part that leaves no
 * visible peer between two prose chunks must not turn them into two paragraphs.
 * This is the difference between a real `\n\n` break (a visible tool card /
 * reasoning / non-empty plan sits between the chunks) and a spurious one (e.g. a
 * background sub-agent event arriving mid-sentence).
 */
function isTopLevelInvisible(part: AgentMessagePart, turnToolIds: Set<string>): boolean {
  if (isHiddenTool(part)) return true;
  if (part.kind === "plan") return part.entries.length === 0;
  return (
    part.kind === "tool_call" &&
    part.parentToolCallId !== undefined &&
    turnToolIds.has(part.parentToolCallId)
  );
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
      // node between two same-tool calls disqualifies grouping. Keeping the
      // text in `out` enforces that — the next tool_call can't see a prior
      // aggregate/action of the same key as `prev`.
      // Skip empty/whitespace-only text parts so they don't become a flex
      // child contributing `gap-1` plus their own padding to the trail.
      if (p.text.trim().length === 0) continue;
      // Coalesce with the previous text node when one is adjacent. Two text
      // parts only become adjacent after a top-level-invisible part (hidden
      // ToolSearch, sub-agent child, empty plan) was dropped between them, so
      // merging reconstructs the original prose run — byte-identical to the
      // flat `displayText` the store saved — instead of two stacked blocks that
      // read as a spurious mid-sentence line break.
      const prevNode = out[out.length - 1];
      if (prevNode && prevNode.type === "text") {
        out[out.length - 1] = {
          type: "text",
          part: { kind: "text", text: prevNode.part.text + p.text },
        };
      } else {
        out.push({ type: "text", part: p });
      }
      continue;
    }
    if (p.kind === "plan") {
      // An empty plan renders nothing (`PlanPill` returns null); emitting it as
      // a node would wedge between two prose parts and block the coalescing
      // above, leaving the spurious break. Drop it so the prose stays one block.
      if (p.entries.length === 0) continue;
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
