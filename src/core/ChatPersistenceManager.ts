import { getCurrentProject } from "@/aiParams";
import { AI_SENDER, USER_SENDER } from "@/constants";
import ChainManager from "@/LLMProviders/chainManager";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import {
  ensureFolderExists,
  extractTextFromChunk,
  formatDateTime,
  getUtf8ByteLength,
  truncateToByteLimit,
} from "@/utils";
import { App, Notice, TFile, TFolder } from "obsidian";
import { MessageRepository } from "./MessageRepository";

const SAFE_FILENAME_BYTE_LIMIT = 100;

/**
 * Escape a string for safe YAML double-quoted string value
 * Escapes backslashes and double quotes to prevent YAML parsing errors
 */
function escapeYamlString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

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
      let existingTopic = existingFile
        ? this.app.metadataCache.getFileCache(existingFile)?.frontmatter?.topic
        : undefined;

      const preferredFileName = existingFile
        ? existingFile.path
        : this.generateFileName(messages, firstMessageEpoch, existingTopic);

      const noteContent = this.generateNoteContent(
        chatContent,
        firstMessageEpoch,
        modelKey,
        existingTopic
      );
      let targetFile: TFile | null = existingFile;

      if (existingFile) {
        // If the file exists, update its content
        await this.app.vault.modify(existingFile, noteContent);
        logInfo(`[ChatPersistenceManager] Updated existing chat file: ${existingFile.path}`);
      } else {
        // If the file doesn't exist, create a new one
        try {
          targetFile = await this.app.vault.create(preferredFileName, noteContent);
          new Notice(`Chat saved as note: ${preferredFileName}`);
          logInfo(`[ChatPersistenceManager] Created new chat file: ${preferredFileName}`);
        } catch (error) {
          if (this.isFileAlreadyExistsError(error)) {
            const conflictFile = this.app.vault.getAbstractFileByPath(preferredFileName);
            if (conflictFile && conflictFile instanceof TFile) {
              // Update existingTopic to prevent unnecessary regeneration
              existingTopic =
                this.app.metadataCache.getFileCache(conflictFile)?.frontmatter?.topic ??
                existingTopic;
              await this.app.vault.modify(conflictFile, noteContent);
              targetFile = conflictFile;
              new Notice("Existing chat note found - updating it now.");
              logInfo(
                `[ChatPersistenceManager] Resolved save conflict by updating existing chat file: ${conflictFile.path}`
              );
            } else {
              throw error;
            }
          } else if (this.isNameTooLongError(error)) {
            // Single fallback: minimal guaranteed-to-work filename with project prefix
            const currentProject = getCurrentProject();
            const filePrefix = currentProject ? `${currentProject.id}__` : "";
            const fallbackName = `${settings.defaultSaveFolder}/${filePrefix}chat-${firstMessageEpoch}.md`;

            try {
              targetFile = await this.app.vault.create(fallbackName, noteContent);
              new Notice(`Chat saved as note: ${fallbackName}`);
              logWarn(
                `[ChatPersistenceManager] Used minimal filename due to length constraints: ${fallbackName}`
              );
            } catch (fallbackError) {
              if (this.isFileAlreadyExistsError(fallbackError)) {
                const conflictFile = this.app.vault.getAbstractFileByPath(fallbackName);
                if (conflictFile && conflictFile instanceof TFile) {
                  await this.app.vault.modify(conflictFile, noteContent);
                  targetFile = conflictFile;
                  new Notice("Existing chat note found - updating it now.");
                  logInfo(
                    `[ChatPersistenceManager] Resolved fallback save conflict by updating existing chat file: ${conflictFile.path}`
                  );
                } else {
                  throw fallbackError;
                }
              } else {
                throw fallbackError;
              }
            }
          } else {
            throw error;
          }
        }
      }

      this.generateTopicAsyncIfNeeded(messages, targetFile, existingTopic);
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
              `Notes: ${message.context.notes.map((note) => note.path).join(", ")}`
            );
          }

          if (message.context.urls?.length) {
            contextParts.push(`URLs: ${message.context.urls.join(", ")}`);
          }

          if (message.context.tags?.length) {
            contextParts.push(`Tags: ${message.context.tags.join(", ")}`);
          }

          if (message.context.folders?.length) {
            contextParts.push(`Folders: ${message.context.folders.join(", ")}`);
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
          // Parse note paths and resolve to TFile objects
          context.notes = notesStr
            .split(", ")
            .map((pathStr) => {
              const trimmedPath = pathStr.trim();

              // Try to resolve by full path first (new format)
              const file = this.app.vault.getAbstractFileByPath(trimmedPath);
              if (file instanceof TFile) {
                return file;
              }

              // Backward compatibility: If path not found, try basename resolution
              const basename = trimmedPath.includes("/")
                ? trimmedPath.split("/").pop()!
                : trimmedPath;

              const matches = this.app.vault
                .getMarkdownFiles()
                .filter((f) => f.basename === basename);

              if (matches.length === 1) {
                logInfo(
                  `[ChatPersistenceManager] Resolved legacy basename "${basename}" to ${matches[0].path}`
                );
                return matches[0];
              } else if (matches.length > 1) {
                logWarn(
                  `[ChatPersistenceManager] Ambiguous basename "${basename}", skipping. Matches: ${matches.map((f) => f.path).join(", ")}`
                );
              } else {
                logWarn(`[ChatPersistenceManager] Note not found: ${trimmedPath}`);
              }

              return null;
            })
            .filter((note): note is TFile => note !== null);
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
          context.folders = foldersStr.split(", ").map((folder) => folder.trim());
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
      const frontmatterEpoch =
        typeof frontmatter?.epoch === "number"
          ? frontmatter.epoch
          : typeof frontmatter?.epoch === "string"
            ? Number(frontmatter.epoch)
            : undefined;
      if (
        typeof frontmatterEpoch === "number" &&
        !Number.isNaN(frontmatterEpoch) &&
        frontmatterEpoch === epoch
      ) {
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
      const responseContent =
        typeof response === "string"
          ? response
          : ((response as { content?: unknown; text?: unknown }).content ??
            (response as { content?: unknown; text?: unknown }).text ??
            response);
      const topic = extractTextFromChunk(responseContent)
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
   * Generate a file name for the chat.
   * @param messages - The conversation messages used to derive the topic.
   * @param firstMessageEpoch - Epoch timestamp of the first message in the chat.
   * @param topic - Optional pre-computed topic to use for the filename.
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
            // Remove Obsidian wiki link brackets while preserving inner text: [[Title]] -> Title
            .replace(/\[\[([^\]]+)\]\]/g, "$1")
            // Remove any remaining square brackets or braces
            .replace(/[{}[\]]/g, "")
            // Now split to first 10 words
            .split(/\s+/)
            .slice(0, 10)
            .join(" ")
            // Remove invalid filename characters (including control chars)
            // eslint-disable-next-line no-control-regex
            .replace(/[\\/:*?"<>|\x00-\x1F]/g, "")
            .trim() || "Untitled Chat"
        : "Untitled Chat";
    }

    // Parse the custom format and replace variables
    let customFileName = settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}";

    // Get the current project prefix if any
    const currentProject = getCurrentProject();
    const filePrefix = currentProject ? `${currentProject.id}__` : "";

    // Calculate fixed components in bytes
    const extensionBytes = getUtf8ByteLength(".md");
    const filePrefixBytes = getUtf8ByteLength(filePrefix);

    // Calculate the custom format overhead (everything except {$topic})
    const formatOverhead = customFileName
      .replace("{$topic}", "")
      .replace("{$date}", timestampFileName.split("_")[0])
      .replace("{$time}", timestampFileName.split("_")[1]);
    const formatOverheadBytes = getUtf8ByteLength(formatOverhead);

    // Calculate the maximum bytes available for the topic
    const topicByteBudget = Math.max(
      20, // Minimum 20 bytes for topic to ensure at least some meaningful text
      SAFE_FILENAME_BYTE_LIMIT - extensionBytes - filePrefixBytes - formatOverheadBytes
    );

    // Replace spaces with underscores and truncate to byte limit
    const topicWithUnderscores = topicForFilename.replace(/\s+/g, "_");
    const truncatedTopic = truncateToByteLimit(topicWithUnderscores, topicByteBudget);

    // Create the file name with the truncated topic
    customFileName = customFileName
      .replace("{$topic}", truncatedTopic)
      .replace("{$date}", timestampFileName.split("_")[0])
      .replace("{$time}", timestampFileName.split("_")[1]);

    // Sanitize the final filename (replace any illegal chars with underscore)
    // Also remove leftover square brackets which are illegal on some platforms
    // eslint-disable-next-line no-control-regex
    const sanitizedFileName = customFileName
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/[{}[\]]/g, "_")
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_");

    // Final safety check: ensure the complete basename fits within the limit
    const baseNameWithPrefix = `${filePrefix}${sanitizedFileName}.md`;
    if (getUtf8ByteLength(baseNameWithPrefix) > SAFE_FILENAME_BYTE_LIMIT) {
      // If still too long, truncate the entire filename more aggressively
      const availableForBasename = SAFE_FILENAME_BYTE_LIMIT - extensionBytes - filePrefixBytes;
      const truncatedBasename = truncateToByteLimit(sanitizedFileName, availableForBasename);
      return `${settings.defaultSaveFolder}/${filePrefix}${truncatedBasename}.md`;
    }

    return `${settings.defaultSaveFolder}/${baseNameWithPrefix}`;
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
modelKey: "${escapeYamlString(modelKey)}"
${topic ? `topic: "${topic}"` : ""}
${currentProject ? `projectId: ${currentProject.id}` : ""}
${currentProject ? `projectName: ${currentProject.name}` : ""}
tags:
  - ${settings.defaultConversationTag}
