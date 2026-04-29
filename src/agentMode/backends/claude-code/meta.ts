import { z } from "zod";
import type { BackendMetaParser, NormalizedToolCallMeta } from "@/agentMode/session/backendMeta";

/**
 * Wire shape of `_meta` on Claude Code's session/update notifications.
 * Verified against acp-frames.ndjson 2026-04-29 (claude-agent-acp 0.31.4).
 * All fields are optional — not every frame carries every key (e.g.
 * `parentToolUseId` only appears on sub-tool calls spawned by `Task`).
 */
const ClaudeCodeMetaSchema = z.object({
  claudeCode: z.object({
    toolName: z.string().optional(),
    parentToolUseId: z.string().optional(),
    toolResponse: z.unknown().optional(),
  }),
});

export const claudeCodeMetaParser: BackendMetaParser = {
  parseToolCallMeta(meta): NormalizedToolCallMeta | null {
    const parsed = ClaudeCodeMetaSchema.safeParse(meta);
    if (!parsed.success) return null;
    const cc = parsed.data.claudeCode;
    return {
      vendorToolName: cc.toolName,
      isPlanProposal: cc.toolName === "ExitPlanMode",
      parentToolCallId: cc.parentToolUseId,
    };
  },
};
