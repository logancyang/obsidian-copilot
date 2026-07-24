import type { AgentToolResult } from "@earendil-works/pi-agent-core";

/**
 * Wrap a tool's answer in the result shape pi returns to the model. `details`
 * carries the structured form for the UI while `content` is what the model
 * reads, so a tool never has to build both by hand.
 *
 * @param text what the model sees
 * @param details structured payload for logs and tool cards
 */
export function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}
