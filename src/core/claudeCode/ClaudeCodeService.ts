/**
 * Claude Code Service
 *
 * Wraps the @anthropic-ai/claude-agent-sdk with a persistent query pattern.
 * Manages session lifecycle (init, resume, abort) and provides streaming
 * message delivery via the transformSDKMessage generator.
 */

import { logError, logInfo, logWarn } from "@/logger";
import { findClaudeCliPath, getEnhancedEnv } from "./cliDetection";
import { MessageChannel, createPromptChannel } from "./MessageChannel";
import { transformSDKMessagesAsync } from "./transformSDKMessage";
import { SDKMessage, StreamChunk, ErrorChunk, PermissionMode } from "./types";

/**
 * Configuration options for ClaudeCodeService
 */
export interface ClaudeCodeServiceOptions {
  /** Path to Claude CLI executable (auto-detected if not provided) */
  cliPath?: string;
  /** Model to use for Claude Code queries */
  model?: string;
  /** Working directory for the session */
  workingDirectory?: string;
  /** Permission mode for tool execution */
  permissionMode?: PermissionMode;
  /** Maximum thinking tokens budget */
  maxThinkingTokens?: number;
  /** Allowed paths for file operations (beyond vault) */
  allowedPaths?: string[];
  /** Blocked commands for security */
  blockedCommands?: string[];
}

/**
 * Session state tracking
 */
interface SessionState {
  /** Whether a session is currently active */
  isActive: boolean;
  /** Current session ID */
  sessionId: string | null;
  /** Abort controller for the current session */
  abortController: AbortController | null;
  /** Message channel for the current session */
  messageChannel: MessageChannel | null;
}

/**
 * ClaudeCodeService - Main service for Claude Code SDK integration
 *
 * This service manages the lifecycle of Claude Code sessions and provides
 * a streaming interface for sending prompts and receiving responses.
 *
 * @example
 * ```typescript
 * const service = new ClaudeCodeService({
 *   workingDirectory: '/path/to/vault',
 *   model: 'claude-sonnet-4-20250514',
 * });
 *
 * await service.initialize();
 *
 * for await (const chunk of service.query('Hello, Claude!')) {
 *   console.log(chunk);
 * }
 *
 * await service.dispose();
 * ```
 */
export class ClaudeCodeService {
  private options: ClaudeCodeServiceOptions;
  private cliPath: string | null = null;
  private sessionState: SessionState = {
    isActive: false,
    sessionId: null,
    abortController: null,
    messageChannel: null,
  };
  private initialized = false;

  /**
   * Create a new ClaudeCodeService
   *
   * @param options - Configuration options
   */
  constructor(options: ClaudeCodeServiceOptions = {}) {
    this.options = {
      model: "claude-sonnet-4-20250514",
      permissionMode: "default",
      maxThinkingTokens: 10000,
      ...options,
    };
  }

