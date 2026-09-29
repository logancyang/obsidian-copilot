import type { AgentMessagePart } from "@/agentMode/session/types";
import { cleanMessageForCopy } from "@/utils";

export type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;
export type ThoughtPart = Extract<AgentMessagePart, { kind: "thought" }>;
export type TextPart = Extract<AgentMessagePart, { kind: "text" }>;
export type PlanPart = Extract<AgentMessagePart, { kind: "plan" }>;

export type RenderNode =
  | { type: "action"; part: ToolCallPart }
  | { type: "subagent"; parent: ToolCallPart; children: RenderNode[]; truncated?: boolean }
  | { type: "reasoning"; part: ThoughtPart }
  | { type: "text"; part: TextPart }
  | { type: "plan"; part: PlanPart };

export interface BuildAgentTrailOptions {
  maxDepth?: number;
}

export function agentResponseText(parts: AgentMessagePart[]): string {
  const text = parts
    .filter((p): p is TextPart => p.kind === "text" && p.text.trim().length > 0)
    .map((p) => p.text)
    .join("\n\n");
  return cleanMessageForCopy(text);
}

function isHiddenTool(part: AgentMessagePart): boolean {
  return part.kind === "tool_call" && part.vendorToolName === "ToolSearch";
}

function isSubAgentLaunch(part: ToolCallPart): boolean {
  if (!part.mcpServer && (part.vendorToolName === "Agent" || part.vendorToolName === "Task")) {
    return true;
  }
  if (part.vendorToolName || part.mcpServer) return false;
  if (part.toolKind && part.toolKind !== "other") return false;
  const input = part.input as { subagent_type?: unknown } | null | undefined;
  return typeof input?.subagent_type === "string";
}

export function buildAgentTrail(
  parts: AgentMessagePart[],
  opts: BuildAgentTrailOptions = {}
): RenderNode[] {
  const maxDepth = opts.maxDepth ?? 3;
  parts = parts.filter((p) => !isHiddenTool(p));
  const byId = new Map<string, ToolCallPart>();
  for (const p of parts) {
    if (p.kind === "tool_call") byId.set(p.id, p);
  }
  const childrenByParent = new Map<string, ToolCallPart[]>();
  for (const p of parts) {
    if (p.kind !== "tool_call") continue;
    const parentId = p.parentToolCallId;
    if (parentId && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(p);
      childrenByParent.set(parentId, list);
    }
  }

  const topLevel = parts.filter((p) => {
    if (p.kind !== "tool_call") return true;
    const parentId = p.parentToolCallId;
    return !(parentId && byId.has(parentId));
  });

  return foldNodes(topLevel, childrenByParent, maxDepth, 0);
}

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
      if (p.text.trim().length === 0) continue;
      out.push({ type: "text", part: p });
      continue;
    }
    if (p.kind === "plan") {
      out.push({ type: "plan", part: p });
      continue;
    }
    const children = childrenByParent.get(p.id);
    if ((children && children.length > 0) || isSubAgentLaunch(p)) {
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
