/**
 * Claude Code Module
 *
 * This module provides integration with the Claude Agent SDK for agentic
 * capabilities in Obsidian Copilot.
 *
 * @module claudeCode
 */

// Main service
export {
  ClaudeCodeService,
  getClaudeCodeService,
  resetClaudeCodeService,
} from "./ClaudeCodeService";

export type { ClaudeCodeServiceOptions } from "./ClaudeCodeService";

// CLI detection
export { findClaudeCliPath, isClaudeCliAvailable, getClaudeCliVersion } from "./cliDetection";

// Message channel for streaming
export { MessageChannel, createPromptChannel } from "./MessageChannel";

// Message transformation
export {
  transformSDKMessage,
  transformSDKMessages,
  transformSDKMessagesAsync,
} from "./transformSDKMessage";

// Security hooks
export {
  isCommandBlocked,
  isPathAllowed,
  createSecurityHooks,
  validatePath,
  validateBashCommand,
  DEFAULT_BLOCKED_COMMANDS,
} from "./securityHooks";

export type {
  SecurityHooksOptions,
  SecurityCheckResult,
  BlocklistCheckResult,
} from "./securityHooks";

// Diff tracking
export {
  capturePreToolState,
  capturePostToolState,
  getDiff,
  getDiffRecord,
  clearDiffs,
  getDiffCount,
  getAllDiffRecords,
  createDiffTrackingHooks,
} from "./diffTracker";

// Types
export type {
  // SDK Message Types
  UUID,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  APIAssistantMessage,
  APIUserMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  UsageInfo,
  NonNullableUsage,
  ModelUsage,
  SDKPermissionDenial,
  SDKResultMessageSuccess,
  SDKResultMessageError,
  SDKResultMessage,
  PermissionMode,
  ApiKeySource,
  McpServerStatus,
  SDKSystemMessage,
  SDKCompactBoundaryMessage,
  RawMessageStreamEvent,
  SDKPartialAssistantMessage,
  SDKMessage,
  // StreamChunk Types
  SessionInitChunk,
  TextChunk,
  ThinkingChunk,
  ToolUseChunk,
  ToolResultChunk,
  UsageChunk,
  ErrorChunk,
  StreamChunk,
} from "./types";

// Type guards
export {
  isSDKAssistantMessage,
  isSDKUserMessage,
  isSDKResultMessage,
  isSDKSystemMessage,
  isSDKPartialAssistantMessage,
  isTextBlock,
  isThinkingBlock,
  isToolUseBlock,
  isToolResultBlock,
} from "./types";
