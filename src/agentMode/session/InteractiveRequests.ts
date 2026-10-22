import type { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import {
  derivePlanTitleFromMarkdown,
  findToolCallPart,
  tryReadExitPlanModeCall,
} from "@/agentMode/session/messageParts";
import {
  AgentMessagePart,
  AgentPlanEntry,
  AgentQuestionAnswers,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  CurrentPlan,
  PERMISSION_ALLOW_KINDS,
  PERMISSION_REJECT_KINDS,
  PermissionDecision,
  PermissionOptionKind,
  PermissionPrompt,
  PermissionRequester,
  PlanDecisionAction,
} from "@/agentMode/session/types";

const EMPTY_PERMISSIONS: PermissionPrompt[] = [];
const EMPTY_QUESTIONS: AskUserQuestionPrompt[] = [];
const EMPTY_ANSWERS: AgentQuestionAnswers = Object.freeze({});

interface PendingPermission {
  request: PermissionPrompt;
  resolve: (resp: PermissionDecision) => void;
}

interface PendingQuestion {
  request: AskUserQuestionPrompt;
  resolve: (answers: AgentQuestionAnswers) => void;
}

export interface InteractiveRequestsDeps {
  store: AgentMessageStore;
  internalId: string;
  getReplyId(): string | null;
  hasLeftPlanMode(): boolean;
  recomputeStatus(): void;
  notifyMessages(): void;
  notifyPlanChanged(): void;
  notifyTodoListChanged(): void;
}

export class InteractiveRequests {
  private pendingPlanResolvers = new Map<string, PendingPermission>();
  private pendingToolResolvers = new Map<string, PendingPermission>();
  private pendingQuestionResolvers = new Map<string, PendingQuestion>();
  private currentPlan: CurrentPlan | null = null;
  private currentTodoList: AgentTodoListEntry[] | null = null;
  private currentTodoListSignature: string | null = null;
  private planSeq = 0;
  private decidedPlanToolCallIds = new Set<string>();

  constructor(private readonly deps: InteractiveRequestsDeps) {}

  handlePlanProposalPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    const toolCallId = request.toolCall.toolCallId;
    const exitPlan = tryReadExitPlanModeCall({
      kind: request.toolCall.kind,
      rawInput: request.toolCall.rawInput,
      isPlanProposal: request.toolCall.isPlanProposal,
    });
    if (exitPlan) {
      this.publishGatedPlan(toolCallId, exitPlan);
    }
    return new Promise<PermissionDecision>((resolve) => {
      this.pendingPlanResolvers.set(toolCallId, { request, resolve });
      this.deps.recomputeStatus();
      this.deps.notifyMessages();
    });
  }

  resolvePlanProposalPermission(toolCallId: string, allow: boolean, denyMessage?: string): void {
    const entry = this.pendingPlanResolvers.get(toolCallId);
    if (!entry) return;
    this.pendingPlanResolvers.delete(toolCallId);
    const base = decisionFor(
      entry.request,
      allow ? PERMISSION_ALLOW_KINDS : PERMISSION_REJECT_KINDS
    );
    const decision: PermissionDecision = !allow && denyMessage ? { ...base, denyMessage } : base;
    entry.resolve(decision);
    this.deps.recomputeStatus();
    this.deps.notifyMessages();
  }

  getCurrentPlan(): CurrentPlan | null {
    return this.currentPlan;
  }

  getCurrentTodoList(): AgentTodoListEntry[] | null {
    return this.currentTodoList;
  }

  hasPending(): boolean {
    return (
      this.pendingPlanResolvers.size +
        this.pendingToolResolvers.size +
        this.pendingQuestionResolvers.size >
      0
    );
  }

  finalizePlanDecision(
    proposalId: string,
    decision?: PlanDecisionAction,
    feedbackText?: string
  ): boolean {
    if (!this.currentPlan || this.currentPlan.id !== proposalId) return false;
    if (this.currentPlan.pendingToolCallId) {
      this.decidedPlanToolCallIds.add(this.currentPlan.pendingToolCallId);
      if (decision) {
        const summary =
          decision === "approve"
            ? "Approved plan"
            : decision === "reject"
              ? "Rejected plan"
              : `Requested plan changes: ${feedbackText ?? "Feedback sent"}`;
        // ACP may report only a titleless completion after the user decides.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/41
        this.recordUserResponse(this.currentPlan.pendingToolCallId, summary);
      }
    }
    this.currentPlan = null;
    this.deps.notifyPlanChanged();
    return true;
  }

  private setCurrentPlan(next: Omit<CurrentPlan, "id" | "revision" | "decision">): void {
    if (!this.currentPlan) {
      this.planSeq += 1;
      this.currentPlan = {
        ...next,
        id: `plan-${this.deps.internalId}-${this.planSeq}`,
        revision: 1,
        decision: "pending",
      };
      this.deps.notifyPlanChanged();
      return;
    }
    const prev = this.currentPlan;
    const bodyChanged = prev.body !== next.body;
    const changed =
      bodyChanged ||
      prev.title !== next.title ||
      prev.sourceFilePath !== next.sourceFilePath ||
      prev.permissionGated !== next.permissionGated ||
      prev.pendingToolCallId !== next.pendingToolCallId ||
      prev.decision !== "pending";
    if (!changed) return;
    this.currentPlan = {
      ...prev,
      ...next,
      revision: bodyChanged ? prev.revision + 1 : prev.revision,
      decision: "pending",
    };
    this.deps.notifyPlanChanged();
  }

  clearCurrentPlanIfModeLeft(): void {
    if (!this.currentPlan) return;
    if (!this.deps.hasLeftPlanMode()) return;
    const pending = this.currentPlan.pendingToolCallId;
    if (pending) {
      this.resolvePlanProposalPermission(pending, false);
      this.decidedPlanToolCallIds.add(pending);
    }
    this.currentPlan = null;
    this.deps.notifyPlanChanged();
  }

  hasPendingPlanPermission(): boolean {
    return this.pendingPlanResolvers.size > 0;
  }

  handleToolPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    const toolCallId = request.toolCall.toolCallId;
    return new Promise<PermissionDecision>((resolve) => {
      this.pendingToolResolvers.set(toolCallId, { request, resolve });
      this.deps.recomputeStatus();
      this.deps.notifyMessages();
    });
  }

  resolveToolPermission(toolCallId: string, optionId: string): void {
    const entry = this.pendingToolResolvers.get(toolCallId);
    if (!entry) return;
    this.pendingToolResolvers.delete(toolCallId);
    entry.resolve({ outcome: { outcome: "selected", optionId } });
    this.deps.recomputeStatus();
    this.deps.notifyMessages();
  }

  getPendingToolPermissions(): PermissionPrompt[] {
    if (this.pendingToolResolvers.size === 0) return EMPTY_PERMISSIONS;
    return Array.from(this.pendingToolResolvers.values(), (e) => e.request);
  }

  rejectToolRequestsFrom(requester: PermissionRequester): void {
    const taskId = typeof requester === "object" ? requester.taskId : undefined;
    const requests = [...this.pendingToolResolvers].filter(([, { request }]) => {
      const from = request.requester ?? "main";
      return typeof from === "object" ? from.taskId === taskId : taskId === undefined;
    });
    if (requests.length === 0) return;
    for (const [toolCallId] of requests) this.pendingToolResolvers.delete(toolCallId);
    this.flushResolvers(new Map(requests));
    this.deps.notifyMessages();
  }

  handleAskUserQuestion(request: AskUserQuestionPrompt): Promise<AgentQuestionAnswers> {
    const requestId = request.requestId;
    if (request.signal?.aborted) return Promise.resolve(EMPTY_ANSWERS);
    return new Promise<AgentQuestionAnswers>((resolve) => {
      this.pendingQuestionResolvers.set(requestId, { request, resolve });
      // ACP timeout and cancellation withdraw the card without an answer.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
      request.signal?.addEventListener(
        "abort",
        () => this.resolveAskUserQuestion(requestId, EMPTY_ANSWERS),
        { once: true }
      );
      this.deps.recomputeStatus();
      this.deps.notifyMessages();
    });
  }

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void {
    const entry = this.pendingQuestionResolvers.get(requestId);
    if (!entry) return;
    this.pendingQuestionResolvers.delete(requestId);
    const responses = entry.request.questions.flatMap((question) => {
      const answer = answers[question.answerKey ?? question.question];
      return answer ? [{ question: question.question, answer }] : [];
    });
    // ACP elicitation may have no tool call of its own; record the submitted
    // answers in the current assistant turn.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
    if (responses.length > 0) {
      const summary = `Answered: ${responses.map(({ answer }) => answer).join("; ")}`;
      const detail = responses.map(({ question, answer }) => `${question}: ${answer}`).join("\n");
      this.recordUserResponse(requestId, summary, detail);
    }
    entry.resolve(answers);
    this.deps.recomputeStatus();
    this.deps.notifyMessages();
  }

  private recordUserResponse(toolCallId: string, summary: string, detail?: string): void {
    const messageId =
      this.deps.store.findMessageIdWithToolCall(toolCallId) ?? this.deps.getReplyId();
    if (!messageId) return;
    const previous = findToolCallPart(this.deps.store, messageId, toolCallId);
    const part: AgentMessagePart = {
      ...(previous?.kind === "tool_call" ? previous : {}),
      kind: "tool_call",
      id: toolCallId,
      title: summary,
      status: "completed",
      userResponse: summary,
      ...(detail ? { output: [{ type: "text", text: detail }] } : {}),
    };
    if (this.deps.store.upsertAgentPart(messageId, part)) this.deps.notifyMessages();
  }

  getPendingAskUserQuestions(): AskUserQuestionPrompt[] {
    if (this.pendingQuestionResolvers.size === 0) return EMPTY_QUESTIONS;
    return Array.from(this.pendingQuestionResolvers.values(), (e) => e.request);
  }

  withdrawQuestions(): void {
    if (this.pendingQuestionResolvers.size === 0) return;
    this.flushQuestionResolvers();
    this.deps.notifyMessages();
  }

  private flushResolvers(map: Map<string, PendingPermission>): void {
    for (const { request, resolve } of map.values()) {
      resolve(decisionFor(request, PERMISSION_REJECT_KINDS));
    }
    map.clear();
    this.deps.recomputeStatus();
  }

  private flushQuestionResolvers(): void {
    for (const { resolve } of this.pendingQuestionResolvers.values()) {
      resolve(EMPTY_ANSWERS);
    }
    this.pendingQuestionResolvers.clear();
    this.deps.recomputeStatus();
  }

  publishGatedPlan(toolCallId: string, info: { plan: string; planFilePath?: string }): void {
    if (this.decidedPlanToolCallIds.has(toolCallId)) return;
    const stale = this.currentPlan?.pendingToolCallId;
    if (stale && stale !== toolCallId) this.resolvePlanProposalPermission(stale, false);
    const title = derivePlanTitleFromMarkdown(info.plan);
    this.setCurrentPlan({
      body: info.plan,
      title,
      sourceFilePath: info.planFilePath,
      permissionGated: true,
      pendingToolCallId: toolCallId,
    });
  }

  applyTodoList(entries: AgentPlanEntry[]): void {
    const next: AgentTodoListEntry[] = entries.map((e) => ({
      content: e.content,
      status: e.status,
    }));
    const signature = next.length > 0 ? JSON.stringify(next) : null;
    if (signature === this.currentTodoListSignature) return;
    this.currentTodoList = next.length > 0 ? next : null;
    this.currentTodoListSignature = signature;
    this.deps.notifyTodoListChanged();
  }

  dispose(): void {
    this.flushResolvers(this.pendingPlanResolvers);
    this.flushResolvers(this.pendingToolResolvers);
    this.flushQuestionResolvers();
    this.decidedPlanToolCallIds.clear();
    this.currentPlan = null;
    this.currentTodoList = null;
    this.currentTodoListSignature = null;
  }
}

function decisionFor(
  req: PermissionPrompt,
  kinds: ReadonlyArray<PermissionOptionKind>
): PermissionDecision {
  for (const k of kinds) {
    const opt = req.options.find((o) => o.kind === k);
    if (opt) return { outcome: { outcome: "selected", optionId: opt.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}
