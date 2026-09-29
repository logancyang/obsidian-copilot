import type { SliceOp } from "@/agentMode/protocol/ops";
import {
  EMPTY_PENDING,
  type PendingState,
  type SessionState,
  type WireQuestionPrompt,
} from "@/agentMode/protocol/state";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AskUserQuestionPrompt, PermissionPrompt } from "@/agentMode/session/types";

type SliceValues = Omit<SessionState, "transcript">;

const wireQuestionByRequest = new WeakMap<AskUserQuestionPrompt, WireQuestionPrompt>();

function toWireQuestion(request: AskUserQuestionPrompt): WireQuestionPrompt {
  const cached = wireQuestionByRequest.get(request);
  if (cached) return cached;
  const wire: WireQuestionPrompt = {
    sessionId: request.sessionId,
    requestId: request.requestId,
    questions: request.questions,
  };
  wireQuestionByRequest.set(request, wire);
  return wire;
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export class SessionProjector {
  private values: SliceValues;
  private permissions: readonly PermissionPrompt[] = [];
  private questions: readonly AskUserQuestionPrompt[] = [];

  constructor(
    private readonly session: AgentSession,
    private readonly emit: (op: SliceOp) => void
  ) {
    this.values = {
      backendState: session.getState(),
      pending: EMPTY_PENDING,
      plan: session.getCurrentPlan(),
      todos: session.getCurrentTodoList(),
      usage: session.getSessionUsage(),
      planUsage: session.getPlanUsage(),
    };
    this.values = { ...this.values, pending: this.readPending() ?? EMPTY_PENDING };
  }

  getSlices(): SliceValues {
    return this.values;
  }

  project(): void {
    const { session } = this;
    this.set("backendState", session.getState());
    this.set("plan", session.getCurrentPlan());
    this.set("todos", session.getCurrentTodoList());
    this.set("usage", session.getSessionUsage());
    this.set("planUsage", session.getPlanUsage());
    const pending = this.readPending();
    if (pending) this.set("pending", pending);
  }

  private readPending(): PendingState | null {
    const { session } = this;
    const permissions = session.getPendingToolPermissions();
    const questions = session.getPendingAskUserQuestions();
    const planPermission = session.hasPendingPlanPermission();
    if (
      sameItems(permissions, this.permissions) &&
      sameItems(questions, this.questions) &&
      planPermission === this.values.pending.planPermission
    ) {
      return null;
    }
    this.permissions = permissions;
    this.questions = questions;
    if (permissions.length === 0 && questions.length === 0 && !planPermission) return EMPTY_PENDING;
    return { permissions, questions: questions.map(toWireQuestion), planPermission };
  }

  private set<K extends keyof SliceValues>(key: K, value: SliceValues[K]): void {
    if (Object.is(this.values[key], value)) return;
    this.values = { ...this.values, [key]: value };
    this.emit({ t: "slice", key, value } as SliceOp);
  }
}