  /**
   * Initialize the service by detecting CLI path
   *
   * @throws Error if CLI is not found
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logInfo("[ClaudeCodeService] Initializing...");

    // Use provided CLI path or auto-detect
    if (this.options.cliPath) {
      this.cliPath = this.options.cliPath;
      logInfo(`[ClaudeCodeService] Using provided CLI path: ${this.cliPath}`);
    } else {
      this.cliPath = await findClaudeCliPath();
      if (!this.cliPath) {
        throw new Error(
          "Claude CLI not found. Please install Claude CLI or provide the path in settings."
        );
      }
    }

    this.initialized = true;
    logInfo("[ClaudeCodeService] Initialized successfully");
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if a session is currently active
   */
  isSessionActive(): boolean {
    return this.sessionState.isActive;
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | null {
    return this.sessionState.sessionId;
  }

  /**
   * Send a query to Claude Code and stream the response
   *
   * This is the main entry point for interacting with Claude Code.
   * It creates a new session (or reuses existing), sends the prompt,
   * and yields StreamChunks for real-time UI updates.
   *
   * @param prompt - The user's prompt text
   * @param abortSignal - Optional abort signal for cancellation
   * @yields StreamChunk for each piece of response content
   */
  async *query(prompt: string, abortSignal?: AbortSignal): AsyncGenerator<StreamChunk> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Create abort controller for this query
    const abortController = new AbortController();
    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {
        abortController.abort(abortSignal.reason);
      });
    }

    // Create message channel for the query
    const channel = createPromptChannel(prompt);

    // Update session state
    this.sessionState = {
      isActive: true,
      sessionId: `session-${Date.now()}`,
      abortController,
      messageChannel: channel,
    };

    logInfo(`[ClaudeCodeService] Starting query with session: ${this.sessionState.sessionId}`);

    try {
      // Import the SDK dynamically to handle optional dependency
      let query: typeof import("@anthropic-ai/claude-agent-sdk").query;
      try {
        const sdk = await import("@anthropic-ai/claude-agent-sdk");
        query = sdk.query;
      } catch (importError) {
        logError("[ClaudeCodeService] Failed to import Claude Agent SDK:", importError);
        const errorChunk: ErrorChunk = {
          type: "error",
          message:
            "Claude Agent SDK is not available. Please install @anthropic-ai/claude-agent-sdk.",
          code: "SDK_NOT_AVAILABLE",
        };
        yield errorChunk;
        return;
      }

      // Get enhanced environment with proper PATH (includes nvm, nodenv, etc)
      const enhancedEnv = getEnhancedEnv(this.cliPath!);

      // Build SDK options
      const sdkOptions: Parameters<typeof query>[0] = {
        prompt: channel,
        options: {
          abortController,
          cwd: this.options.workingDirectory || process.cwd(),
          pathToClaudeCodeExecutable: this.cliPath!,
          model: this.options.model,
          permissionMode: this.mapPermissionMode(this.options.permissionMode),
          env: enhancedEnv,
          // Security hooks will be added in Phase 3
        },
      };

      logInfo("[ClaudeCodeService] Invoking SDK query...");

      // Execute the query and transform messages
      const sdkMessages = query(sdkOptions);

      // Transform SDK messages to StreamChunks
      for await (const chunk of transformSDKMessagesAsync(
        sdkMessages as AsyncIterable<SDKMessage>
      )) {
        // Check for abort
        if (abortController.signal.aborted) {
          logInfo("[ClaudeCodeService] Query aborted");
          break;
        }

        yield chunk;
      }

      logInfo("[ClaudeCodeService] Query completed successfully");
    } catch (error: unknown) {
      // Handle abort errors gracefully
      if (error instanceof Error && error.name === "AbortError") {
        logInfo("[ClaudeCodeService] Query aborted by user");
        return;
      }

      logError("[ClaudeCodeService] Query failed:", error);

      const errorChunk: ErrorChunk = {
        type: "error",
        message: error instanceof Error ? error.message : "Unknown error occurred",
        code: "QUERY_ERROR",
      };
      yield errorChunk;
    } finally {
      // Clean up session state
      this.sessionState = {
        isActive: false,
        sessionId: null,
        abortController: null,
        messageChannel: null,
      };
    }
  }

  /**
   * Send a follow-up message to an active session
   *
   * @param message - The follow-up message
   * @throws Error if no session is active
   */
  sendFollowUp(message: string): void {
    if (!this.sessionState.isActive || !this.sessionState.messageChannel) {
      throw new Error("No active session to send follow-up message to");
    }

    logInfo("[ClaudeCodeService] Sending follow-up message");
    this.sessionState.messageChannel.push(message);
  }

  /**
   * Abort the current session
   */
  abort(): void {
    if (this.sessionState.abortController) {
      logInfo("[ClaudeCodeService] Aborting current session");
      this.sessionState.abortController.abort("User requested abort");
    }

    if (this.sessionState.messageChannel) {
      this.sessionState.messageChannel.close();
    }

    this.sessionState = {
      isActive: false,
      sessionId: null,
      abortController: null,
      messageChannel: null,
    };
  }

  /**
   * Dispose of the service and clean up resources
   */
  async dispose(): Promise<void> {
    logInfo("[ClaudeCodeService] Disposing service...");

    this.abort();
    this.initialized = false;
    this.cliPath = null;

    logInfo("[ClaudeCodeService] Service disposed");
  }

  /**
   * Map internal permission mode to SDK permission mode
   */
  private mapPermissionMode(
    mode: PermissionMode | undefined
  ): "default" | "acceptEdits" | "bypassPermissions" | "plan" {
    switch (mode) {
      case "acceptEdits":
        return "acceptEdits";
      case "bypassPermissions":
        return "bypassPermissions";
      case "plan":
        return "plan";
      default:
        return "default";
    }
  }

  /**
   * Get the detected CLI path
   */
  getCliPath(): string | null {
    return this.cliPath;
  }

  /**
   * Update service options (requires re-initialization for some options)
   *
   * @param newOptions - New options to merge
   */
  updateOptions(newOptions: Partial<ClaudeCodeServiceOptions>): void {
    const oldCliPath = this.options.cliPath;
    this.options = { ...this.options, ...newOptions };

    // If CLI path changed, need to re-initialize
    if (newOptions.cliPath && newOptions.cliPath !== oldCliPath) {
      this.initialized = false;
      this.cliPath = null;
      logWarn("[ClaudeCodeService] CLI path changed, service needs re-initialization");
    }
  }
}

// Singleton instance for shared usage
let serviceInstance: ClaudeCodeService | null = null;

/**
 * Get or create the singleton ClaudeCodeService instance
 *
 * @param options - Options for creating a new instance
 * @returns The singleton service instance
 */
export function getClaudeCodeService(options?: ClaudeCodeServiceOptions): ClaudeCodeService {
  if (!serviceInstance) {
    serviceInstance = new ClaudeCodeService(options);
  } else if (options) {
    serviceInstance.updateOptions(options);
  }
  return serviceInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetClaudeCodeService(): void {
  if (serviceInstance) {
    serviceInstance.dispose();
    serviceInstance = null;
  }
}
