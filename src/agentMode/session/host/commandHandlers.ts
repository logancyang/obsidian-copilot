import type { Command, CommandResult, CommandValues } from "@/agentMode/protocol/commands";
import { checkImageLimits, decodedBase64Bytes } from "@/agentMode/protocol/limits";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { applyPlanDecision, findDecidablePlan } from "@/agentMode/session/planDecision";
import type { PromptContent } from "@/agentMode/session/types";
import { logError } from "@/logger";
import type { MessageContext } from "@/types/message";
import type { TFile } from "obsidian";

export interface SessionHostManager {
  getSessions(): AgentSession[];
  getTabSessions(): AgentSession[];
  getSession(id: string): AgentSession | null;
  subscribe(listener: () => void): () => void;
}

export interface CommandContext {
  manager: SessionHostManager;
  resolveNote(path: string): TFile | null;
  isKnownBackend(backendId: string): boolean;
}

type Failure = Extract<CommandResult, { ok: false }>;

function failure(code: Failure["code"], message: string): Failure {
  return { ok: false, code, message };
}

function ok<V>(value: V): CommandResult<V> {
  return { ok: true, value };
}

function findSession(ctx: CommandContext, sessionId: string): AgentSession | Failure {
  const session = ctx.manager.getSession(sessionId);
  return session ?? failure("unknown_session", `No session ${sessionId}`);
}

function isFailure(value: AgentSession | Failure): value is Failure {
  return "ok" in value;
}

function checkSendable(session: AgentSession): Failure | null {
  switch (session.getStatus()) {
    case "starting":
      return failure("session_starting", "Session is still starting");
    case "running":
    case "awaiting_permission":
      return failure("session_busy", "Session already has a turn in flight");
    case "closed":
      return failure("session_closed", "Session is closed");
    default:
      return null;
  }
}

function buildImageContent(
  images: NonNullable<Extract<Command, { name: "send" }>["images"]>
): PromptContent[] | Failure {
  const violation = checkImageLimits(
    images.map((image) => ({ mimeType: image.mimeType, bytes: decodedBase64Bytes(image.data) }))
  );
  if (violation) return failure(violation.code, violation.message);
  return images.map((image) => ({ type: "image", mimeType: image.mimeType, data: image.data }));
}

function sendCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "send" }>
): CommandResult<CommandValues["send"]> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  const unsendable = checkSendable(session);
  if (unsendable) return unsendable;

  const images = command.images ?? [];
  if (typeof command.text !== "string" || (!command.text.trim() && images.length === 0)) {
    return failure("invalid", "A message needs text or an image");
  }
  const promptContent = buildImageContent(images);
  if (!Array.isArray(promptContent)) return promptContent;
  const unknownAgent = command.mentionedAgents?.find((id) => !ctx.isKnownBackend(id));
  if (unknownAgent !== undefined) return failure("invalid", `Unknown agent ${unknownAgent}`);

  const droppedNotePaths: string[] = [];
  let context: MessageContext | undefined;
  if (command.context) {
    const { notePaths, ...rest } = command.context;
    const notes: TFile[] = [];
    for (const path of notePaths) {
      const file = ctx.resolveNote(path);
      if (file) notes.push(file);
      else droppedNotePaths.push(path);
    }
    context = { ...rest, notes };
  }

  const { userMessageId, turn } = session.sendPrompt(
    command.text,
    context,
    promptContent.length > 0 ? promptContent : undefined,
    command.mentionedAgents && command.mentionedAgents.length > 0
      ? command.mentionedAgents
      : undefined
  );
  turn.catch((e) => logError("[AgentMode] turn failed", e));
  return ok({ userMessageId, droppedNotePaths });
}

async function cancelCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "cancel" }>
): Promise<CommandResult<void>> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  await session.cancel();
  return ok(undefined);
}

function resolvePermissionCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "resolvePermission" }>
): CommandResult<void> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  const prompt = session
    .getPendingToolPermissions()
    .find((candidate) => candidate.toolCall.toolCallId === command.toolCallId);
  if (!prompt) return failure("stale", "That permission request is no longer pending");
  if (!prompt.options.some((option) => option.optionId === command.optionId)) {
    return failure("invalid", `Unknown option ${command.optionId}`);
  }
  session.resolveToolPermission(command.toolCallId, command.optionId);
  return ok(undefined);
}

function answerQuestionCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "answerQuestion" }>
): CommandResult<void> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  const request = session
    .getPendingAskUserQuestions()
    .find((candidate) => candidate.requestId === command.requestId);
  if (!request) return failure("stale", "That question is no longer pending");
  const allowedKeys = new Set(request.questions.map((q) => q.answerKey ?? q.question));
  const { answers } = command;
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return failure("invalid", "Answers must be an object keyed by question");
  }
  const entries = Object.entries(answers);
  if (entries.some(([key, value]) => !allowedKeys.has(key) || typeof value !== "string")) {
    return failure("invalid", "Answers must match the question keys and be strings");
  }
  session.resolveAskUserQuestion(command.requestId, answers);
  return ok(undefined);
}

function resolvePlanCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "resolvePlan" }>
): CommandResult<void> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  if (!["approve", "reject", "feedback"].includes(command.decision)) {
    return failure("invalid", `Unknown decision ${String(command.decision)}`);
  }
  if (command.feedbackText !== undefined && command.decision !== "feedback") {
    return failure("invalid", "Feedback text only applies to a feedback decision");
  }
  const plan = findDecidablePlan(session, command.proposalId);
  if (!plan) return failure("stale", "That plan is no longer awaiting a decision");
  // The next-turn feedback path waits for the running turn to settle, which can outlast the
  // command; the decision itself is applied synchronously before this returns.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/609
  applyPlanDecision(session, plan, command.decision, command.feedbackText).catch((e) =>
    logError("[AgentMode] plan decision failed", e)
  );
  return ok(undefined);
}

export async function runCommand(
  ctx: CommandContext,
  command: Command
): Promise<CommandResult<unknown>> {
  try {
    switch (command.name) {
      case "send":
        return sendCommand(ctx, command);
      case "cancel":
        return await cancelCommand(ctx, command);
      case "resolvePermission":
        return resolvePermissionCommand(ctx, command);
      case "answerQuestion":
        return answerQuestionCommand(ctx, command);
      case "resolvePlan":
        return resolvePlanCommand(ctx, command);
      default:
        return failure("invalid", "Unknown command");
    }
  } catch (e) {
    logError("[AgentMode] command failed", e);
    return failure("failed", "The command could not be completed");
  }
}
