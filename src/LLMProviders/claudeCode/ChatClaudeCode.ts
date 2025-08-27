/**
 * ChatClaudeCode - LangChain provider for local Claude Code CLI integration
 *
 * This class implements the SimpleChatModel interface to enable
 * communication with the local Claude CLI through process spawning.
 */

import { SimpleChatModel, BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import {
  BaseMessage,
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ClaudeCliInterface } from "./ClaudeCliInterface";

export interface ChatClaudeCodeConfig extends BaseChatModelParams {
  /** Path to Claude CLI executable (defaults to 'claude') */
  cliPath?: string;
  /** Claude model to use (opus/sonnet/haiku) */
  model?: string;
  /** Session management mode */
  sessionMode?: "new" | "continue";
  /** CLI execution timeout in milliseconds (defaults to 30000) */
  timeout?: number;
  /** Enable fallback to cloud providers if CLI fails */
  fallbackEnabled?: boolean;
  /** Enable debug logging for CLI operations */
  debugMode?: boolean;
}

export class ChatClaudeCode extends SimpleChatModel {
  private config: ChatClaudeCodeConfig & {
    cliPath: string;
    model: string;
    sessionMode: "new" | "continue";
    timeout: number;
    fallbackEnabled: boolean;
    debugMode: boolean;
  };
  private cliInterface: ClaudeCliInterface;

  constructor(config: ChatClaudeCodeConfig = {}) {
    super(config);

    // Apply default configuration values
    this.config = {
      ...config,
      cliPath: config.cliPath || "claude",
      model: config.model || "sonnet",
      sessionMode: config.sessionMode || "new",
      timeout: config.timeout || 30000,
      fallbackEnabled: config.fallbackEnabled ?? false,
      debugMode: config.debugMode ?? false,
    };

    // Initialize CLI interface
    this.cliInterface = new ClaudeCliInterface({
      cliPath: this.config.cliPath,
      timeout: this.config.timeout,
      debugMode: this.config.debugMode,
    });

    // Validate configuration
    this.validateConfig();
  }

  /**
   * Validate the configuration parameters
   */
  private validateConfig(): void {
    if (this.config.timeout <= 0) {
      throw new Error("Claude Code timeout must be greater than 0");
    }

    if (!["new", "continue"].includes(this.config.sessionMode)) {
      throw new Error("Claude Code sessionMode must be 'new' or 'continue'");
    }

    if (this.config.debugMode) {
      console.log("Claude Code initialized with config:", {
        cliPath: this.config.cliPath,
        model: this.config.model,
        sessionMode: this.config.sessionMode,
        timeout: this.config.timeout,
        fallbackEnabled: this.config.fallbackEnabled,
      });
    }
  }

  _llmType(): string {
    return "claude-code";
  }

  async _call(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<string> {
    try {
      if (this.config.debugMode) {
        console.log("Claude Code _call invoked with:", {
          messageCount: messages.length,
          options,
          cliPath: this.config.cliPath,
          model: this.config.model,
        });
      }

      // 1. Convert messages to Claude format
      const claudeInput = this.formatMessagesForClaude(messages);

      // 2. Execute Claude CLI
      const result = await this.cliInterface.execute([
        "--print",
        "--output-format",
        "json",
        claudeInput,
      ]);

      // 3. Parse and extract response
      if (!result.success) {
        throw new Error(`Claude CLI error: ${result.stderr || result.error?.message}`);
      }

      const parsedResponse = JSON.parse(result.stdout);
      return this.extractMessageContent(parsedResponse);
    } catch (error) {
      // 4. Handle errors gracefully
      return this.handleExecutionError(error as Error);
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: any,
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    // Story 2.1 placeholder streaming implementation
    if (this.config.debugMode) {
      console.log("Claude Code _streamResponseChunks called with:", {
        messageCount: messages.length,
        options,
        model: this.config.model,
      });
    }

    // Simulate streaming by yielding chunks
    const chunks = [
      "Claude Code (Local CLI) streaming placeholder - ",
      "Story 2.1 implementation. ",
      `Configuration: model=${this.config.model}, `,
      `timeout=${this.config.timeout}ms. `,
      "Streaming will be fully implemented in Story 3.1.",
    ];

    for (const chunkText of chunks) {
      const message = new AIMessageChunk(chunkText);
      yield new ChatGenerationChunk({
        text: chunkText,
        message: message,
      });

      // Add small delay to simulate streaming
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Convert LangChain BaseMessage objects to Claude CLI input format
   */
  private formatMessagesForClaude(messages: BaseMessage[]): string {
    const claudeMessages = messages.map((msg) => {
      if (msg instanceof HumanMessage) {
        return `Human: ${msg.content}`;
      } else if (msg instanceof AIMessage) {
        return `Assistant: ${msg.content}`;
      } else if (msg instanceof SystemMessage) {
        return `System: ${msg.content}`;
      }
      // Fallback for other message types
      return msg.content;
    });

    return claudeMessages.join("\n\n");
  }

  /**
   * Extract message content from Claude CLI JSON response
   */
  private extractMessageContent(response: any): string {
    // Claude CLI JSON response structure (to be verified)
    if (response && response.message) {
      return response.message;
    } else if (response && response.content) {
      return response.content;
    } else if (typeof response === "string") {
      return response;
    }

    throw new Error("Invalid response format from Claude CLI");
  }

  /**
   * Handle execution errors with user-friendly messages
   */
  private handleExecutionError(error: Error): string {
    const errorMessage = error.message.toLowerCase();

    if (
      errorMessage.includes("command not found") ||
      errorMessage.includes("enoent") ||
      errorMessage.includes("not found in path")
    ) {
      return "Claude Code is not installed or not found in PATH. Please install Claude Code and try again.";
    } else if (errorMessage.includes("timeout")) {
      return "Claude Code request timed out. Please try again.";
    } else if (errorMessage.includes("json")) {
      return "Error processing Claude Code response. Please try again.";
    }

    // Log technical error for debugging
    console.error("Claude Code execution error:", error);
    return "Claude Code is temporarily unavailable. Please try again later.";
  }

  /**
   * Get the current configuration
   * @returns The current Claude Code configuration
   */
  getConfig(): ChatClaudeCodeConfig & {
    cliPath: string;
    model: string;
    sessionMode: "new" | "continue";
    timeout: number;
    fallbackEnabled: boolean;
    debugMode: boolean;
  } {
    return { ...this.config };
  }

  /**
   * Update configuration (for testing and runtime updates)
   * @param newConfig Partial configuration to merge
   */
  updateConfig(newConfig: Partial<ChatClaudeCodeConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
    this.validateConfig();
  }
}
