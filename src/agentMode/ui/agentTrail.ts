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
 * The agent's full textual response across the turn, ready for the clipboard
 * or the editor: every `text` part in stream order (not just the trailing run),
 * joined and run through the same sanitization legacy chat applies
 * (`cleanMessageForCopy`), so tool-call cards, reasoning, plans, and chat-only
 * artifacts never leak in. Interleaving research (a `thought` or `tool_call`
 * between two prose chunks) must not drop the earlier prose, so we collect all
 * text parts rather than only the trailing run. Empty/whitespace-only parts are
 * skipped so they don't leave stray blank lines.
 * Returns `""` when the turn produced no prose (a tool-only turn, or one
 * cancelled mid-tool) — the trail UI uses that to gate the Copy / Insert
 * affordances off so they never sit under an empty bubble.
 */
export function agentResponseText(parts: AgentMessagePart[]): string {
  const text = parts
    .filter((p): p is TextPart => p.kind === "text" && p.text.trim().length > 0)
    .map((p) => p.text)
    .join("\n\n");
  return cleanMessageForCopy(text);
}

/** Claude Code's deferred-tool schema loader has no standalone user meaning. */
function isHiddenTool(part: AgentMessagePart): boolean {
  return part.kind === "tool_call" && part.vendorToolName === "ToolSearch";
}

/**
 * A sub-agent invocation (Claude's `Agent`/`Task`, or opencode's anonymous
 * `task` tool, which has no vendor/MCP provenance, maps to missing/other kind,
 * and carries a `subagent_type` input). Background Claude subagents do not emit
 * partial stream events, but current SDK versions do forward their complete
 * nested assistant/user frames. A childless launch still renders as a group so
 * its final report has a home.
 */
function isSubAgentLaunch(part: ToolCallPart): boolean {
  if (!part.mcpServer && (part.vendorToolName === "Agent" || part.vendorToolName === "Task")) {
    return true;
  }
  if (part.vendorToolName || part.mcpServer) return false;
  if (part.toolKind && part.toolKind !== "other") return false;
  const input = part.input as { subagent_type?: unknown } | null | undefined;
  return typeof input?.subagent_type === "string";
}

/**
 * Fold a flat `AgentMessagePart[]` into a render tree: one node per part, with
 * sub-agents (parts whose id is referenced by another part's
 * `parentToolCallId`) absorbing their children. Runs of peers are pooled a
 * layer up by `foldActivityGroups`, so this stays purely structural.
 */
export function buildAgentTrail(
  parts: AgentMessagePart[],
  opts: BuildAgentTrailOptions = {}
): RenderNode[] {
  const maxDepth = opts.maxDepth ?? 3;
  // Drop harness-internal tools before any structural work — siblings around
  // a hidden tool then become neighbours naturally, and any orphaned children
  // of a hidden parent fall through to the existing top-level orphan path.
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

/** Recursive helper: builds nodes for a peer level and recurses into each
 *  sub-agent's children. */
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
    if ((children && children.length > 0) || isSubAgentLaunch(p)) {
      // A background launch has no streamed children but still emits a
      // subagent node so its final report has a home.
      const childNodes =
        depth + 1 >= maxDepth
          ? []
          : foldNodes(children ?? [], childrenByParent, maxDepth, depth + 1);
      out.push({
        type: "subagent",
        parent: p,
        children: childNodes,
        truncated: depth + 1 >= maxDepth,
      });
      continue;
    }
    out.push({ type: "action", part: p });
  }
  return out;
}
