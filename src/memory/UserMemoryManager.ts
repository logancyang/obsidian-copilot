import { App, TFile } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError } from "@/logger";
import { USER_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const MAX_MEMORY_LINES = 40;
const INSIGHT_UPDATE_THRESHOLD = 1; // Update insights every 10 new conversations

/**
 * User Memory Management Class
 *
 * Instance-based methods for building and managing user memory based on conversations.
 * The UserMemoryManager has methods to add recent conversations, user facts to the user memory
 * which can then be used to personalize LLM response.
 */
export class UserMemoryManager {
  private app: App;
  private recentConversationsContent: string = "";
  private userInsightsContent: string = "";
  private newestUserInsightTimestamp: Date | null = null;
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

    try {
      const userInsightsFile = this.app.vault.getAbstractFileByPath(this.getUserInsightsFilePath());
      if (userInsightsFile instanceof TFile) {
        this.userInsightsContent = await this.app.vault.read(userInsightsFile);
        const userInsightsLines = this.userInsightsContent
          .split("\n")
          .filter((line) => line.trim().startsWith("- "));
        this.newestUserInsightTimestamp = this.extractTimestampFromLine(
          userInsightsLines[userInsightsLines.length - 1]
        );
      }
    } catch (error) {
      logError("[UserMemoryManager] Error reading user insights file:", error);
    }
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
   * Get user memory prompt
   */
  async getUserMemoryPrompt(): Promise<string | null> {
    await this.loadMemory();

    try {
      let memoryPrompt = "";

      if (this.recentConversationsContent) {
        memoryPrompt += `\n# Recent Conversation Content\n${this.recentConversationsContent}\n`;
      }

      if (this.userInsightsContent) {
        memoryPrompt += `\n# User Insights\n${this.userInsightsContent}\n`;
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
      .map((message) => message.message);
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

      // 2. Check if user insights should be updated
      // We update insights every INSIGHT_UPDATE_THRESHOLD conversations to ensure
      // important user information is preserved in long-term memory before being
      // rotated out of the short-term conversation buffer
      await this.loadMemory();
      if (this.shouldUpdateUserInsights()) {
        logInfo("[UserMemoryManager] Updating user insights based on recent conversation activity");
        const userInsights = await this.extractUserInsights(chatModel);
        if (userInsights) {
          try {
            console.log("[UserMemoryManager] Saving user insights:", userInsights);
            const timestamp = new Date().toISOString().split(".")[0] + "Z";

            // Split insights by line and save each separately
            const insights = userInsights.split("\n").filter((line) => line.trim().length > 0);
            for (const insight of insights) {
              const timestampedInsight = `${timestamp} ${insight.trim()}`;
              await this.addToMemoryFile(this.getUserInsightsFilePath(), timestampedInsight);
            }
          } catch (error) {
            logError("[UserMemoryManager] Error saving user insights:", error);
          }
        }
      } else {
        logInfo(
          "[UserMemoryManager] Skipping user insights update - not enough new conversations since last insight"
        );
      }
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

  private getUserInsightsFilePath(): string {
    const settings = getSettings();
    return `${settings.memoryFolderName}/user_insights.md`;
  }

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

  /**
   * Check if user insights should be updated based on conversation count
   * Updates when there are at least INSIGHT_UPDATE_THRESHOLD new conversations since the last insight
   */
  private shouldUpdateUserInsights(): boolean {
    try {
      // Always update if no insights exist yet
      if (this.newestUserInsightTimestamp === null) {
        return true;
      }

      // Always update if no recent conversations exist
      if (!this.recentConversationsContent.trim()) {
        return false;
      }

      // Count conversations newer than the latest insight
      const recentLines = this.recentConversationsContent
        .split("\n")
        .filter((line) => line.trim().startsWith("- "));
      const newConversationsCount = recentLines.filter((line) => {
        const timestamp = this.extractTimestampFromLine(line);
        return timestamp && timestamp > this.newestUserInsightTimestamp!;
      }).length;

      // Update if we have enough new conversations
      return newConversationsCount >= INSIGHT_UPDATE_THRESHOLD;
    } catch (error) {
      logError("[UserMemoryManager] Error checking if user insights should be updated:", error);
      // If there's an error, err on the side of updating
      return true;
    }
  }

  /**
   * Extract timestamp from a memory line (format: "- YYYY-MM-DDTHH:mm:ss ...")
   */
  private extractTimestampFromLine(line: string): Date | null {
    if (!line) return null;

    // Remove "- " prefix and extract timestamp
    const trimmed = line.replace(/^-\s*/, "");
    const timestampMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);

    if (!timestampMatch) {
      logError("[UserMemoryManager] Error extracting timestamp from line:", line);
      return null;
    }
    return new Date(timestampMatch[1] + "Z"); // Add Z for UTC
  }

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

  /**
   * Extract user insights using LLM with deduplication from class fields
   */
  private async extractUserInsights(chatModel: BaseChatModel): Promise<string | null> {
    if (!this.recentConversationsContent.trim()) {
      logInfo("[UserMemoryManager] No recent conversations found for insight extraction");
      return null;
    }

    const systemPrompt = `You are an AI assistant that analyzes past conversations and extracts user insights.

USER INSIGHTS: PERSISTENT factual information or preferences about the user written in a short sentence.

CRITICAL RULES:
1. Only extract PERMANENT, LONG-TERM characteristics about the user
2. DO NOT extract temporary activities, events, or situational information  
3. DO NOT make inferences or assumptions - only extract what the user EXPLICITLY states about themselves

✅ EXTRACT (Persistent traits - ONLY when explicitly stated by user):
- Their name, role, profession, or company 
- Technologies they regularly work with 
- Long-term projects or areas of focus 
- Skills, expertise areas, or certifications 
- Learning goals or career interests 
- Communication preferences 
- Preferred explanation depth 
- Format preferences 

❌ DO NOT EXTRACT (Temporary information OR inferences):
- Travel plans, vacation destinations, or weekend activities
- Current weather, temporary locations, or daily schedules
- One-time events, meetings, or appointments
- Temporary projects with specific deadlines
- Current mood, health status, or temporary circumstances
- Time-sensitive information or situational context
- LOCATION INFERENCES: Do not assume where user lives based on questions about places
- ASSUMPTIONS: Do not infer user characteristics from indirect context
- INTERESTS: Do not assume interests just because user asks about a topic

Examples of GOOD insights: "User's name is John" (when user says "My name is John"), "User is a senior software engineer" (when user says "I'm a senior engineer"), "User prefers TypeScript over JavaScript" (when user explicitly states preference), "User works in fintech industry" (when user mentions their industry)

Examples of BAD insights: 
- "User is traveling to Hakone this weekend" (temporary activity)
- "User has a meeting tomorrow" (temporary event) 
- "User lives in Tokyo" (inferred from asking about Chiba - WRONG!)
- "User is interested in Japanese culture" (inferred from location questions - WRONG!)
- "User is feeling stressed about deadlines" (temporary mood)

IMPORTANT: Only extract NEW information that is NOT already captured in the existing memory below.

<existing_insights>
${this.userInsightsContent || "None"}
</existing_insights>

# OUTPUT FORMAT
Return new user insights, one per line. If multiple insights are found, list them like this:
User's name is John
User is a senior software engineer
User prefers detailed explanations

If no new insights are found, return "NONE".`;

    const humanPrompt = `Analyze these recent conversations and extract any NEW PERSISTENT user insights not already captured.

STRICT REQUIREMENTS:
- Focus only on LONG-TERM characteristics that the user EXPLICITLY states about themselves
- DO NOT make inferences from questions they ask or topics they discuss
- DO NOT assume location, interests, or characteristics from conversation context
- Look for multiple insights if present - return each on a separate line

Each line is a separate conversation in the format: "<timestamp> <conversation summary>||||<user messages>".

${this.recentConversationsContent}`;

    const messages_llm = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

    try {
      const response = await chatModel.invoke(messages_llm);
      const insight = response.content.toString().trim();

      if (
        !insight ||
        insight.toLowerCase() === "none" ||
        insight.toLowerCase() === "no new insights"
      ) {
        return null;
      }

      return insight;
    } catch (error) {
      logError("[UserMemoryManager] Failed to extract user insights:", error);
      return null;
    }
  }
}
