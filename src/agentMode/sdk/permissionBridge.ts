/**
 * Bridge between the Claude SDK's `canUseTool` callback and Agent Mode's
 * session-domain permission prompter. Each `canUseTool` invocation is
 * translated to a `PermissionPrompt`, dispatched through the prompter, then
 * translated back to a SDK `PermissionResult`. AskUserQuestion gets a
 * separate branch that opens a dedicated multi-choice modal.
 */
import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  PermissionDecision,
  PermissionOption,
  PermissionOptionKind,
  PermissionPrompt,
  SessionId,
} from "@/agentMode/session/types";
import { PERMISSION_OPTION_KINDS } from "@/agentMode/session/types";
import { resolveToolName } from "@/agentMode/session/toolName";
import { err2String } from "@/utils";
import { logSdkInbound, logSdkOutbound } from "./sdkDebugTap";
import { deriveToolKind, deriveToolTitle, vendorMetaFields } from "./toolMeta";

export type Prompter = (req: PermissionPrompt) => Promise<PermissionDecision>;

export type AskUserQuestionHandler = (
  questions: AskUserQuestionInput["questions"]
) => Promise<{ [questionText: string]: string }>;

export interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

export interface PermissionBridgeOptions {
  getPrompter: () => Prompter | null;
  askUserQuestion?: AskUserQuestionHandler;
  /**
   * Predicate identifying plan-mode plan files. When provided, the bridge
   * auto-allows `Write` calls whose `file_path` satisfies the predicate so
   * plan mode can finalize its proposal at `~/.claude/plans/*.md` without
   * a prompt. Every other `Write` is routed through the permission
   * prompter like any other tool.
   */
  isPlanModePlanFilePath?: (absolutePath: string) => boolean;
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
      return this.handleAskUserQuestion(input as unknown as AskUserQuestionInput);
    }

    const sessionId = this.currentSessionId;
    logSdkInbound(
      `canUseTool:request`,
      { toolName, input, suggestions: ctx.suggestions },
      sessionId
    );

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

  private async handleAskUserQuestion(input: AskUserQuestionInput): Promise<PermissionResult> {
    const sessionId = this.currentSessionId;
    logSdkInbound("askUserQuestion:request", input, sessionId);
    if (!this.opts.askUserQuestion) {
      return this.deny(
        "askUserQuestion:response",
        "AskUserQuestion is not yet supported",
        sessionId
      );
    }
    try {
      const answers = await this.opts.askUserQuestion(input.questions);
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
