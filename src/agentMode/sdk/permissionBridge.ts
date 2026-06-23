/**
 * Bridge between the Claude SDK's `canUseTool` callback and Agent Mode's
 * session-domain prompters. Each `canUseTool` invocation is translated to a
 * `PermissionPrompt`, dispatched through the permission prompter, then
 * translated back to a SDK `PermissionResult`. AskUserQuestion gets a separate
 * branch that dispatches through the ask-question prompter — the session
 * surfaces an inline card and returns the answers map.
 */
import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentQuestion,
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  PermissionDecision,
  PermissionOption,
  PermissionOptionKind,
  PermissionPrompt,
  SessionId,
} from "@/agentMode/session/types";
import { PERMISSION_OPTION_KINDS } from "@/agentMode/session/types";
import { resolveToolName } from "@/agentMode/session/toolName";
import { isVaultWriteToolKind } from "@/agentMode/session/fanout/fanoutTypes";
import { err2String } from "@/utils";
import { logSdkInbound, logSdkOutbound } from "./sdkDebugTap";
import { deriveToolKind, deriveToolTitle, vendorMetaFields } from "./toolMeta";

export type Prompter = (req: PermissionPrompt) => Promise<PermissionDecision>;

/**
 * Session-domain handler for the SDK's `AskUserQuestion` tool. Mirrors the
 * permission `Prompter`: the bridge fetches it lazily via
 * `getAskUserQuestionPrompter` so it can be registered after construction.
 */
