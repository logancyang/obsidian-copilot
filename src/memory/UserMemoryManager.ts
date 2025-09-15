import { App, TFile } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError, logWarn } from "@/logger";
import { USER_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

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
   * Check if a message is a user message with valid condensed content
   */
  private hasValidCondensedUserMessage(message: ChatMessage): boolean {
    return (
      message.sender === USER_SENDER &&
      !!message.condensedUserMessage &&
      typeof message.condensedUserMessage === "string" &&
      message.condensedUserMessage.trim().length > 0
    );
  }

  /**
   * Load memory data from files into class fields
   */
  private async loadMemory(): Promise<void> {
    try {
      const recentConversationsFile = this.app.vault.getAbstractFileByPath(
        this.getRecentConversationFilePath()
      );
      if (recentConversationsFile instanceof TFile) {
        this.recentConversationsContent = await this.app.vault.read(recentConversationsFile);
      } else {
        logInfo("[UserMemoryManager] Recent Conversations file not found, skipping memory load");
      }
    } catch (error) {
      logError("[UserMemoryManager] Error reading recent conversations file:", error);
    }
  }

  /**
   * Runs the user memory operation in the background without blocking execution
   */
  updateUserMemory(messages: ChatMessage[], chatModel?: BaseChatModel): void {
    const settings = getSettings();

    // Only proceed if memory is enabled
    if (!settings.enableMemory) {
      logInfo("[UserMemoryManager] Recent history referencing is disabled, skipping analysis");
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
* Return only the condensed message as plain text, no quotes or additional formatting.
* Use the same language as the original message.`;

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
        memoryPrompt += `\n${this.recentConversationsContent}\n`;
      }

      return memoryPrompt.length > 0 ? memoryPrompt : null;
    } catch (error) {
      logError("[UserMemoryManager] Error reading user memory content:", error);
      return null;
    }
  }

  /**
   * Create a conversation section from messages and return it in Markdown format
   */
  private async createConversationSection(
    messages: ChatMessage[],
    chatModel: BaseChatModel
  ): Promise<string> {
    const conversationTitle = await this.extractConversationTitle(messages, chatModel);
    const timestamp = new Date().toISOString().split(".")[0] + "Z"; // Remove milliseconds but keep Z for UTC

    // Process user messages and ensure condensed messages are available
    const userMessages = messages.filter((message) => message.sender === USER_SENDER);
    const userMessageTexts: string[] = [];

    for (const message of userMessages) {
      let condensedText = message.condensedUserMessage;

      // If condensed message is missing or invalid, create it inline to handle race condition
      if (
        !condensedText ||
        typeof condensedText !== "string" ||
        condensedText.trim().length === 0
      ) {
        try {
          const newCondensedText = await this.createCondensedMessage(message.message, chatModel);
          if (newCondensedText) {
            condensedText = newCondensedText;
            logWarn(
              `[UserMemoryManager] Created inline condensed message for missing entry: "${condensedText}"`
            );
          }
        } catch (error) {
          logError(
            `[UserMemoryManager] Failed to create inline condensed message for "${message.message}":`,
            error
          );
          // Continue processing other messages even if one fails
        }
      }

      // Only include if we have valid condensed text
      if (condensedText && condensedText.trim().length > 0) {
        userMessageTexts.push(`- ${condensedText}`);
      }
    }

    // Generate key conclusions if conversation is substantial enough
    const keyConclusionsText = await this.extractKeyConclusion(messages, chatModel);

    let section = `## ${conversationTitle}\n`;
    section += `**Time:** ${timestamp}\n`;
    section += `**User Messages:**\n${userMessageTexts.join("\n")}\n`;

    if (keyConclusionsText) {
      section += `**Key Conclusions:**\n${keyConclusionsText}\n`;
    }

    return section;
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
      const conversationSection = await this.createConversationSection(messages, chatModel);
      await this.addToMemoryFile(this.getRecentConversationFilePath(), conversationSection);

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

    await ensureFolderExists(memoryFolderPath);
  }

  private getRecentConversationFilePath(): string {
    const settings = getSettings();
    return `${settings.memoryFolderName}/Recent Conversations.md`;
  }

  /**
   * Save content to the user memory file by appending new conversation section
   * Maintains a rolling buffer of conversations by removing the oldest when limit is exceeded
   */
  private async addToMemoryFile(filePath: string, newConversationSection: string): Promise<void> {
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      // Read existing content and parse conversations
      const fileContent = await this.app.vault.read(existingFile);

      let updatedContent: string;

      if (fileContent.trim() === "") {
        // Create new file without header
        updatedContent = `${newConversationSection}\n`;
      } else {
        // Parse existing conversations and add new one
        const conversations = this.parseExistingConversations(fileContent);
        conversations.push(newConversationSection);

        // Keep only the most recent conversations
        const settings = getSettings();
        const maxConversations = settings.maxRecentConversations;
        if (conversations.length > maxConversations) {
          conversations.splice(0, conversations.length - maxConversations);
        }

        updatedContent = `${conversations.join("\n")}\n`;
      }

      await this.app.vault.modify(existingFile, updatedContent);
    } else {
      // Create new file
      const initialContent = `${newConversationSection}\n`;
      await this.app.vault.create(filePath, initialContent);
    }
  }

  /**
   * Parse existing conversations from file content
   */
  private parseExistingConversations(content: string): string[] {
    const conversations: string[] = [];

    // Remove any old header if it exists
    const cleanContent = content.replace(/^# Recent Conversations\s*\n\n?/m, "").trim();

    // Split by ## headings to get individual conversations
    const sections = cleanContent.split(/^## /m);

    if (sections.length === 1 && sections[0].trim()) {
      // Content doesn't start with ##, but has content
      if (sections[0].trim().startsWith("##")) {
        conversations.push(sections[0].trim());
      } else {
        // Find any ## sections in the content
        const matches = cleanContent.match(/^## [\s\S]+?(?=^## |$)/gm);
        if (matches) {
          conversations.push(...matches.map((match) => match.trim()));
        }
      }
    } else {
      for (let i = 1; i < sections.length; i++) {
        // Skip the first section (before first ##)
        const section = `## ${sections[i]}`.trim();
        if (section.length > 0) {
          conversations.push(section);
        }
      }
    }

    return conversations;
  }

  /**
   * Extract key conclusions from conversation if it contains important insights
   */
  private async extractKeyConclusion(
    messages: ChatMessage[],
    chatModel: BaseChatModel
  ): Promise<string | null> {
    // Only generate key conclusions for conversations with substantial content
    const conversationText = messages.map((msg) => `${msg.sender}: ${msg.message}`).join("\n\n");

    // Skip if conversation is too short or simple
    if (conversationText.length < 300) {
      return null;
    }

    const systemPrompt = `You are an AI assistant that analyzes conversations and determines if they contain important conclusions worth remembering.

TASK: Analyze the conversation and extract key conclusions ONLY if the conversation contains:
- Important insights, decisions, or learnings
- Technical solutions or discoveries
- Significant planning or strategy discussions
- Important facts or knowledge gained

If the conversation is just casual chat, simple questions, or routine tasks, return "NONE".

# OUTPUT FORMAT
If there are key conclusions: Return each conclusion as a bullet point (use - for each point). Each conclusion should be concise (1-2 sentences). Use the same language as the conversation.
Example:
- First important insight or decision
- Second key learning or solution
- Third significant conclusion

If no important conclusions: Return exactly "NONE"`;

    const humanPrompt = `Analyze this conversation and determine if there are key conclusions worth remembering:

${conversationText}`;

    const messages_llm = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

    try {
      const response = await chatModel.invoke(messages_llm);
      const conclusion = response.content.toString().trim();

      if (conclusion === "NONE" || !conclusion) {
        return null;
      }

      return conclusion;
    } catch (error) {
      logError("[UserMemoryManager] Failed to extract key conclusion:", error);
      return null;
    }
  }

  /**
   * Extract conversation title using LLM
   */
  private async extractConversationTitle(
    messages: ChatMessage[],
    chatModel: BaseChatModel
  ): Promise<string> {
    const conversationText = messages.map((msg) => `${msg.sender}: ${msg.message}`).join("\n\n");

    const systemPrompt = `Your task is to generate a title for a conversation based on its content.

Examples: "Travel Plan", "Tokyo Weather"

# OUTPUT RULES
* Look at the conversation content and generate a title that captures the main *user intent* of the conversation.
* Return only the brief 2-8 word title as plain text, no JSON format needed.
* Use the same language as the conversation.`;

    const humanPrompt = `
<conversation_text>
${conversationText}
</conversation_text>

Generate a title for the conversation:`;

    const messages_llm = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

    try {
      const response = await chatModel.invoke(messages_llm);
      const summary = response.content.toString().trim();
      return summary || "Untitled Conversation";
    } catch (error) {
      logError("[UserMemoryManager] Failed to extract conversation summary:", error);
      return "Untitled Conversation";
    }
  }

  // extractUserInsights removed - user insights functionality removed
}