---

${chatContent}`;
  }

  /**
   * Trigger asynchronous topic generation and apply it to the saved note once available
   */
  private generateTopicAsyncIfNeeded(
    messages: ChatMessage[],
    file: TFile | null,
    existingTopic?: string
  ): void {
    const settings = getSettings();

    if (!settings.generateAIChatTitleOnSave || !file || existingTopic) {
      return;
    }

    void (async () => {
      try {
        const topic = await this.generateAITopic(messages);
        if (!topic) {
          return;
        }
        await this.applyTopicToFrontmatter(file, topic);
      } catch (error) {
        logError("[ChatPersistenceManager] Error during async topic generation:", error);
      }
    })();
  }

  /**
   * Apply the AI-generated topic to the note's YAML frontmatter
   */
  private async applyTopicToFrontmatter(file: TFile, topic: string): Promise<void> {
    try {
      if (!this.app.fileManager?.processFrontMatter) {
        return;
      }

      const sanitizedTopic = topic.trim();

      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (frontmatter.topic === sanitizedTopic) {
          return;
        }
        frontmatter.topic = sanitizedTopic;
      });

      logInfo(`[ChatPersistenceManager] Applied AI topic to chat file: ${file.path}`);
    } catch (error) {
      logError("[ChatPersistenceManager] Error applying AI topic to file:", error);
    }
  }

  /**
   * Determine whether an error corresponds to an ENAMETOOLONG filesystem failure.
   * @param error - The thrown error.
   * @returns True when the error message indicates a name-length constraint violation.
   */
  private isNameTooLongError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return normalized.includes("enametoolong") || normalized.includes("name too long");
  }

  /**
   * Determine if an error indicates an Obsidian file-exists conflict.
   */
  private isFileAlreadyExistsError(error: unknown): boolean {
    if (!error) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes("already exists");
  }
}
