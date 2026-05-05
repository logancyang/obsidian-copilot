/**
 * Bridge between the Claude SDK's `canUseTool` callback and Agent Mode's
 * existing ACP-style permission prompter. Each `canUseTool` invocation is
 * translated to an ACP `RequestPermissionRequest`, dispatched through the
 * prompter, then translated back to a SDK `PermissionResult`. AskUserQuestion
 * gets a separate branch that opens a dedicated multi-choice modal.
 */
import type {
  PermissionOption,
  PermissionOptionId,
  PermissionOptionKind,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionId,
} from "@agentclientprotocol/sdk";
import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import { err2String } from "@/utils";
import { logSdkInbound, logSdkOutbound } from "./sdkDebugTap";
import { deriveToolKind, deriveToolTitle } from "./toolMeta";

export type Prompter = (req: RequestPermissionRequest) => Promise<RequestPermissionResponse>;

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
   * auto-allows `Write` calls whose `file_path` satisfies the predicate and
   * silently denies every other `Write` — so the SDK can finalize plan mode
   * (which writes to a path outside the vault) without re-opening arbitrary
   * filesystem writes. Vault mutations are expected to flow through the
   * vault MCP, never `Write`.
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
      return this.handleWrite(input, sessionId);
    }

    const prompter = this.opts.getPrompter();
    if (!prompter) {
      return this.deny("canUseTool:response", "No permission prompter available", sessionId);
    }
    if (!sessionId) {
      return this.deny("canUseTool:response", "Permission requested outside a session", sessionId);
    }

    const req = synthesizePermissionRequest(toolName, input, sessionId, ctx);
    const resp = await prompter(req);
    const result = mapAcpOutcomeToSdk(resp, ctx.suggestions, input);
    logSdkOutbound("canUseTool:response", result, sessionId);
    return result;
  };

  /**
   * Vault writes flow through the vault MCP, so any built-in `Write` call is
   * either (a) plan mode finalizing its proposal at `~/.claude/plans/*.md`,
   * or (b) something we should not honor. Plan-file Writes are auto-allowed
   * without prompting; everything else is denied without prompting so we
   * never surface a "the agent wants to write `/etc/passwd`" modal.
   */
  private handleWrite(
    input: Record<string, unknown>,
    sessionId: SessionId | null
  ): PermissionResult {
    const filePath = typeof input.file_path === "string" ? input.file_path : null;
    if (!filePath) {
      return this.deny("canUseTool:response", "Write rejected: missing file_path", sessionId);
    }
    if (this.opts.isPlanModePlanFilePath?.(filePath)) {
      const result: PermissionResult = { behavior: "allow", updatedInput: input };
      logSdkOutbound("canUseTool:response:auto-allow-plan", result, sessionId);
      return result;
    }
    return this.deny(
      "canUseTool:response",
      "Write is restricted to plan-mode plan files; use the vault MCP for vault writes.",
      sessionId
    );
  }

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

const STANDARD_OPTION_KINDS: readonly PermissionOptionKind[] = [
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
];
const STANDARD_OPTION_NAMES: Record<PermissionOptionKind, string> = {
  allow_once: "Allow once",
  allow_always: "Allow always",
  reject_once: "Deny once",
  reject_always: "Deny always",
};
const STANDARD_OPTIONS: PermissionOption[] = STANDARD_OPTION_KINDS.map((kind) => ({
  optionId: kind,
  name: STANDARD_OPTION_NAMES[kind],
  kind,
}));
const STANDARD_OPTION_IDS = new Set<PermissionOptionId>(STANDARD_OPTION_KINDS);

function synthesizePermissionRequest(
  toolName: string,
  input: Record<string, unknown>,
  sessionId: SessionId,
  ctx: Parameters<CanUseTool>[2]
): RequestPermissionRequest {
  return {
    sessionId,
    toolCall: {
      // Reuse the SDK's own `tool_use_id` so this id matches the one carried
      // on the corresponding `tool_call` session notification. The session
      // layer keys plan-card resolvers off that id (see
      // `AgentSession.publishGatedPlan`); a mismatch silently strands the
      // resolver and the rejected plan card hangs the agent's RPC.
      toolCallId: ctx.toolUseID,
      kind: deriveToolKind(toolName),
      status: "pending",
      title: deriveToolTitle(
        toolName,
        input,
        typeof ctx.title === "string" ? ctx.title : undefined
      ),
      rawInput: input,
      _meta: { claude: { toolName } },
    },
    options: STANDARD_OPTIONS,
  };
}

function mapAcpOutcomeToSdk(
  resp: RequestPermissionResponse,
  suggestions: PermissionUpdate[] | undefined,
  input: Record<string, unknown>
): PermissionResult {
  if (resp.outcome.outcome === "cancelled") {
    return { behavior: "deny", message: "User cancelled" };
  }
  // Defensive default: unknown ids collapse to deny so they don't silently allow.
  const optionKind = STANDARD_OPTION_IDS.has(resp.outcome.optionId)
    ? (resp.outcome.optionId as PermissionOptionKind)
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
      return { behavior: "deny", message: "User declined" };
  }
}
