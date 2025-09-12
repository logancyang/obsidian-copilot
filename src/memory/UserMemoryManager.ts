import { App, TFile } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError } from "@/logger";
import { USER_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const MAX_MEMORY_LINES = 40;

/**
 * User Memory Management Class
 *
 * Instance-based methods for building and managing user memory based on conversations.
 * The UserMemoryManager has methods to add recent conversations to memory
 * which can then be used to provide recent conversation context for LLM responses.
 */
export class UserMemoryManager {
  private app: App;
  private recentConversationsContent: string = "";
  private isUpdatingMemory: boolean = false;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Load memory data from files into class fields
   */
  async loadMemory(): Promise<void> {
    try {
      const recentConversationsFile = this.app.vault.getAbstractFileByPath(
        this.getRecentConversationFilePath()
      );
      if (recentConversationsFile instanceof TFile) {
        this.recentConversationsContent = await this.app.vault.read(recentConversationsFile);
      }
    } catch (error) {
      logError("[UserMemoryManager] Error reading recent conversations file:", error);
    }

    // User insights functionality removed - focusing only on recent memory
  }

  /**
   * Runs the user memory operation in the background without blocking execution
   */
  updateUserMemory(messages: ChatMessage[], chatModel?: BaseChatModel): void {
    const settings = getSettings();

    // Only proceed if memory is enabled
    if (!settings.enableMemory) {
      logInfo("[UserMemoryManager] User memory tracking is disabled, skipping analysis");
      return;
    }

    if (messages.length === 0) {
      logInfo("[UserMemoryManager] No messages to analyze for user memory");
      return;
    }

    // Fire and forget - run in background
    this.updateMemory(messages, chatModel).catch((error) => {
      logError("[UserMemoryManager] Background user memory operation failed:", error);
    });
  }

  /**
   * Create a condensed version of a user message for memory purposes.
   * Optimized for Obsidian note-taking context and knowledge management workflows.
   *
   * @param userMessage - The original user message to condense
   * @param chatModel - The chat model to use for condensing (optional)
   * @returns Promise<string | null> - The condensed message or null if failed/unnecessary
   *
   * Features:
   * - Skips condensing for very short messages or simple commands
   * - Validates that condensed message is actually shorter than original
   * - Provides fallback truncation if AI condensing fails
   * - Optimized prompts for Obsidian-specific use cases
   */
  async createCondensedMessage(
    userMessage: string,
    chatModel?: BaseChatModel
  ): Promise<string | null> {
    if (!chatModel) {
      logError("[UserMemoryManager] No chat model available for condensed message creation");
      return null;
    }

    // Remove newlines and other formatting
    const formattedMessage = userMessage.replace(/\n/g, " ").replace(/\\n/g, " ").trim();
    const trimmedMessage = formattedMessage.trim();
    if (!trimmedMessage) {
      return null;
    }

    const systemPrompt = `Your task is to condense user messages into concise one-line summaries while preserving user intent and important details.

The condensed message will be used as part of the recent conversation content for memory purposes.

CRITICAL RULES:
1. Keep it to ONE sentence maximum
2. Preserve the user's core intent and request
3. Include important details like note names, tags, search queries, or Obsidian features mentioned
4. Maintain the meaning and specificity of the original message
5. Use clear, direct language
6. Prioritize Obsidian-specific features (links, tags, graphs, plugins, etc.)

# OUTPUT FORMAT
Return only the condensed message as plain text, no quotes or additional formatting.`;

    const humanPrompt = `<user_message>
${trimmedMessage}
</user_message>

Condense the user message into a single concise sentence while preserving intent and important details`;

    const messages_llm = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

    try {
      const response = await chatModel.invoke(messages_llm);
      if (!response || !response.content) {
        logError("[UserMemoryManager] Empty response from chat model for condensed message");
        return null;
      }

      const condensed = response.content.toString().trim();

      // Validate the condensed message
      if (!condensed) {
        logError("[UserMemoryManager] Chat model returned empty condensed message");
        return null;
      }

      // Ensure the condensed message is actually shorter than the original
      if (condensed.length >= trimmedMessage.length) {
        logInfo("[UserMemoryManager] Condensed message not shorter than original, using original");
        return trimmedMessage;
      }

      // Remove any quotes or formatting that might have been added
      const cleanedCondensed = condensed.replace(/^["']|["']$/g, "").trim();

      return cleanedCondensed || null;
    } catch (error) {
      logError("[UserMemoryManager] Failed to create condensed message:", error);
      // Fallback: return a truncated version of the original message if it's too long
      if (trimmedMessage.length > 100) {
        const fallback = trimmedMessage.substring(0, 97) + "...";
        logInfo("[UserMemoryManager] Using fallback truncated message");
        return fallback;
      }
      return null;
    }
  }

  /**
   * Get user memory prompt
   */
  async getUserMemoryPrompt(): Promise<string | null> {
    await this.loadMemory();

    try {
      let memoryPrompt = "";

      if (this.recentConversationsContent) {
        memoryPrompt += `\n# Recent Conversation Content\n${this.recentConversationsContent}\n`;
      }

      return memoryPrompt.length > 0 ? memoryPrompt : null;
    } catch (error) {
      logError("[UserMemoryManager] Error reading user memory content:", error);
      return null;
    }
  }

  /**
   * Create a conversation line from messages and return it
   */
  private async createConversationLine(
    messages: ChatMessage[],
    chatModel: BaseChatModel
  ): Promise<string> {
    const conversationSummary = await this.extractConversationSummary(messages, chatModel);
    const timestamp = new Date().toISOString().split(".")[0] + "Z"; // Remove milliseconds but keep Z for UTC
    const userMessageTexts = messages
      .filter((message) => message.sender === USER_SENDER)
      .map((message) => {
        // Use condensed message if available
        return message.condensedMessage;
      });
    const content = userMessageTexts.join("||||");
    return `${timestamp} ${conversationSummary}||||${content}`;
  }

  /**
   * Analyze chat messages and store useful information in user memory files
   */
  private async updateMemory(messages: ChatMessage[], chatModel?: BaseChatModel): Promise<void> {
    // Prevent race conditions by ensuring only one memory update operation runs at a time
    if (this.isUpdatingMemory) {
      logInfo("[UserMemoryManager] Memory update already in progress, skipping.");
      return;
    }

    this.isUpdatingMemory = true;
    try {
      // Ensure user memory folder exists
      await this.ensureMemoryFolderExists();

      if (!chatModel) {
        logError("[UserMemoryManager] No chat model available, skipping memory update");
        return;
      }

      if (messages.length === 0) {
        logInfo("[UserMemoryManager] No messages available, skipping memory update");
        return;
      }

      // 1. Always extract and save conversation summary to recent conversations
      const conversationLine = await this.createConversationLine(messages, chatModel);
      await this.addToMemoryFile(this.getRecentConversationFilePath(), conversationLine);

      // User insights functionality removed - only maintain recent conversations
    } catch (error) {
      logError("[UserMemoryManager] Error analyzing chat messages for user memory:", error);
    } finally {
      this.isUpdatingMemory = false;
    }
  }

  /**
   * Ensure the user memory folder exists
   */
  private async ensureMemoryFolderExists(): Promise<void> {
    const settings = getSettings();
    const memoryFolderPath = settings.memoryFolderName;

    const folder = this.app.vault.getAbstractFileByPath(memoryFolderPath);
    if (!folder) {
      await this.app.vault.createFolder(memoryFolderPath);
      logInfo(`[UserMemoryManager] Created user memory folder: ${memoryFolderPath}`);
    }
  }

  private getRecentConversationFilePath(): string {
    const settings = getSettings();
    return `${settings.memoryFolderName}/recent_conversation_content.md`;
  }

  // getUserInsightsFilePath removed - user insights functionality removed

  /**
   * Save content to the user memory file by appending new conversation
   * Maintains a rolling buffer of conversations by removing the oldest when limit is exceeded
   */
  private async addToMemoryFile(filePath: string, newContent: string): Promise<void> {
    const newConversationLine = `- ${newContent}`;

    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      // Read existing conversation lines, append the new line.
      // Make sure the content lines do not exceed 40 lines. If it does, remove the first line.
      const fileContent = await this.app.vault.read(existingFile);
      const lines = fileContent.split("\n");
      lines.push(newConversationLine);

      if (lines.length > MAX_MEMORY_LINES) {
        // Remove the first line to keep within the limit
        lines.shift();
      }

      const updatedContent = lines.join("\n");
      await this.app.vault.modify(existingFile, updatedContent);
    } else {
      await this.app.vault.create(filePath, newConversationLine);
    }
  }

  // shouldUpdateUserInsights removed - user insights functionality removed

  // extractTimestampFromLine removed - no longer needed without user insights functionality

  /**
   * Extract conversation summary using LLM
   */
  private async extractConversationSummary(
    messages: ChatMessage[],
    chatModel: BaseChatModel
  ): Promise<string> {
    const conversationText = messages.map((msg) => `${msg.sender}: ${msg.message}`).join("\n\n");

    const systemPrompt = `You are an AI assistant that analyzes conversations and extracts a brief summary.

CONVERSATION SUMMARY: A very brief summary in 2-5 words maximum 

Examples: "Travel Plan", "Tokyo Weather"

# OUTPUT FORMAT
Return only the brief 2-5 word summary as plain text, no JSON format needed.`;

    const humanPrompt = `Analyze this conversation and extract a brief summary:

${conversationText}`;

    const messages_llm = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

    try {
      const response = await chatModel.invoke(messages_llm);
      const summary = response.content.toString().trim();
      return summary || "No summary";
    } catch (error) {
      logError("[UserMemoryManager] Failed to extract conversation summary:", error);
      return "No summary";
    }
  }

  // extractUserInsights removed - user insights functionality removed
}
