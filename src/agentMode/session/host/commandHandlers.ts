import type { Command, CommandResult, CommandValues } from "@/agentMode/protocol/commands";
import { checkImageLimits, decodedBase64Bytes } from "@/agentMode/protocol/limits";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { ReplaceSessionOptions } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { applyPlanDecision, findDecidablePlan } from "@/agentMode/session/planDecision";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import type {
  BackendId,
  CopilotMode,
  ModelSelection,
  PromptContent,
} from "@/agentMode/session/types";
import { logError } from "@/logger";
import type { MessageContext } from "@/types/message";
import type { TFile } from "obsidian";

export interface SessionHostManager {
  getSessions(): AgentSession[];
  getTabSessions(): AgentSession[];
  getSession(id: string): AgentSession | null;
  subscribe(listener: () => void): () => void;
  createSession(
    backendId?: BackendId,
    projectId?: ProjectScopeId,
    seedSelection?: ModelSelection
  ): Promise<AgentSession>;
  replaceSessionInPlace(
    oldId: string,
    backendId?: BackendId,
    options?: ReplaceSessionOptions
  ): Promise<AgentSession>;
  openTab(id: string): void;
  detachSessionFromTab(id: string): void;
  renameSession(id: string, label: string | null): void;
  applySelectionTo(
    id: string,
    patch: { baseModelId?: string; effort?: string | null }
  ): Promise<void>;
  applyModeTo(id: string, mode: CopilotMode): Promise<void>;
}

export interface CommandContext {
  manager: SessionHostManager;
  resolveNote(path: string): TFile | null;
  isKnownBackend(backendId: string): boolean;
  isKnownProject(projectId: string): boolean;
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

function isModelSelection(value: unknown): value is ModelSelection {
  if (typeof value !== "object" || value === null) return false;
  const { baseModelId, effort } = value as Record<string, unknown>;
  return (
    typeof baseModelId === "string" &&
    baseModelId.length > 0 &&
    (effort === null || typeof effort === "string")
  );
}

function checkSeedAndBackend(
  ctx: CommandContext,
  backendId: string | undefined,
  seedSelection: unknown
): Failure | null {
  if (backendId !== undefined && !ctx.isKnownBackend(backendId)) {
    return failure("invalid", `Unknown agent ${String(backendId)}`);
  }
  if (seedSelection !== undefined && !isModelSelection(seedSelection)) {
    return failure("invalid", "A seed selection needs a model id and an effort or null");
  }
  return null;
}

async function createSessionCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "createSession" }>
): Promise<CommandResult<CommandValues["createSession"]>> {
  const invalid = checkSeedAndBackend(ctx, command.backendId, command.seedSelection);
  if (invalid) return invalid;
  if (command.projectId !== undefined && typeof command.projectId !== "string") {
    return failure("invalid", "A project scope must be a string");
  }
  // A phone names the project scope it is showing by id; an id the desktop does not know would
  // start a session in a scope nothing else can display.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
  if (command.projectId !== undefined && !ctx.isKnownProject(command.projectId)) {
    return failure("invalid", `Unknown project ${command.projectId}`);
  }
  const session = await ctx.manager.createSession(
    command.backendId,
    command.projectId ?? GLOBAL_SCOPE,
    command.seedSelection
  );
  return ok({ sessionId: session.internalId });
}

async function replaceSessionCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "replaceSession" }>
): Promise<CommandResult<CommandValues["replaceSession"]>> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  const invalid = checkSeedAndBackend(ctx, command.backendId, command.seedSelection);
  if (invalid) return invalid;
  const created = await ctx.manager.replaceSessionInPlace(session.internalId, command.backendId, {
    preserveChatInput: command.preserveChatInput === true,
    seedSelection: command.seedSelection,
  });
  return ok({ sessionId: created.internalId });
}

function openTabCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "openTab" }>
): CommandResult<void> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  ctx.manager.openTab(session.internalId);
  return ok(undefined);
}

function closeTabCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "closeTab" }>
): CommandResult<void> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  ctx.manager.detachSessionFromTab(session.internalId);
  return ok(undefined);
}

function renameSessionCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "renameSession" }>
): CommandResult<void> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  if (command.label !== null && typeof command.label !== "string") {
    return failure("invalid", "A label is text or null");
  }
  ctx.manager.renameSession(session.internalId, command.label);
  return ok(undefined);
}

async function applySelectionCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "applySelection" }>
): Promise<CommandResult<CommandValues["applySelection"]>> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  const { backendId, baseModelId, effort } = command;
  if (!ctx.isKnownBackend(backendId)) return failure("invalid", `Unknown agent ${backendId}`);
  if (baseModelId === undefined && effort === undefined) {
    return failure("invalid", "A selection needs a model or an effort");
  }
  if (baseModelId !== undefined && (typeof baseModelId !== "string" || baseModelId === "")) {
    return failure("invalid", "A model id is a non-empty string");
  }
  if (effort !== undefined && effort !== null && typeof effort !== "string") {
    return failure("invalid", "An effort is text or null");
  }
  if (session.backendId !== backendId) {
    // Picking another agent's model swaps the tab's session for one on that agent, seeded with the
    // pick, so the composer draft and the tab's place survive. An effort-only change has no model
    // to seed and means the client was looking at a session that has since been replaced.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/612
    if (baseModelId === undefined) return failure("stale", "The session's agent changed");
    // A chat cannot change agents once it holds messages. The pick was drawn while the tab was
    // empty and another client has sent a message since, so replacing would drop that chat.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/612
    if (session.hasUserVisibleMessages()) {
      return failure("stale", "A chat that has messages cannot change agents");
    }
    const created = await ctx.manager.replaceSessionInPlace(session.internalId, backendId, {
      preserveChatInput: true,
      seedSelection: { baseModelId, effort: effort ?? null },
    });
    return ok({ sessionId: created.internalId });
  }
  await ctx.manager.applySelectionTo(session.internalId, {
    ...(baseModelId !== undefined ? { baseModelId } : {}),
    ...(effort !== undefined ? { effort } : {}),
  });
  return ok({ sessionId: session.internalId });
}

async function applyModeCommand(
  ctx: CommandContext,
  command: Extract<Command, { name: "applyMode" }>
): Promise<CommandResult<void>> {
  const session = findSession(ctx, command.sessionId);
  if (isFailure(session)) return session;
  const mode = session.getState()?.mode;
  if (!mode?.apply[command.mode]) {
    return failure("invalid", `The session has no ${String(command.mode)} mode`);
  }
  await ctx.manager.applyModeTo(session.internalId, command.mode);
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
      case "createSession":
        return await createSessionCommand(ctx, command);
      case "replaceSession":
        return await replaceSessionCommand(ctx, command);
      case "openTab":
        return openTabCommand(ctx, command);
      case "closeTab":
        return closeTabCommand(ctx, command);
      case "renameSession":
        return renameSessionCommand(ctx, command);
      case "applySelection":
        return await applySelectionCommand(ctx, command);
      case "applyMode":
        return await applyModeCommand(ctx, command);
      default:
        return failure("invalid", "Unknown command");
    }
  } catch (e) {
    if (e instanceof MethodUnsupportedError) {
      return failure("unsupported", "This agent does not support that change while running");
    }
    logError("[AgentMode] command failed", e);
    return failure("failed", "The command could not be completed");
  }
}
