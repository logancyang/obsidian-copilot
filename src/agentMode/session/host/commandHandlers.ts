import type { Command, CommandResult, CommandValues } from "@/agentMode/protocol/commands";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_BYTES_PER_COMMAND,
  MAX_IMAGES_PER_COMMAND,
  decodedBase64Bytes,
} from "@/agentMode/protocol/limits";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { PromptContent } from "@/agentMode/session/types";
import { logError } from "@/logger";
import type { MessageContext } from "@/types/message";
import type { TFile } from "obsidian";

export interface SessionHostManager {
  getSessions(): AgentSession[];
  getTabSessions(): AgentSession[];
  getSession(id: string): AgentSession | null;
  getChatUIState(id: string): AgentChatUIState | null;
  subscribe(listener: () => void): () => void;
}

export interface CommandContext {
  manager: SessionHostManager;
  resolveNote(path: string): TFile | null;
  isKnownBackend(backendId: string): boolean;
}

interface Target {
  session: AgentSession;
  ui: AgentChatUIState;
}

type Failure = Extract<CommandResult, { ok: false }>;

function failure(code: Failure["code"], message: string): Failure {
  return { ok: false, code, message };
}

function ok<V>(value: V): CommandResult<V> {
  return { ok: true, value };
}

function findTarget(ctx: CommandContext, sessionId: string): Target | Failure {
  const session = ctx.manager.getSession(sessionId);
  const ui = ctx.manager.getChatUIState(sessionId);
  if (!session || !ui) return failure("unknown_session", `No session ${sessionId}`);
  return { session, ui };
}

function isFailure(value: Target | Failure): value is Failure {
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
  if (images.length > MAX_IMAGES_PER_COMMAND) {
    return failure("too_large", `At most ${MAX_IMAGES_PER_COMMAND} images per message`);
  }
  let totalBytes = 0;
  const content: PromptContent[] = [];
  for (const image of images) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(image.mimeType)) {
      return failure("invalid", `Unsupported image type ${image.mimeType}`);
    }
    const bytes = decodedBase64Bytes(image.data);
    totalBytes += bytes;
    if (bytes > MAX_IMAGE_BYTES || totalBytes > MAX_IMAGE_BYTES_PER_COMMAND) {
      return failure("too_large", "Image data exceeds the size limit");
    }
    content.push({ type: "image", mimeType: image.mimeType, data: image.data });
  }
  return content;
}

function sendCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "send" }>
): CommandResult<CommandValues["send"]> {
  const target = findTarget(ctx, command.sessionId);
  if (isFailure(target)) return target;
  const unsendable = checkSendable(target.session);
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

  const { id } = target.ui.sendMessage(
    command.text,
    context,
    promptContent.length > 0 ? promptContent : undefined,
    command.mentionedAgents && command.mentionedAgents.length > 0
      ? command.mentionedAgents
      : undefined
  );
  return ok({ userMessageId: id, droppedNotePaths });
}

async function cancelCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "cancel" }>
): Promise<CommandResult<void>> {
  const target = findTarget(ctx, command.sessionId);
  if (isFailure(target)) return target;
  await target.ui.cancel();
  return ok(undefined);
}

function resolvePermissionCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "resolvePermission" }>
): CommandResult<void> {
  const target = findTarget(ctx, command.sessionId);
  if (isFailure(target)) return target;
  const prompt = target.session
    .getPendingToolPermissions()
    .find((candidate) => candidate.toolCall.toolCallId === command.toolCallId);
  if (!prompt) return failure("stale", "That permission request is no longer pending");
  if (!prompt.options.some((option) => option.optionId === command.optionId)) {
    return failure("invalid", `Unknown option ${command.optionId}`);
  }
  target.ui.resolveToolPermission(command.toolCallId, command.optionId);
  return ok(undefined);
}

function answerQuestionCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "answerQuestion" }>
): CommandResult<void> {
  const target = findTarget(ctx, command.sessionId);
  if (isFailure(target)) return target;
  const request = target.session
    .getPendingAskUserQuestions()
    .find((candidate) => candidate.requestId === command.requestId);
  if (!request) return failure("stale", "That question is no longer pending");
  const allowedKeys = new Set(request.questions.map((q) => q.answerKey ?? q.question));
  const entries = Object.entries(command.answers ?? {});
  if (entries.some(([key, value]) => !allowedKeys.has(key) || typeof value !== "string")) {
    return failure("invalid", "Answers must match the question keys and be strings");
  }
  target.ui.resolveAskUserQuestion(command.requestId, command.answers);
  return ok(undefined);
}

function resolvePlanCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "resolvePlan" }>
): CommandResult<void> {
  const target = findTarget(ctx, command.sessionId);
  if (isFailure(target)) return target;
  if (!["approve", "reject", "feedback"].includes(command.decision)) {
    return failure("invalid", `Unknown decision ${String(command.decision)}`);
  }
  if (command.feedbackText !== undefined && command.decision !== "feedback") {
    return failure("invalid", "Feedback text only applies to a feedback decision");
  }
  const plan = target.session.getCurrentPlan();
  if (
    !plan ||
    plan.id !== command.proposalId ||
    plan.decision !== "pending" ||
    !plan.permissionGated ||
    !target.session.hasPendingPlanPermission()
  ) {
    return failure("stale", "That plan is no longer awaiting a decision");
  }
  // The next-turn feedback path waits for the running turn to settle, which can outlast the
  // command; the decision itself is applied synchronously before this returns.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/609
  target.ui
    .resolvePlanProposal(command.proposalId, command.decision, command.feedbackText)
    .catch((e) => logError("[AgentMode] plan decision failed", e));
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
