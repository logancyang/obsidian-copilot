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

export type AskUserQuestionPrompter = (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;

type InProcessCanUseTool = (...args: Parameters<CanUseTool>) => Promise<PermissionResult>;

export interface AskUserQuestionInput {
  questions: AgentQuestion[];
}

export interface PermissionBridgeOptions {
  getPrompter: () => Prompter | null;
  getAskUserQuestionPrompter?: () => AskUserQuestionPrompter | null;
  isPlanModePlanFilePath?: (absolutePath: string) => boolean;
  getIsReadOnlySession?: () => ((sessionId: SessionId) => boolean) | null;
}

export class PermissionBridge {
  constructor(
    private readonly sessionId: SessionId,
    private readonly opts: PermissionBridgeOptions
  ) {}

  canUseTool: InProcessCanUseTool = async (toolName, input, ctx) => {
    if (toolName === "AskUserQuestion") {
      return this.handleAskUserQuestion(input as unknown as AskUserQuestionInput, ctx);
    }

    const sessionId = this.sessionId;
    logSdkInbound(
      `canUseTool:request`,
      { toolName, input, suggestions: ctx.suggestions },
      sessionId
    );

    const isReadOnlySession = this.opts.getIsReadOnlySession?.();
    if (sessionId && isReadOnlySession?.(sessionId)) {
      const { tool, mcpServer } = resolveToolName(toolName);
      const kind = deriveToolKind(tool, mcpServer);
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
    const sessionId = this.sessionId;
    logSdkInbound("askUserQuestion:request", input, sessionId);
    const prompter = this.opts.getAskUserQuestionPrompter?.() ?? null;
    if (!prompter) {
      return this.deny(
        "askUserQuestion:response",
        "AskUserQuestion is not yet supported",
        sessionId
      );
    }
    try {
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

  private deny(method: string, message: string, sessionId: SessionId): PermissionResult {
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
  const optionKind = STANDARD_OPTION_IDS.has(decision.outcome.optionId)
    ? (decision.outcome.optionId as PermissionOptionKind)
    : "reject_once";
  switch (optionKind) {
    case "allow_once":
      return { behavior: "allow", updatedInput: input };
    case "allow_always":
      return { behavior: "allow", updatedInput: input, updatedPermissions: suggestions ?? [] };
    case "reject_once":
    case "reject_always":
      return { behavior: "deny", message: decision.denyMessage ?? "User declined" };
  }
}
