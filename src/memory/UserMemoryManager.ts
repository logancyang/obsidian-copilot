import { App, TFile } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError } from "@/logger";
import { USER_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const MAX_CONVERSATION_LINES = 40;
/**
 * User Memory Management Class
 *
 * Static methods for building and managing user memory based on conversations.
 * The UserMemoryManager has methods to add recent conversations, user facts to the user memory
 * which can then be used to personalize LLM response.
 */
export class UserMemoryManager {
  /**
   * Runs the user memory operation in the background without blocking execution
   */
  static updateRecentConversations(
    app: App,
    messages: ChatMessage[],
    chatModel?: BaseChatModel
  ): void {
    // Fire and forget - run in background
    console.log("[UserMemoryManager] Adding to user memory", messages);
    updateRecentConversations(app, messages, chatModel)
      .catch((error) => {
        logError("[UserMemoryManager] Background user memory operation failed:", error);
      })
      .finally(() => {
        console.log("[UserMemoryManager] Added to user memory");
      });
  }

  /**
   * Get user memory prompt
   */
  static async getUserMemoryPrompt(app: App): Promise<string | null> {
    try {
      const recentConversationFile = app.vault.getAbstractFileByPath(
        getRecentConversationFilePath()
      );
      let recentConversationContent: string | null = null;
      if (recentConversationFile instanceof TFile) {
        const content = await app.vault.read(recentConversationFile);
        recentConversationContent = content;
      }

      return `
      # Recent Conversation Content
      ${recentConversationContent}
      `;
    } catch (error) {
      logError("[UserMemoryManager] Error reading user memory content:", error);
      return null;
    }
  }
}

/**
 * Get the path to the user memory file
 */
function getRecentConversationFilePath(): string {
  const settings = getSettings();
  return `${settings.memoryFolderName}/recent_conversation_content.md`;
}

/**
 * Ensure the user memory folder exists
 */
async function ensureMemoryFolderExists(app: App): Promise<void> {
  const settings = getSettings();
  const memoryFolderPath = settings.memoryFolderName;

  const folder = app.vault.getAbstractFileByPath(memoryFolderPath);
  if (!folder) {
    await app.vault.createFolder(memoryFolderPath);
    logInfo(`[UserMemoryManager] Created user memory folder: ${memoryFolderPath}`);
  }
}

/**
 * Save content to the user memory file by appending new conversation
 */
async function addToRecentConversationFile(app: App, newConversation: string): Promise<void> {
  const memoryFilePath = getRecentConversationFilePath();
  const newConversationLine = `- ${newConversation}`;

  try {
    const existingFile = app.vault.getAbstractFileByPath(memoryFilePath);

    if (existingFile instanceof TFile) {
      // Read existing conversation lines, append the new line.
      // Make sure the content lines do not exceed 40 lines. If it does, remove the first line.
      const fileContent = await app.vault.read(existingFile);
      const lines = fileContent.split("\n");
      lines.push(newConversationLine);

      if (lines.length > MAX_CONVERSATION_LINES) {
        // Remove the first line to keep within 40 lines limit
        lines.shift();
      }

      const updatedContent = lines.join("\n");
      await app.vault.modify(existingFile, updatedContent);
    } else {
      await app.vault.create(memoryFilePath, newConversationLine);
    }
  } catch (error) {
    logError(`[UserMemoryManager] Error saving to user memory file ${memoryFilePath}:`, error);
    throw error;
  }
}

/**
 * Summarize conversation using LLM into a few words
 */
async function summarizeConversation(
  messageTexts: string[],
  chatModel: BaseChatModel
): Promise<string> {
  const conversationText = messageTexts.join("\n\n");

  const systemPrompt = `You are a helpful assistant that creates very brief conversation summaries. 
Create a short summary of the following conversation in just a few words (2-5 words maximum). 
Focus on the main topic or action. Examples: "Code debugging", "API integration", "UI design help", "Data analysis".`;

  const humanPrompt = `Summarize this conversation in just a few words:

${conversationText}`;

  const messages = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

  const response = await chatModel.invoke(messages);
  return response.content.toString().trim();
}

/**
 * Create conversation content with conversation summary and all messages
 * Format: timestamp conversation_summary||||user_message_1||||user_message_2...
 */
async function createConversationContent(
  messages: ChatMessage[],
  chatModel?: BaseChatModel
): Promise<string | null> {
  if (messages.length === 0) {
    return null;
  }

  const timestamp = new Date().toISOString().split(".")[0]; // Remove milliseconds and Z

  // Extract all user message texts
  const messageTexts = messages
    .filter((message) => message.sender === USER_SENDER)
    .map((message) => message.message);

  let summary: string = "No summary";

  // Generate conversation summary
  if (chatModel) {
    try {
      summary = await summarizeConversation(messageTexts, chatModel);
    } catch (error) {
      logError("[UserMemoryManager] Failed to generate conversation summary:", error);
    }
  }
  const content = messageTexts.join("||||");
  return `${timestamp} ${summary}||||${content}`;
}

/**
 * Analyze chat messages and store useful information in user memory files
 */
async function updateRecentConversations(
  app: App,
  messages: ChatMessage[],
  chatModel?: BaseChatModel
): Promise<void> {
  try {
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

    // Format all messages for user memory storage, with conversation summary
    const conversationLine = await createConversationContent(messages, chatModel);

    // Ensure user memory folder exists
    await ensureMemoryFolderExists(app);

    // Save to user memory file
    if (conversationLine) {
      await addToRecentConversationFile(app, conversationLine);
    }
  } catch (error) {
    logError("[UserMemoryManager] Error analyzing chat messages for user memory:", error);
  }
}
