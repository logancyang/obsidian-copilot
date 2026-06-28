/**
 * Pure translators between ACP wire types and the session-domain types
 * defined in `session/types.ts`. The shapes mostly mirror each other (we
 * intentionally modelled the session domain on ACP's vocabulary), so most
 * translators are structural identity casts. Keeping them in one file
 * isolates the seam: when ACP evolves, this is the only place that needs
 * updating.
 */
import type {
  CancelNotification,
  ContentBlock,
  McpServer as AcpMcpServer,
  ModelInfo as AcpModelInfo,
  PermissionOption as AcpPermissionOption,
  Plan as AcpPlan,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionId as AcpSessionId,
  SessionModeState,
  SessionModelState,
  SessionNotification,
  StopReason as AcpStopReason,
  ToolCall,
  ToolCallContent as AcpToolCallContent,
  ToolCallUpdate,
  ToolKind as AcpToolKind,
} from "@agentclientprotocol/sdk";
import type {
  AgentPlanEntry,
  AgentToolKind,
  AgentToolStatus,
  BackendConfigOption,
  BackendDescriptor,
  RawModeState,
  RawModelState,
  BackendState,
  CancelInput,
  ListedSessionInfo,
  McpServerSpec,
  PermissionDecision,
  PermissionOption,
  PermissionPrompt,
  PromptContent,
  SessionEvent,
  SessionId,
  SessionUpdate,
  StopReason,
  ToolCallContent,
  ToolCallDelta,
  ToolCallSnapshot,
} from "@/agentMode/session/types";
import { PERMISSION_OPTION_KINDS } from "@/agentMode/session/types";
import { resolveToolName } from "@/agentMode/session/toolName";
import { translateBackendState } from "@/agentMode/session/translateBackendState";

// ---- Catalog wire → neutral (pass-through, structural alias) -----------

export function modelStateFromAcp(
  state: SessionModelState | null | undefined
): RawModelState | null {
  if (!state) return null;
  return {
    currentModelId: state.currentModelId,
    availableModels: state.availableModels.map((m) => ({
      modelId: m.modelId,
      name: m.name,
      description: m.description ?? undefined,
    })),
  };
}

export function modeStateFromAcp(state: SessionModeState | null | undefined): RawModeState | null {
  if (!state) return null;
  return {
    currentModeId: state.currentModeId,
    availableModes: state.availableModes.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description ?? undefined,
    })),
  };
}

export function configOptionsFromAcp(
  options: SessionConfigOption[] | null | undefined
): BackendConfigOption[] | null {
  if (!options) return null;
  return options.map(configOptionFromAcp);
}

function configOptionFromAcp(opt: SessionConfigOption): BackendConfigOption {
  if (opt.type === "select") {
    return {
      id: opt.id,
      type: "select",
      name: opt.name,
      description: opt.description ?? undefined,
      category: opt.category ?? null,
      currentValue: String(opt.currentValue),
      options: opt.options.map((entry) => {
        if ("options" in entry) {
          return {
            name: entry.name,
            options: entry.options.map((inner) => ({
              value: inner.value,
              name: inner.name,
              description: inner.description ?? undefined,
            })),
          };
        }
        return {
          value: entry.value,
          name: entry.name,
          description: entry.description ?? undefined,
        };
      }),
    };
  }
  return {
    id: opt.id,
    type: "boolean",
    name: opt.name,
    description: opt.description ?? undefined,
    category: opt.category ?? null,
    currentValue: Boolean((opt as { currentValue: unknown }).currentValue),
  };
}

export function configOptionToAcp(opt: BackendConfigOption): SessionConfigOption {
  // SDK's SessionConfigOption shape mirrors our neutral shape; cast through.
  return opt as unknown as SessionConfigOption;
}

export function modelInfoFromAcp(model: AcpModelInfo): {
  modelId: string;
  name: string;
  description?: string;
} {
  return {
    modelId: model.modelId,
    name: model.name,
    description: model.description ?? undefined,
  };
}

