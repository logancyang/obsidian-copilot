/**
 * Type definitions for Claude Code SDK integration
 *
 * These types mirror the @anthropic-ai/claude-agent-sdk types and define
 * the StreamChunk format used for processing SDK messages in the UI.
 */

// ============================================================================
// SDK Message Types (from @anthropic-ai/claude-agent-sdk)
// ============================================================================

/**
 * Unique identifier type - UUID format required by SDK
 */
export type UUID = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Content block types that can appear in assistant messages
 */
export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: string; [key: string]: unknown }> | null;
  is_error?: boolean;
}

/**
 * Union of all content block types
 */
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

/**
 * API message types (from Anthropic SDK)
 */
export interface APIAssistantMessage {
  role: "assistant";
  content: ContentBlock[];
}

export interface APIUserMessage {
  role: "user";
  content: string | ContentBlock[];
}

/**
 * SDK Assistant Message
 */
export interface SDKAssistantMessage {
  type: "assistant";
  uuid: UUID;
  session_id: string;
  message: APIAssistantMessage;
  parent_tool_use_id: string | null;
}

/**
 * SDK User Message
 */
export interface SDKUserMessage {
  type: "user";
  uuid?: UUID;
  session_id: string;
  message: APIUserMessage;
  parent_tool_use_id: string | null;
}

/**
 * SDK User Message Replay (with required UUID)
 */
export interface SDKUserMessageReplay {
  type: "user";
  uuid: UUID;
  session_id: string;
  message: APIUserMessage;
  parent_tool_use_id: string | null;
}

/**
 * Token usage statistics
 */
export interface UsageInfo {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Non-nullable version of UsageInfo
 */
export interface NonNullableUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/**
 * Per-model usage statistics
 */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
}

/**
 * Permission denial information
 */
export interface SDKPermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

/**
 * SDK Result Message - Success variant
 */
export interface SDKResultMessageSuccess {
  type: "result";
  subtype: "success";
  uuid: UUID;
  session_id: string;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: SDKPermissionDenial[];
  structured_output?: unknown;
}

/**
 * SDK Result Message - Error variant
 */
export interface SDKResultMessageError {
  type: "result";
  subtype:
    | "error_max_turns"
    | "error_during_execution"
    | "error_max_budget_usd"
    | "error_max_structured_output_retries";
  uuid: UUID;
  session_id: string;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: SDKPermissionDenial[];
  errors: string[];
}

/**
 * SDK Result Message (union of success and error variants)
 */
export type SDKResultMessage = SDKResultMessageSuccess | SDKResultMessageError;

/**
 * Permission mode
 */
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

/**
 * API key source
 */
export type ApiKeySource = "user" | "project" | "org" | "temporary";

/**
 * MCP server status
 */
export interface McpServerStatus {
  name: string;
  status: string;
}

/**
 * SDK System Message (init)
 */
export interface SDKSystemMessage {
  type: "system";
  subtype: "init";
  uuid: UUID;
  session_id: string;
  apiKeySource: ApiKeySource;
  cwd: string;
  tools: string[];
  mcp_servers: McpServerStatus[];
  model: string;
  permissionMode: PermissionMode;
  slash_commands: string[];
  output_style: string;
}

/**
 * SDK Compact Boundary Message
 */
export interface SDKCompactBoundaryMessage {
  type: "system";
  subtype: "compact_boundary";
  uuid: UUID;
  session_id: string;
  compact_metadata: {
    trigger: "manual" | "auto";
    pre_tokens: number;
  };
}

/**
 * Raw message stream event from Anthropic SDK
 */
export interface RawMessageStreamEvent {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
  content_block?: ContentBlock;
  message?: {
    id: string;
    type: string;
    role: string;
    content: ContentBlock[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: UsageInfo;
  };
  usage?: UsageInfo;
}

/**
 * SDK Partial Assistant Message (streaming)
 */
export interface SDKPartialAssistantMessage {
  type: "stream_event";
  event: RawMessageStreamEvent;
  parent_tool_use_id: string | null;
  uuid: UUID;
  session_id: string;
}

/**
 * Union of all SDK message types
 */
export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKCompactBoundaryMessage
  | SDKPartialAssistantMessage;

// ============================================================================
// StreamChunk Types (for UI rendering)
// ============================================================================

/**
 * Session initialization chunk
 */
export interface SessionInitChunk {
  type: "session_init";
  sessionId: string;
  model: string;
  tools: string[];
  cwd: string;
  permissionMode: PermissionMode;
}

/**
 * Text content chunk
 */
export interface TextChunk {
  type: "text";
  text: string;
  isPartial?: boolean;
}

/**
 * Thinking content chunk
 */
export interface ThinkingChunk {
  type: "thinking";
  thinking: string;
  isPartial?: boolean;
}

/**
 * Tool use chunk
 */
export interface ToolUseChunk {
  type: "tool_use";
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  isPartial?: boolean;
}

/**
 * Tool result chunk
 */
export interface ToolResultChunk {
  type: "tool_result";
  toolUseId: string;
  content: string | null;
  isError: boolean;
}

/**
 * Usage information chunk
 */
export interface UsageChunk {
  type: "usage";
  usage: UsageInfo;
  totalCostUsd?: number;
  durationMs?: number;
  numTurns?: number;
  isError?: boolean;
  errors?: string[];
}

/**
 * Error chunk
 */
export interface ErrorChunk {
  type: "error";
  message: string;
  code?: string;
}

/**
 * Union of all stream chunk types
 */
export type StreamChunk =
  | SessionInitChunk
  | TextChunk
  | ThinkingChunk
  | ToolUseChunk
  | ToolResultChunk
  | UsageChunk
  | ErrorChunk;

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Type guard for SDKAssistantMessage
 */
export function isSDKAssistantMessage(msg: SDKMessage): msg is SDKAssistantMessage {
  return msg.type === "assistant";
}

/**
 * Type guard for SDKUserMessage
 */
export function isSDKUserMessage(msg: SDKMessage): msg is SDKUserMessage | SDKUserMessageReplay {
  return msg.type === "user";
}

/**
 * Type guard for SDKResultMessage
 */
export function isSDKResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === "result";
}

/**
 * Type guard for SDKSystemMessage
 */
export function isSDKSystemMessage(
  msg: SDKMessage
): msg is SDKSystemMessage | SDKCompactBoundaryMessage {
  return msg.type === "system";
}

/**
 * Type guard for SDKPartialAssistantMessage
 */
export function isSDKPartialAssistantMessage(msg: SDKMessage): msg is SDKPartialAssistantMessage {
  return msg.type === "stream_event";
}

/**
 * Type guard for TextBlock
 */
export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === "text";
}

/**
 * Type guard for ThinkingBlock
 */
export function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === "thinking";
}

/**
 * Type guard for ToolUseBlock
 */
export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

/**
 * Type guard for ToolResultBlock
 */
export function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === "tool_result";
}
