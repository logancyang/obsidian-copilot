import { App, Notice, TFile, TFolder } from "obsidian";
import { ChatMessage } from "@/types/message";
import { MessageRepository } from "./MessageRepository";
import { logInfo, logError } from "@/logger";
import { formatDateTime } from "@/utils";
import { USER_SENDER, AI_SENDER } from "@/constants";
import { getSettings } from "@/settings/model";
import { getCurrentProject } from "@/aiParams";
import ChainManager from "@/LLMProviders/chainManager";
import { ensureFolderExists } from "@/utils";

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
    private messageRepo: MessageRepository,
    private chainManager?: ChainManager
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

      // Ensure the save folder exists (supports nested paths) using utility helper.
      await ensureFolderExists(settings.defaultSaveFolder);

      // Check if a file with this epoch already exists
      const existingFile = await this.findFileByEpoch(firstMessageEpoch);
      let topic: string | undefined;

      if (existingFile) {
        // If file exists, preserve the existing topic
        const frontmatter = this.app.metadataCache.getFileCache(existingFile)?.frontmatter;
        topic = frontmatter?.topic;
      } else {
        // If new file, generate AI topic only if enabled in settings
        if (settings.generateAIChatTitleOnSave) {
          topic = await this.generateAITopic(messages);
        } else {
          topic = undefined; // fallback to first 10 words will be used in filename
        }
      }

      const fileName = this.generateFileName(messages, firstMessageEpoch, topic);
      const noteContent = this.generateNoteContent(chatContent, firstMessageEpoch, modelKey, topic);

      if (existingFile) {
        // If the file exists, update its content
        await this.app.vault.modify(existingFile, noteContent);
        logInfo(`[ChatPersistenceManager] Updated existing chat file: ${existingFile.path}`);
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
        let content = `**${message.sender}**: ${message.message}`;

        // Include context information if present
        if (message.context) {
          const contextParts: string[] = [];

          if (message.context.notes?.length) {
            contextParts.push(
              `Notes: ${message.context.notes.map((note) => note.basename).join(", ")}`
            );
          }

          if (message.context.urls?.length) {
            contextParts.push(`URLs: ${message.context.urls.join(", ")}`);
          }

          if (message.context.tags?.length) {
            contextParts.push(`Tags: ${message.context.tags.join(", ")}`);
          }

          if (message.context.folders?.length) {
            contextParts.push(
              `Folders: ${message.context.folders.map((folder) => folder.name).join(", ")}`
            );
          }

          if (contextParts.length > 0) {
            content += `\n[Context: ${contextParts.join(" | ")}]`;
          }
        }

        content += `\n[Timestamp: ${timestamp}]`;
        return content;
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

      // Split content into lines to extract timestamp, context, and message
      const contentLines = fullContent.split("\n");
      let messageText = fullContent;
      let timestamp = "Unknown time";
      let contextInfo: any = undefined;

      // Check for context and timestamp lines
      let endIndex = contentLines.length;

      // Check if last line is a timestamp
      if (contentLines[endIndex - 1]?.startsWith("[Timestamp: ")) {
        const timestampMatch = contentLines[endIndex - 1].match(/\[Timestamp: (.*?)\]/);
        if (timestampMatch) {
          timestamp = timestampMatch[1];
          endIndex--;
        }
      }

      // Check if second-to-last line is context
      if (endIndex > 0 && contentLines[endIndex - 1]?.startsWith("[Context: ")) {
        const contextMatch = contentLines[endIndex - 1].match(/\[Context: (.*?)\]/);
        if (contextMatch) {
          const contextStr = contextMatch[1];
          contextInfo = this.parseContextString(contextStr);
          endIndex--;
        }
      }

      // Message is everything before context and timestamp
      messageText = contentLines.slice(0, endIndex).join("\n").trim();

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
        context: contextInfo,
      });
    }

    return messages;
  }

  /**
   * Parse context string back into context object
   */
  private parseContextString(contextStr: string): any {
    const context: any = {
      notes: [],
      urls: [],
      tags: [],
      folders: [],
    };

    // Split by | to get different context types
    const parts = contextStr.split(" | ");

    for (const part of parts) {
      const trimmed = part.trim();

      if (trimmed.startsWith("Notes: ")) {
        const notesStr = trimmed.substring(7); // Remove "Notes: "
        if (notesStr) {
          // For notes, we only have basenames. Create TFile-like objects with path = basename
          // This is a limitation since we don't save full paths, but it's better than nothing
          context.notes = notesStr.split(", ").map((basename) => ({
            basename: basename.trim(),
            path: basename.trim(), // Use basename as path since we don't have the full path
          }));
        }
      } else if (trimmed.startsWith("URLs: ")) {
        const urlsStr = trimmed.substring(6); // Remove "URLs: "
        if (urlsStr) {
          context.urls = urlsStr.split(", ").map((url) => url.trim());
        }
      } else if (trimmed.startsWith("Tags: ")) {
        const tagsStr = trimmed.substring(6); // Remove "Tags: "
        if (tagsStr) {
          context.tags = tagsStr.split(", ").map((tag) => tag.trim());
        }
      } else if (trimmed.startsWith("Folders: ")) {
        const foldersStr = trimmed.substring(9); // Remove "Folders: "
        if (foldersStr) {
          context.folders = foldersStr.split(", ").map((name) => ({
            name: name.trim(),
            path: name.trim(), // Use name as path since we don't have the full path
          }));
        }
      }
    }

    // Only return context if it has any content
    if (
      context.notes.length > 0 ||
      context.urls.length > 0 ||
      context.tags.length > 0 ||
      context.folders.length > 0
    ) {
      return context;
    }

    return undefined;
  }

  /**
   * Find a file by its epoch in the frontmatter
   */
  private async findFileByEpoch(epoch: number): Promise<TFile | null> {
    const files = await this.getChatHistoryFiles();

    for (const file of files) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter?.epoch === epoch) {
        return file;
      }
    }

    return null;
  }

  /**
   * Generate AI topic for the conversation
   */
  private async generateAITopic(messages: ChatMessage[]): Promise<string | undefined> {
    if (!this.chainManager) {
      return undefined;
    }

    try {
      const chatModel = this.chainManager.chatModelManager.getChatModel();
      if (!chatModel) {
        return undefined;
      }

      // Constants for topic generation
      const TOPIC_GENERATION_MESSAGE_LIMIT = 6;
      const TOPIC_GENERATION_CHAR_LIMIT = 200;

      // Get conversation content for topic generation - using reduce for efficiency
      const conversationSummary = messages.reduce((acc, m, i) => {
        if (i >= TOPIC_GENERATION_MESSAGE_LIMIT) return acc;
        return (
          acc +
          (acc ? "\n" : "") +
          `${m.sender}: ${m.message.slice(0, TOPIC_GENERATION_CHAR_LIMIT)}`
        );
      }, "");

      const prompt = `Generate a concise title (max 5 words) for this conversation based on its content. Return only the title without any explanation or quotes.

Conversation:
${conversationSummary}`;

      const response = await chatModel.invoke(prompt);
      const topic = response.content
        .toString()
        .trim()
        .replace(/^["']|["']$/g, "") // Remove quotes if present
        .replace(/[\\/:*?"<>|]/g, "") // Remove invalid filename characters
        .slice(0, 50); // Limit length

      return topic || undefined;
    } catch (error) {
      logError("[ChatPersistenceManager] Error generating AI topic:", error);
      return undefined;
    }
  }

  /**
   * Generate a file name for the chat
   */
  private generateFileName(
    messages: ChatMessage[],
    firstMessageEpoch: number,
    topic?: string
  ): string {
    const settings = getSettings();
    const formattedDateTime = formatDateTime(new Date(firstMessageEpoch));
    const timestampFileName = formattedDateTime.fileName;

    // Use provided topic or fall back to first 10 words
    let topicForFilename: string;
    if (topic) {
      topicForFilename = topic;
    } else {
      // Get the first user message
      const firstUserMessage = messages.find((message) => message.sender === USER_SENDER);

      // Get the first 10 words from the first user message and sanitize them
      topicForFilename = firstUserMessage
        ? firstUserMessage.message
            .split(/\s+/)
            .slice(0, 10)
            .join(" ")
            .replace(/[\\/:*?"<>|]/g, "") // Remove invalid filename characters
            .trim()
        : "Untitled Chat";
    }

    // Parse the custom format and replace variables
    let customFileName = settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}";

    // Create the file name (limit to 100 characters to avoid excessively long names)
    customFileName = customFileName
      .replace("{$topic}", topicForFilename.slice(0, 100).replace(/\s+/g, "_"))
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
    modelKey: string,
    topic?: string
  ): string {
    const settings = getSettings();
    const currentProject = getCurrentProject();

    return `---
epoch: ${firstMessageEpoch}
modelKey: ${modelKey}
${topic ? `topic: "${topic}"` : ""}
${currentProject ? `projectId: ${currentProject.id}` : ""}
${currentProject ? `projectName: ${currentProject.name}` : ""}
tags:
  - ${settings.defaultConversationTag}
---

${chatContent}`;
  }
}
