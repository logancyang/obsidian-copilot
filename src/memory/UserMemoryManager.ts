import { App, TFile } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError } from "@/logger";
import { getSettings } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * User Memory Management Class
 *
 * Simple memory manager that creates conversation summaries for recent chat history.
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
    const { title, summary } = await this.extractTitleAndSummary(messages, chatModel);
    const timestamp = new Date().toISOString().split(".")[0] + "Z"; // Remove milliseconds but keep Z for UTC

    let section = `## ${title}\n`;
    section += `**Time:** ${timestamp}\n`;
    section += `**Summary:** ${summary}\n`;

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

      // Extract and save conversation summary to recent conversations
      const conversationSection = await this.createConversationSection(messages, chatModel);
      await this.addToMemoryFile(this.getRecentConversationFilePath(), conversationSection);
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
   * Extract JSON content from LLM response, handling cases where JSON is wrapped in code blocks
   */
  private extractJsonFromResponse(content: string): string {
    // First, try to extract JSON from markdown code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // If no code block found, look for JSON object pattern
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }

    // Return original content if no patterns match
    return content;
  }

  /**
   * Extract conversation title and summary using a single LLM call
   */
  private async extractTitleAndSummary(
    messages: ChatMessage[],
    chatModel: BaseChatModel
  ): Promise<{ title: string; summary: string }> {
    const conversationText = messages.map((msg) => `${msg.sender}: ${msg.message}`).join("\n\n");

    const systemPrompt = `Your task is to analyze a conversation and generate both a title and a summary.

# OUTPUT FORMAT
You must return your response in the following JSON format:
{
  "title": "Brief 2-8 word title capturing the main user intent",
  "summary": "2-3 sentence summary at most including key details (e.g. user facts mentioned entities), and key conclusions if there are any."
}

# RULES
* Use the same language as the conversation`;

    const humanPrompt = `<conversation_text>
${conversationText}
</conversation_text>

Generate a title and summary for this conversation:`;

    const messages_llm = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

    try {
      const response = await chatModel.invoke(messages_llm);
      const content = response.content.toString().trim();

      // Extract JSON from content, handling code blocks
      const jsonContent = this.extractJsonFromResponse(content);

      // Try to parse JSON response
      try {
        const parsed = JSON.parse(jsonContent);
        return {
          title: parsed.title || "Untitled Conversation",
          summary: parsed.summary || "No summary available",
        };
      } catch (parseError) {
        logError("[UserMemoryManager] Failed to parse LLM response as JSON:", parseError);
        return {
          title: "Untitled Conversation",
          summary: "Summary generation failed",
        };
      }
    } catch (error) {
      logError("[UserMemoryManager] Failed to extract title and summary:", error);
      return {
        title: "Untitled Conversation",
        summary: "Summary generation failed",
      };
    }
  }
}