export function acpStateToBackendState(
  models: SessionModelState | null | undefined,
  modes: SessionModeState | null | undefined,
  configOptions: SessionConfigOption[] | null | undefined,
  descriptor: BackendDescriptor
): BackendState {
  return translateBackendState(
    {
      models: modelStateFromAcp(models),
      modes: modeStateFromAcp(modes),
      configOptions: configOptionsFromAcp(configOptions),
    },
    descriptor
  );
}

// ---- StopReason --------------------------------------------------------

export function stopReasonFromAcp(reason: AcpStopReason): StopReason {
  switch (reason) {
    case "end_turn":
    case "cancelled":
    case "refusal":
    case "max_tokens":
    case "max_turn_requests":
      return reason;
    default:
      return "end_turn";
  }
}

// ---- Tool kind / status (ACP enum subsets) -----------------------------

export function toolKindFromAcp(kind: AcpToolKind | undefined): AgentToolKind | undefined {
  if (kind == null) return undefined;
  return kind;
}

function toolStatusFromAcp(status: string | undefined): AgentToolStatus | undefined {
  if (!status) return undefined;
  return status as AgentToolStatus;
}

// ---- Content blocks ----------------------------------------------------

export function promptContentToAcp(blocks: PromptContent[]): ContentBlock[] {
  return blocks.map((b): ContentBlock => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "image") return { type: "image", mimeType: b.mimeType, data: b.data };
    return { type: "resource_link", uri: b.uri, name: b.name ?? b.uri };
  });
}

export function promptContentFromAcp(block: ContentBlock): PromptContent | null {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "image") return { type: "image", mimeType: block.mimeType, data: block.data };
  if (block.type === "resource_link")
    return { type: "resource_link", uri: block.uri, name: block.name ?? undefined };
  return null;
}

