import { App, TFile } from "obsidian";
import { ChatMessage } from "@/types/message";
import { logInfo, logError } from "@/logger";
import { USER_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";

/**
 * Memory Management Functions
 *
 * Pure functions for analyzing chat messages and storing useful information in memory files.
 * Main exported function: updateMemoryWithConversation
 */

/**
 * Analyze chat messages and store useful information in memory files
 */
export async function updateMemoryWithConversation(
  app: App,
  messages: ChatMessage[]
): Promise<void> {
  try {
    const settings = getSettings();

    // Only proceed if memory is enabled
    if (!settings.enableMemory) {
      logInfo("[MemoryManager] Memory is disabled, skipping analysis");
      return;
    }

    if (messages.length === 0) {
      logInfo("[MemoryManager] No messages to analyze for memory");
      return;
    }

    // Extract only user messages for analysis
    const userMessages = messages.filter((message) => message.sender === USER_SENDER);

    if (userMessages.length === 0) {
      logInfo("[MemoryManager] No user messages found to analyze for memory");
      return;
    }

    // Format user messages for memory storage
    const conversationLine = createConversationContent(userMessages);

    // Ensure memory folder exists
    await ensureMemoryFolderExists(app);

    // Save to memory file
    await saveToMemoryFile(app, conversationLine);
  } catch (error) {
    logError("[MemoryManager] Error analyzing chat messages for memory:", error);
  }
}

/**
 * Create conversation content
 * Format: - timestamp||||message1||||message2||||message3...
 */
function createConversationContent(userMessages: ChatMessage[]): string {
  const timestamp = new Date().toISOString().split(".")[0]; // Remove milliseconds and Z

  // Extract just the message text from user messages
  const messageTexts = userMessages.map((message) => message.message);

  // Join with |||| separator as specified
  return `- ${timestamp}||||${messageTexts.join("||||")}`;
}

/**
 * Ensure the memory folder exists
 */
async function ensureMemoryFolderExists(app: App): Promise<void> {
  const settings = getSettings();
  const memoryFolderPath = settings.memoryFolderName;

  const folder = app.vault.getAbstractFileByPath(memoryFolderPath);
  if (!folder) {
    await app.vault.createFolder(memoryFolderPath);
    logInfo(`[MemoryManager] Created memory folder: ${memoryFolderPath}`);
  }
}

/**
 * Save content to the memory file by appending new conversation
 */
async function saveToMemoryFile(app: App, newConversationLine: string): Promise<void> {
  const settings = getSettings();
  const memoryFolderPath = settings.memoryFolderName;
  const memoryFilePath = `${memoryFolderPath}/recent_conversation_content.md`;

  try {
    const existingFile = app.vault.getAbstractFileByPath(memoryFilePath);

    if (existingFile instanceof TFile) {
      // Read existing content and append new conversation
      const existingContent = await app.vault.read(existingFile);
      const updatedContent = existingContent.trim() + "\n" + newConversationLine;
      await app.vault.modify(existingFile, updatedContent);
      logInfo(`[MemoryManager] Appended conversation to existing memory file: ${memoryFilePath}`);
    } else {
      // Create new file with first conversation
      await app.vault.create(memoryFilePath, newConversationLine);
      logInfo(`[MemoryManager] Created new memory file: ${memoryFilePath}`);
    }
  } catch (error) {
    logError("[MemoryManager] Error saving to memory file:", error);
    throw error;
  }
}

/**
 * Get the path to the memory file
 */
function getMemoryFilePath(): string {
  const settings = getSettings();
  return `${settings.memoryFolderName}/recent_conversation_context.txt`;
}

/**
 * Check if memory functionality is enabled
 */
export function isMemoryEnabled(): boolean {
  return getSettings().enableMemory;
}

/**
 * Read existing memory content
 */
async function readMemoryContent(app: App): Promise<string | null> {
  try {
    const memoryFilePath = getMemoryFilePath();
    const memoryFile = app.vault.getAbstractFileByPath(memoryFilePath);

    if (memoryFile instanceof TFile) {
      const content = await app.vault.read(memoryFile);
      return content;
    }

    return null;
  } catch (error) {
    logError("[MemoryManager] Error reading memory content:", error);
    return null;
  }
}

/**
 * Parse stored conversation lines into structured format
 */
export interface StoredConversation {
  timestamp: string;
  userMessages: string[];
}

/**
 * Read and parse all stored conversations
 */
export async function getStoredConversations(app: App): Promise<StoredConversation[]> {
  try {
    const content = await readMemoryContent(app);
    if (!content) {
      return [];
    }

    const lines = content
      .trim()
      .split("\n")
      .filter((line) => line.trim());
    const conversations: StoredConversation[] = [];

    for (const line of lines) {
      const parts = line.split("||||");
      if (parts.length >= 2) {
        const timestamp = parts[0];
        const userMessages = parts.slice(1); // All parts after timestamp are user messages
        conversations.push({ timestamp, userMessages });
      }
    }

    return conversations;
  } catch (error) {
    logError("[MemoryManager] Error parsing stored conversations:", error);
    return [];
  }
}
