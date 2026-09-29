import type { ScopeOp } from "@/agentMode/protocol/ops";
import type { AgentMessagePart } from "@/agentMode/session/types";

const BASE_OP_BYTES = 64;
const TOOL_INPUT_BYTES = 512;

function estimatePartBytes(part: AgentMessagePart): number {
  switch (part.kind) {
    case "text":
    case "thought":
      return part.text.length;
    case "plan":
      return part.entries.reduce((sum, entry) => sum + entry.content.length + 48, 0);
    case "tool_call": {
      const outputs = (part.output ?? []).reduce(
        (sum, output) =>
          sum +
          (output.type === "text"
            ? output.text.length
            : output.newText.length + (output.oldText?.length ?? 0)),
        0
      );
      const input =
        typeof part.input === "string"
          ? part.input.length
          : part.input === undefined
            ? 0
            : TOOL_INPUT_BYTES;
      return part.title.length + outputs + input;
    }
  }
}

export function estimateOpBytes(op: ScopeOp): number {
  switch (op.t) {
    case "msg.appendText":
    case "msg.appendThought":
      return BASE_OP_BYTES + op.text.length;
    case "msg.upsertPart":
      return BASE_OP_BYTES + estimatePartBytes(op.part);
    default:
      return JSON.stringify(op).length;
  }
}
