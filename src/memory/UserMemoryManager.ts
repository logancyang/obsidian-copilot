import { App, TFile } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError, logWarn } from "@/logger";
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
  private savedMemoriesContent: string = "";
  private isUpdatingMemory: boolean = false;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Load memory data from files into class fields
   */
  private async loadMemory(): Promise<void> {
    try {
      // Load recent conversations
      const recentConversationsFile = this.app.vault.getAbstractFileByPath(
        this.getRecentConversationFilePath()
      );
      if (recentConversationsFile instanceof TFile) {
        this.recentConversationsContent = await this.app.vault.read(recentConversationsFile);
      } else {
        this.recentConversationsContent = "";
        logInfo("[UserMemoryManager] Recent Conversations file not found, skipping memory load");
      }

      // Load saved memories
      const savedMemoriesFile = this.app.vault.getAbstractFileByPath(
        this.getSavedMemoriesFilePath()
      );
      if (savedMemoriesFile instanceof TFile) {
        this.savedMemoriesContent = await this.app.vault.read(savedMemoriesFile);
      } else {
        this.savedMemoriesContent = "";
        logInfo("[UserMemoryManager] Saved Memories file not found, skipping saved memory load");
      }
    } catch (error) {
      logError("[UserMemoryManager] Error reading memory files:", error);
      this.recentConversationsContent = "";
      this.savedMemoriesContent = "";
    }
  }

  /**
   * Adds a recent conversation to user memory storage in the background without blocking execution
   */
  addRecentConversation(messages: ChatMessage[], chatModel?: BaseChatModel): void {
    const settings = getSettings();

    // Only proceed if memory is enabled
    if (!settings.enableRecentConversations) {
      logWarn("[UserMemoryManager] Recent history referencing is disabled, skipping analysis");
      return;
    }

    if (messages.length === 0) {
      logWarn("[UserMemoryManager] No messages to analyze for user memory");
      return;
    }

    // Fire and forget - run in background
    this.updateMemory(messages, chatModel).catch((error) => {
      logError("[UserMemoryManager] Background user memory operation failed:", error);
    });
  }

  /**
   * Adds a saved memory that the user explicitly asked to remember
   */
  async updateSavedMemory(
    query: string,
    chatModel: BaseChatModel
  ): Promise<{ content?: string; error?: string }> {
    const settings = getSettings();

    // Only proceed if saved memory is enabled
    if (!settings.enableSavedMemory) {
      return { error: "Saved memory is disabled, skipping save" };
    }

    if (!query || query.trim() === "") {
      return { error: "No content provided for saved memory" };
    }

    if (!chatModel) {
      return { error: "No chat model available, skipping save" };
    }

    try {
      // Ensure user memory folder exists
      await this.ensureMemoryFolderExists();
      // Add to saved memories file
      const result = await this.updateSavedMemoryFile(
        this.getSavedMemoriesFilePath(),
        query,
        chatModel
      );
      return result;
    } catch (error) {
      return { error: "Error saving memory: " + error.message };
    }
  }

  /**
   * Get user memory prompt
   */
  async getUserMemoryPrompt(): Promise<string | null> {
    await this.loadMemory();

    try {
      const settings = getSettings();
      let memoryPrompt = "";

      // Add recent conversations if enabled
      if (settings.enableRecentConversations && this.recentConversationsContent) {
        memoryPrompt += `<recent_conversations>
        ${this.recentConversationsContent}
        </recent_conversations>

        The current time is ${this.getTimestamp()}.
        <recent_conversations> are the recent conversations between you and the user. 
        You can use it to provide more context for your responses. 
        Only use the recent conversations if they are relevant to the current conversation.`;
      }

      // Add saved memories if enabled
      if (settings.enableSavedMemory && this.savedMemoriesContent) {
        memoryPrompt += `<saved_memories>
        ${this.savedMemoriesContent}
        </saved_memories>

        <saved_memories> are important memories that the user explicitly asked you to remember. 
        Use these memories to provide more personalized and contextually relevant responses.`;
      }

      return memoryPrompt.length > 0 ? memoryPrompt : null;
    } catch (error) {
      logError("[UserMemoryManager] Error reading user memory content:", error);
      return null;
    }
  }

  private getTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  /**
   * Create a conversation section from messages and return it in Markdown format
   */
  private async createConversationSection(
    messages: ChatMessage[],
    chatModel: BaseChatModel
  ): Promise<string> {
    const { title, summary } = await this.extractTitleAndSummary(messages, chatModel);
    const timestamp = this.getTimestamp();

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
      await this.addToRecentConversationsFile(
        this.getRecentConversationFilePath(),
        conversationSection
      );
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

  public getSavedMemoriesFilePath(): string {
    const settings = getSettings();
    return `${settings.memoryFolderName}/Saved Memories.md`;
  }

  /**
   * Update content to saved memory file with ChatModel
   */
  private async updateSavedMemoryFile(
    filePath: string,
    query: string,
    chatModel: BaseChatModel
  ): Promise<{ content?: string; error?: string }> {
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    // Load existing saved memories (may be empty)
    const existingContent =
      existingFile instanceof TFile ? await this.app.vault.read(existingFile) : "";

    // Fast path: if no model available for some reason, append a bullet safely
    if (!chatModel) {
      return { error: "No chat model available, skipping memory update" };
    }

    // Ask the model to produce a deduplicated/merged/conflict-free full list
    const systemPrompt = `You maintain a user's long-term personal memory list as concise bullet points.

    You task is to update the user's memory list with the new statement.
Rules:
- Keep only stable, evergreen facts or preferences that will help future conversations.
- Remove duplicates and near-duplicates by merging them into one concise statement.
- If the new statement conflicts with older ones, keep the most recent truth and remove obsolete/conflicting entries.
- Prefer short, specific, and unambiguous phrasing.
- Preserve the language used in the input memories.
- Output only the memory content with each as a bullet point.


# OUTPUT FORMAT
Return the updated memory list with each as a bullet point.
- memory item 1
- memory item 2
- memory item 3
...
`;

    const humanPrompt = `<current_memories>
${existingContent.trim()}
</current_memories>

<new_statement>
${query.trim()}
</new_statement>
`;

    const messages_llm = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

    let updatedContent: string | null = null;
    try {
      const response = await chatModel.invoke(messages_llm);
      updatedContent = response.text ?? "";
    } catch (error) {
      return { error: "LLM call failed while updating saved memories: " + error.message };
    }
    if (updatedContent == null || updatedContent.trim() === "") {
      return { error: "Empty content returned from LLM" };
    }

    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, updatedContent);
    } else {
      await this.app.vault.create(filePath, updatedContent);
    }

    return { content: updatedContent };
  }

  /**
   * Save content to the user memory file by appending new conversation section
   * Maintains a rolling buffer of conversations by removing the oldest when limit is exceeded
   */
  private async addToRecentConversationsFile(
    filePath: string,
    newConversationSection: string
  ): Promise<void> {
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      // Read existing content and parse conversations
      const fileContent = await this.app.vault.read(existingFile);

      let updatedContent: string;

      if (fileContent.trim() === "") {
        // Create new file with a single trailing newline
        updatedContent = `${newConversationSection.trim()}\n`;
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

        // Normalize sections to avoid extra blank lines, then separate with exactly one blank line
        const normalized = conversations.map((s) => s.trim());
        updatedContent = `${normalized.join("\n\n")}\n`;
      }

      await this.app.vault.modify(existingFile, updatedContent);
    } else {
      // Create new file
      const initialContent = `${newConversationSection.trim()}\n`;
      await this.app.vault.create(filePath, initialContent);
    }
  }

  /**
   * Parse existing conversations from file content
   */
  private parseExistingConversations(content: string): string[] {
    const lines = content.split("\n");
    const conversations: string[] = [];
    let currentConversation: string[] = [];

    for (const line of lines) {
      if (line.trim().startsWith("## ")) {
        // Start of a new conversation - save the previous one if it exists
        if (currentConversation.length > 0) {
          conversations.push(currentConversation.join("\n").trim());
        }
        // Start new conversation with this header
        currentConversation = [line];
      } else if (currentConversation.length > 0) {
        // Add line to current conversation if we're inside one
        currentConversation.push(line);
      }
      // Ignore lines before the first ## header
    }

    // Add the last conversation if it exists
    if (currentConversation.length > 0) {
      conversations.push(currentConversation.join("\n").trim());
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
      const content = response.text;

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