export type AskUserQuestionPrompter = (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;

/** SDK-side shape of the `AskUserQuestion` tool input. */
export interface AskUserQuestionInput {
  questions: AgentQuestion[];
}

export interface PermissionBridgeOptions {
  getPrompter: () => Prompter | null;
  /**
   * Lazily fetch the session-domain ask-question prompter. Absent / returning
   * `null` makes AskUserQuestion deny with "not yet supported", matching the
   * pre-inline behavior when no handler was wired.
   */
  getAskUserQuestionPrompter?: () => AskUserQuestionPrompter | null;
  /**
   * Predicate identifying plan-mode plan files. When provided, the bridge
   * auto-allows `Write` calls whose `file_path` satisfies the predicate so
   * plan mode can finalize its proposal at `~/.claude/plans/*.md` without
   * a prompt. Every other `Write` is routed through the permission
   * prompter like any other tool.
   */
  isPlanModePlanFilePath?: (absolutePath: string) => boolean;
  /**
   * Lazily fetch the predicate deciding whether a backend session is an
   * ephemeral read-only fan-out QA sub-session. Lazy (like `getPrompter`) so
   * the manager can register it after the backend is constructed. Consulted at
   * the TOP of `canUseTool`, BEFORE the plan-file auto-allow: a read-only
   * session hard-denies every write/exec tool (including plan-file `Write`s) so
   * the auto-allow can never reopen a write path during a read-only QA turn.
   * Closes the hole generically even if a mode switch failed to sandbox the
   * backend.
   */
  getIsReadOnlySession?: () => ((sessionId: SessionId) => boolean) | null;
}

export class PermissionBridge {
  constructor(private readonly opts: PermissionBridgeOptions) {}

  /**
   * Single-field rather than keyed-by-toolCallId because each backend has
   * exactly one in-flight `query()` at a time. If we ever support concurrent
   * prompts on the same backend instance, key this by toolCallId.
   */
  private currentSessionId: SessionId | null = null;

  setSessionContext(sessionId: SessionId): void {
    this.currentSessionId = sessionId;
  }

  clearSessionContext(): void {
    this.currentSessionId = null;
  }

  canUseTool: CanUseTool = async (toolName, input, ctx) => {
    if (toolName === "AskUserQuestion") {
      return this.handleAskUserQuestion(input as unknown as AskUserQuestionInput, ctx);
    }

    const sessionId = this.currentSessionId;
    logSdkInbound(
      `canUseTool:request`,
      { toolName, input, suggestions: ctx.suggestions },
      sessionId
    );

    // Read-only fan-out QA sub-sessions hard-deny writes/exec BEFORE the
    // plan-file auto-allow below, so a read-only turn can never finalize a
    // plan file (or any other write) even if the sandbox mode switch was wrong
    // for this backend. Reads/searches/fetches fall through to the normal path
    // (the prompter then allows them).
    const isReadOnlySession = this.opts.getIsReadOnlySession?.();
    if (sessionId && isReadOnlySession?.(sessionId)) {
      const { tool, mcpServer } = resolveToolName(toolName);
      const kind = deriveToolKind(tool, mcpServer);
      // An MCP tool whose name isn't a known built-in derives to `other`, which
      // is otherwise allowed. We can't verify a third-party MCP tool is
      // read-only (e.g. `mcp__filesystem__write_file`), so fail safe and deny
      // unknown MCP tools in a read-only QA turn; known-classified MCP reads
      // (read/search/fetch) still fall through.
      const isUnverifiableMcpTool = Boolean(mcpServer) && kind === "other";
      if (isVaultWriteToolKind(kind) || isUnverifiableMcpTool) {
        return this.deny(
          "canUseTool:response",
          "Read-only QA turn: vault-write tools are disabled.",
          sessionId
        );
      }
    }

    if (toolName === "Write") {
      const filePath = typeof input.file_path === "string" ? input.file_path : null;
      if (filePath && this.opts.isPlanModePlanFilePath?.(filePath)) {
        const result: PermissionResult = { behavior: "allow", updatedInput: input };
        logSdkOutbound("canUseTool:response:auto-allow-plan", result, sessionId);
        return result;
      }
    }

    const prompter = this.opts.getPrompter();
    if (!prompter) {
      return this.deny("canUseTool:response", "No permission prompter available", sessionId);
    }
    if (!sessionId) {
      return this.deny("canUseTool:response", "Permission requested outside a session", sessionId);
    }

    const prompt = synthesizePermissionPrompt(toolName, input, sessionId, ctx);
    const decision = await prompter(prompt);
    const result = mapDecisionToSdk(decision, ctx.suggestions, input);
    logSdkOutbound("canUseTool:response", result, sessionId);
    return result;
  };

  private async handleAskUserQuestion(
    input: AskUserQuestionInput,
    ctx: Parameters<CanUseTool>[2]
  ): Promise<PermissionResult> {
    const sessionId = this.currentSessionId;
    logSdkInbound("askUserQuestion:request", input, sessionId);
    const prompter = this.opts.getAskUserQuestionPrompter?.() ?? null;
    if (!prompter || !sessionId) {
      return this.deny(
        "askUserQuestion:response",
        "AskUserQuestion is not yet supported",
        sessionId
      );
    }
    try {
      // Reuse the SDK's `tool_use_id` as the requestId so the inline card's
      // resolver pairs the answer with this call, mirroring the permission
      // prompt's `toolCallId`.
      const answers = await prompter({
        sessionId,
        requestId: ctx.toolUseID,
        questions: input.questions,
      });
      if (Object.keys(answers).length === 0) {
        return this.deny("askUserQuestion:response", "User cancelled the question", sessionId);
      }
      const result: PermissionResult = {
        behavior: "allow",
        updatedInput: { questions: input.questions, answers },
      };
      logSdkOutbound("askUserQuestion:response", result, sessionId);
      return result;
    } catch (e) {
      return this.deny(
        "askUserQuestion:response",
        `AskUserQuestion failed: ${err2String(e)}`,
        sessionId
      );
    }
  }

  private deny(method: string, message: string, sessionId: SessionId | null): PermissionResult {
    const result: PermissionResult = { behavior: "deny", message };
    logSdkOutbound(method, result, sessionId);
    return result;
  }
}

const STANDARD_OPTION_NAMES: Record<PermissionOptionKind, string> = {
  allow_once: "Allow once",
  allow_always: "Allow always",
  reject_once: "Deny once",
  reject_always: "Deny always",
};
const STANDARD_OPTIONS: PermissionOption[] = PERMISSION_OPTION_KINDS.map((kind) => ({
  optionId: kind,
  name: STANDARD_OPTION_NAMES[kind],
  kind,
}));
const STANDARD_OPTION_IDS = new Set<string>(PERMISSION_OPTION_KINDS);

function synthesizePermissionPrompt(
  toolName: string,
  input: Record<string, unknown>,
  sessionId: SessionId,
  ctx: Parameters<CanUseTool>[2]
): PermissionPrompt {
  const { tool: name, mcpServer } = resolveToolName(toolName);
  return {
    sessionId,
    toolCall: {
      // Reuse the SDK's `tool_use_id` so prompt and `tool_call` notification
      // share an id — the trail UI and plan-card resolver pair them by id.
      toolCallId: ctx.toolUseID,
      kind: deriveToolKind(name, mcpServer),
      status: "pending",
      title: deriveToolTitle(name, input, typeof ctx.title === "string" ? ctx.title : undefined),
      rawInput: input,
      mcpServer,
      ...vendorMetaFields(name, undefined, mcpServer),
    },
    options: STANDARD_OPTIONS,
  };
}

function mapDecisionToSdk(
  decision: PermissionDecision,
  suggestions: PermissionUpdate[] | undefined,
  input: Record<string, unknown>
): PermissionResult {
  if (decision.outcome.outcome === "cancelled") {
    return { behavior: "deny", message: "User cancelled" };
  }
  // Defensive default: unknown ids collapse to deny so they don't silently allow.
  const optionKind = STANDARD_OPTION_IDS.has(decision.outcome.optionId)
    ? (decision.outcome.optionId as PermissionOptionKind)
    : "reject_once";
  switch (optionKind) {
    case "allow_once":
      // SDK runtime schema requires `updatedInput` even though the type marks
      // it optional. Echo the original — we don't modify tool args from the prompt.
      return { behavior: "allow", updatedInput: input };
    case "allow_always":
      return { behavior: "allow", updatedInput: input, updatedPermissions: suggestions ?? [] };
    case "reject_once":
    case "reject_always":
      return { behavior: "deny", message: decision.denyMessage ?? "User declined" };
  }
}
