import { App, Notice, TFile, TFolder } from "obsidian";
import { ChatMessage } from "@/types/message";
import { MessageRepository } from "./MessageRepository";
import { logInfo, logError } from "@/logger";
import { formatDateTime } from "@/utils";
import { USER_SENDER, AI_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";
import { getCurrentProject } from "@/aiParams";

/**
 * ChatPersistenceManager - Handles saving and loading chat messages
 *
 * This class is responsible for:
 * - Saving chat history to markdown files in the vault
 * - Loading chat history from markdown files
 * - Managing project-aware file naming
 * - Formatting chat content for storage
 */
export class ChatPersistenceManager {
  constructor(
    private app: App,
    private messageRepo: MessageRepository
  ) {}

  /**
   * Save current chat history to a markdown file
   */
  async saveChat(modelKey: string): Promise<void> {
    try {
      const messages = this.messageRepo.getDisplayMessages();
      if (messages.length === 0) {
        new Notice("No messages to save.");
        return;
      }

      const settings = getSettings();
      const chatContent = this.formatChatContent(messages);
      const firstMessageEpoch = messages[0].timestamp?.epoch || Date.now();

      // Ensure the save folder exists
      const folder = this.app.vault.getAbstractFileByPath(settings.defaultSaveFolder);
      if (!folder) {
        await this.app.vault.createFolder(settings.defaultSaveFolder);
      }

      const fileName = this.generateFileName(messages, firstMessageEpoch);
      const noteContent = this.generateNoteContent(chatContent, firstMessageEpoch, modelKey);

      // Check if the file already exists
      const existingFile = this.app.vault.getAbstractFileByPath(fileName);
      if (existingFile instanceof TFile) {
        // If the file exists, update its content
        await this.app.vault.modify(existingFile, noteContent);
        logInfo(`[ChatPersistenceManager] Updated existing chat file: ${fileName}`);
      } else {
        // If the file doesn't exist, create a new one
        await this.app.vault.create(fileName, noteContent);
        new Notice(`Chat saved as note: ${fileName}`);
        logInfo(`[ChatPersistenceManager] Created new chat file: ${fileName}`);
      }
    } catch (error) {
      logError("[ChatPersistenceManager] Error saving chat:", error);
      new Notice("Failed to save chat as note. Check console for details.");
    }
  }

  /**
   * Load chat history from a markdown file
   */
  async loadChat(file: TFile): Promise<ChatMessage[]> {
    try {
      const content = await this.app.vault.read(file);
      const messages = this.parseChatContent(content);
      logInfo(`[ChatPersistenceManager] Loaded ${messages.length} messages from ${file.path}`);
      return messages;
    } catch (error) {
      logError("[ChatPersistenceManager] Error loading chat:", error);
      new Notice("Failed to load chat history. Check console for details.");
      return [];
    }
  }

  /**
   * Get all chat history files from the vault
   */
  async getChatHistoryFiles(): Promise<TFile[]> {
    const settings = getSettings();
    const folder = this.app.vault.getAbstractFileByPath(settings.defaultSaveFolder);
    if (!(folder instanceof TFolder)) {
      return [];
    }

    const files = this.app.vault.getMarkdownFiles();
    const folderFiles = files.filter((file) => file.path.startsWith(folder.path));

    // Get current project ID if in a project
    const currentProject = getCurrentProject();

    // Filter files based on project context
    return folderFiles.filter((file) => {
      if (currentProject) {
        // In project mode, only show files for this project
        return file.basename.startsWith(`${currentProject.id}__`);
      } else {
        // In non-project mode, only show files without project prefix
        return !file.basename.includes("__") || !file.basename.split("__")[0];
      }
    });
  }

  /**
   * Format messages into markdown content
   */
  private formatChatContent(messages: ChatMessage[]): string {
    return messages
      .map((message) => {
        const timestamp = message.timestamp ? message.timestamp.display : "Unknown time";
        return `**${message.sender}**: ${message.message}\n[Timestamp: ${timestamp}]`;
      })
      .join("\n\n");
  }

  /**
   * Parse markdown content back into messages
   */
  private parseChatContent(content: string): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // Extract the YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let chatContent = content;

    if (frontmatterMatch) {
      chatContent = content.slice(frontmatterMatch[0].length).trim();
    }

    // Parse messages from the content
    // Look for message pattern: **user**: or **ai**: followed by content
    const messagePattern = /\*\*(user|ai)\*\*: ([\s\S]*?)(?=(?:\n\*\*(?:user|ai)\*\*: )|$)/g;

    let match;
    while ((match = messagePattern.exec(chatContent)) !== null) {
      const sender = match[1] === "user" ? USER_SENDER : AI_SENDER;
      const fullContent = match[2].trim();

      // Split content into lines to extract timestamp and message
      const contentLines = fullContent.split("\n");
      let messageText = fullContent;
      let timestamp = "Unknown time";

      // Check if last line is a timestamp
      const lastLineIndex = contentLines.length - 1;
      if (lastLineIndex > 0 && contentLines[lastLineIndex].startsWith("[Timestamp: ")) {
        const timestampMatch = contentLines[lastLineIndex].match(/\[Timestamp: (.*?)\]/);
        if (timestampMatch) {
          timestamp = timestampMatch[1];
          // Message is everything except the timestamp line
          messageText = contentLines.slice(0, lastLineIndex).join("\n").trim();
        }
      }

      // Parse the timestamp
      let epoch: number | undefined;
      if (timestamp !== "Unknown time") {
        const date = new Date(timestamp);
        if (!isNaN(date.getTime())) {
          epoch = date.getTime();
        }
      }

      messages.push({
        message: messageText,
        sender,
        isVisible: true,
        timestamp: epoch
          ? {
              epoch,
              display: timestamp,
              fileName: "",
            }
          : null,
      });
    }

    return messages;
  }

  /**
   * Generate a file name for the chat
   */
  private generateFileName(messages: ChatMessage[], firstMessageEpoch: number): string {
    const settings = getSettings();
    const formattedDateTime = formatDateTime(new Date(firstMessageEpoch));
    const timestampFileName = formattedDateTime.fileName;

    // Get the first user message
    const firstUserMessage = messages.find((message) => message.sender === USER_SENDER);

    // Get the first 10 words from the first user message and sanitize them
    const firstTenWords = firstUserMessage
      ? firstUserMessage.message
          .split(/\s+/)
          .slice(0, 10)
          .join(" ")
          .replace(/[\\/:*?"<>|]/g, "") // Remove invalid filename characters
          .trim()
      : "Untitled Chat";

    // Parse the custom format and replace variables
    let customFileName = settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}";

    // Create the file name (limit to 100 characters to avoid excessively long names)
    customFileName = customFileName
      .replace("{$topic}", firstTenWords.slice(0, 100).replace(/\s+/g, "_"))
      .replace("{$date}", timestampFileName.split("_")[0])
      .replace("{$time}", timestampFileName.split("_")[1]);

    // Sanitize the final filename
    const sanitizedFileName = customFileName.replace(/[\\/:*?"<>|]/g, "_");

    // Add project ID as prefix for project-specific chat histories
    const currentProject = getCurrentProject();
    const filePrefix = currentProject ? `${currentProject.id}__` : "";

    return `${settings.defaultSaveFolder}/${filePrefix}${sanitizedFileName}.md`;
  }

  /**
   * Generate the full note content with frontmatter
   */
  private generateNoteContent(
    chatContent: string,
    firstMessageEpoch: number,
    modelKey: string
  ): string {
    const settings = getSettings();
    const currentProject = getCurrentProject();

    return `---
epoch: ${firstMessageEpoch}
modelKey: ${modelKey}
${currentProject ? `projectId: ${currentProject.id}` : ""}
${currentProject ? `projectName: ${currentProject.name}` : ""}
tags:
  - ${settings.defaultConversationTag}
---

${chatContent}`;
  }
}