function toolCallContentFromAcp(
  content: AcpToolCallContent[] | null | undefined
): ToolCallContent[] | undefined {
  if (!content) return undefined;
  const out: ToolCallContent[] = [];
  for (const item of content) {
    if (item.type === "content" && item.content.type === "text") {
      out.push({ type: "content", content: { type: "text", text: item.content.text } });
    } else if (item.type === "diff") {
      out.push({
        type: "diff",
        path: item.path,
        oldText: item.oldText ?? null,
        newText: item.newText,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function toolCallSnapshotFromAcp(
  call: ToolCall & { sessionUpdate?: "tool_call" }
): ToolCallSnapshot {
  const { tool: title, mcpServer } = resolveToolName(call.title);
  return {
    toolCallId: call.toolCallId,
    title,
    kind: toolKindFromAcp(call.kind),
    status: toolStatusFromAcp(call.status),
    rawInput: call.rawInput,
    content: toolCallContentFromAcp(call.content),
    locations: call.locations?.map((l) => ({ path: l.path, line: l.line ?? undefined })),
    mcpServer,
  };
}

function mapNullable<T, R>(value: T | null | undefined, fn: (value: T) => R): R | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return fn(value);
}

function toolCallDeltaFromAcp(
  upd: ToolCallUpdate & { sessionUpdate?: "tool_call_update" }
): ToolCallDelta {
  const resolved = upd.title != null ? resolveToolName(upd.title) : null;
  return {
    toolCallId: upd.toolCallId,
    title: resolved?.tool,
    kind: toolKindFromAcp(upd.kind ?? undefined),
    status: toolStatusFromAcp(upd.status as string | undefined),
    rawInput: upd.rawInput,
    content: mapNullable(upd.content, toolCallContentFromAcp),
    locations: mapNullable(upd.locations, (locs) =>
      locs.map((l) => ({ path: l.path, line: l.line ?? undefined }))
    ),
    mcpServer: resolved?.mcpServer,
  };
}

// ---- Notification → SessionEvent --------------------------------------

/**
 * One wire notification can yield more than one session event: a `todowrite`
 * tool call additionally synthesizes the standard `plan` update (see
 * {@link todoToolPlanFromAcp}), so the trail's PlanPill and the todo snapshot
 * stay backend-agnostic. The base translation always comes first.
 *
 * `todoToolCallIds` is one session's id set, owned by the caller
 * (AcpBackendProcess keys it per session — see `todoToolCallIdsFor`): the first
 * `todowrite`-titled tool call registers its id, so later `tool_call_update`s
 * for the same call still synthesize even after opencode renames the title
 * (e.g. "3 todos") or drops it. Omit it (tests, replay) to fall back to
 * title-only recognition.
 */
export function acpNotificationToEvents(
  n: SessionNotification,
  todoToolCallIds?: Set<string>
): SessionEvent[] {
  const sessionId = sessionIdFromAcp(n.sessionId);
  const events: SessionEvent[] = [{ sessionId, update: acpUpdateToSessionUpdate(n.update) }];
  const todoPlan = todoToolPlanFromAcp(n.update, todoToolCallIds);
  if (todoPlan) events.push({ sessionId, update: todoPlan });
  return events;
}

/**
 * opencode reports its execution todo list as a generic `todowrite` tool call
 * whose `rawInput.todos` carries the full list — current releases (1.17.3)
 * have NO plan-channel emission at all (verified: binary-string audit + live
 * probes, designdocs/agent-projects/verify/README.md "Task-list channel").
 * Synthesize the standard `plan` update from it. Builds that DO emit a real
 * plan update coexist fine: identical entries dedupe downstream
 * (`planEntriesEqual` for the message part, signature compare for the
 * snapshot).
 *
 * Tool identity: the initial `tool_call` titles itself `todowrite`; opencode
 * then mutates follow-up update titles (e.g. "3 todos"). We register the
 * call's id on first sight (title === todowrite) so subsequent updates for the
 * same id keep synthesizing regardless of title — and unknown ids are ignored,
 * so a stray `{todos}` payload from another tool/backend can't masquerade.
 */
function todoToolPlanFromAcp(
  update: SessionNotification["update"],
  todoToolCallIds?: Set<string>
): SessionUpdate | null {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return null;
  }
  const toolCallId = (update as { toolCallId?: string }).toolCallId;
  const title = (update as { title?: string | null }).title;
  const isTodoTitle =
    title != null &&
    (() => {
      const { tool, mcpServer } = resolveToolName(title);
      return !mcpServer && tool.toLowerCase() === "todowrite";
    })();

  if (isTodoTitle && toolCallId) todoToolCallIds?.add(toolCallId);

  // Recognized when the title says todowrite, or the id was registered from an
  // earlier todowrite-titled call. Without a tracker (tests/replay), fall back
  // to title-only — a renamed follow-up is then skipped, but its predecessor
  // already delivered the same list.
  const recognized =
    isTodoTitle || (toolCallId != null && todoToolCallIds?.has(toolCallId) === true);
  if (!recognized) return null;

  const todos = (update.rawInput as { todos?: unknown } | undefined)?.todos;
  if (!Array.isArray(todos)) return null;
  const entries: AgentPlanEntry[] = [];
  for (const todo of todos) {
    if (typeof todo !== "object" || todo === null) continue;
    const t = todo as { content?: unknown; status?: unknown; priority?: unknown };
    if (typeof t.content !== "string" || t.content.length === 0) continue;
    if (t.status !== "pending" && t.status !== "in_progress" && t.status !== "completed") continue;
    entries.push({
      content: t.content,
      status: t.status,
      priority:
        t.priority === "high" || t.priority === "medium" || t.priority === "low"
          ? t.priority
          : "medium",
    });
  }
  // A recognized todo tool reporting `todos: []` is a genuine clear — emit an
  // empty plan so the snapshot resets (matching the claude path, which emits an
  // empty plan when its last task is removed). But a NON-empty array that
  // filtered down to nothing is malformed input, not a clear: don't wipe a good
  // list on garbage. (`todos` is already array-guarded above.)
  if (entries.length === 0 && todos.length > 0) return null;
  return { sessionUpdate: "plan", entries };
}

function acpUpdateToSessionUpdate(update: SessionNotification["update"]): SessionUpdate {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return {
        sessionUpdate: "agent_message_chunk",
        content: promptContentFromAcp(update.content) ?? { type: "text", text: "" },
        messageId: update.messageId ?? undefined,
      };
    case "agent_thought_chunk":
      return {
        sessionUpdate: "agent_thought_chunk",
        content: promptContentFromAcp(update.content) ?? { type: "text", text: "" },
        messageId: update.messageId ?? undefined,
      };
    case "tool_call":
      return {
        sessionUpdate: "tool_call",
        ...toolCallSnapshotFromAcp(update),
      };
    case "tool_call_update":
      return {
        sessionUpdate: "tool_call_update",
        ...toolCallDeltaFromAcp(update),
      };
    case "plan":
      return {
        sessionUpdate: "plan",
        entries: update.entries.map((e: AcpPlan["entries"][number]) => ({
          content: e.content,
          priority: e.priority,
          status: e.status,
        })),
      };
    case "session_info_update":
      return {
        sessionUpdate: "session_info_update",
        title: (update as { title?: string | null }).title ?? null,
      };
    case "current_mode_update":
      return {
        sessionUpdate: "current_mode_update",
        currentModeId: update.currentModeId,
      };
    case "config_option_update":
      return {
        sessionUpdate: "config_option_update",
        configOptions: configOptionsFromAcp(update.configOptions) ?? [],
      };
    default:
      // Unknown discriminant — fall back to a benign session_info_update with no title.
      return { sessionUpdate: "session_info_update", title: null };
  }
}

// ---- Permission prompt / decision -------------------------------------

export function acpPermissionRequestToPrompt(req: RequestPermissionRequest): PermissionPrompt {
  const call = req.toolCall;
  return {
    sessionId: sessionIdFromAcp(req.sessionId),
    toolCall: {
      toolCallId: call.toolCallId,
      title: call.title ?? "Tool call",
      kind: toolKindFromAcp(call.kind ?? undefined),
      status: toolStatusFromAcp(call.status as string | undefined) ?? "pending",
      rawInput: call.rawInput,
      content: toolCallContentFromAcp(call.content),
      locations: call.locations?.map((l) => ({ path: l.path, line: l.line ?? undefined })),
    },
    options: req.options.map(permissionOptionFromAcp),
  };
}

function permissionOptionFromAcp(opt: AcpPermissionOption): PermissionOption {
  return {
    optionId: opt.optionId,
    name: opt.name,
    kind: (PERMISSION_OPTION_KINDS as readonly string[]).includes(opt.kind)
      ? opt.kind
      : "reject_once",
  };
}

export function permissionPromptToAcp(prompt: PermissionPrompt): RequestPermissionRequest {
  return {
    sessionId: prompt.sessionId,
    toolCall: {
      toolCallId: prompt.toolCall.toolCallId,
      title: prompt.toolCall.title,
      kind: prompt.toolCall.kind,
      status: prompt.toolCall.status ?? "pending",
      rawInput: prompt.toolCall.rawInput,
    },
    options: prompt.options.map((o) => ({
      optionId: o.optionId,
      name: o.name,
      kind: o.kind,
    })),
  };
}

export function acpDecisionFromResponse(resp: RequestPermissionResponse): PermissionDecision {
  if (resp.outcome.outcome === "cancelled") {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: resp.outcome.optionId } };
}

export function decisionToAcpResponse(decision: PermissionDecision): RequestPermissionResponse {
  return decision;
}

// ---- MCP server --------------------------------------------------------

export function mcpServerSpecToAcp(spec: McpServerSpec): AcpMcpServer {
  if ("type" in spec && spec.type === "http") {
    return { type: "http", name: spec.name, url: spec.url, headers: spec.headers };
  }
  if ("type" in spec && spec.type === "sse") {
    return { type: "sse", name: spec.name, url: spec.url, headers: spec.headers };
  }
  // stdio
  return {
    name: spec.name,
    command: spec.command,
    args: spec.args,
    env: spec.env,
  };
}

// ---- SessionId / Cancel -----------------------------------------------

export function sessionIdFromAcp(id: AcpSessionId): SessionId {
  return id;
}

export function sessionIdToAcp(id: SessionId): AcpSessionId {
  return id;
}

export function cancelInputToAcp(input: CancelInput): CancelNotification {
  return { sessionId: sessionIdToAcp(input.sessionId) };
}

export function listedSessionFromAcp(s: {
  sessionId: AcpSessionId;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
}): ListedSessionInfo {
  return {
    sessionId: sessionIdFromAcp(s.sessionId),
    cwd: s.cwd,
    title: s.title ?? null,
    updatedAt: s.updatedAt ?? null,
  };
}
