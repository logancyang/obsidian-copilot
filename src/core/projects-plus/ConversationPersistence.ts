/**
 * ConversationPersistence - Handles saving/loading Discuss conversations
 *
 * File format: Markdown with YAML frontmatter
 * Location: copilot/projects/{project-id}__slug/conversations/{conversation-id}.md
 */

import { AI_SENDER, USER_SENDER } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { Conversation, ConversationMetadata, DiscussMessage } from "@/types/discuss";
import { Project } from "@/types/projects-plus";
import { ensureFolderExists, formatDateTime } from "@/utils";
import { App, TFile, TFolder } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { ProjectPersistence } from "./ProjectPersistence";

/**
 * Escape a string for safe YAML double-quoted string value
 */
function escapeYamlString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * ConversationPersistence - Manages conversation file I/O for Discuss feature
 */
export class ConversationPersistence {
  private projectPersistence: ProjectPersistence;

  constructor(private app: App) {
    this.projectPersistence = new ProjectPersistence(app);
  }

  /**
   * Get the conversations folder path for a project
   */
  getConversationsFolderPath(project: Project): string {
    const projectFolder = this.projectPersistence.getProjectFolderPath(project.id, project.title);
    return `${projectFolder}/conversations`;
  }

  /**
   * Get the file path for a specific conversation
   */
  getConversationFilePath(project: Project, conversationId: string): string {
    return `${this.getConversationsFolderPath(project)}/${conversationId}.md`;
  }

  /**
   * Generate a new conversation ID
   */
  generateConversationId(): string {
    return `conv-${uuidv4().slice(0, 8)}`;
  }

  /**
   * Save a conversation to disk
   */
  async saveConversation(
    project: Project,
    conversationId: string,
    title: string,
    messages: DiscussMessage[]
  ): Promise<void> {
    try {
      const folderPath = this.getConversationsFolderPath(project);
      const filePath = this.getConversationFilePath(project, conversationId);

      // Ensure conversations folder exists
      await ensureFolderExists(folderPath);

      // Generate content
      const content = this.generateConversationContent({
        id: conversationId,
        projectId: project.id,
        title,
        createdAt: messages[0]?.timestamp?.epoch || Date.now(),
        updatedAt: Date.now(),
        messageCount: messages.length,
        messages,
      });

      // Check if file exists
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);
      if (existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, content);
        logInfo(`[ConversationPersistence] Updated conversation file: ${filePath}`);
      } else {
        await this.app.vault.create(filePath, content);
        logInfo(`[ConversationPersistence] Created conversation file: ${filePath}`);
      }
    } catch (error) {
      logError("[ConversationPersistence] Error saving conversation:", error);
      throw error;
    }
  }

  /**
   * Load a conversation from disk
   */
  async loadConversation(project: Project, conversationId: string): Promise<Conversation | null> {
    try {
      const filePath = this.getConversationFilePath(project, conversationId);
      const file = this.app.vault.getAbstractFileByPath(filePath);

      if (!(file instanceof TFile)) {
        logWarn(`[ConversationPersistence] Conversation file not found: ${filePath}`);
        return null;
      }

      const content = await this.app.vault.read(file);
      return this.parseConversationContent(content, project.id);
    } catch (error) {
      logError(`[ConversationPersistence] Error loading conversation:`, error);
      return null;
    }
  }

  /**
   * List all conversations for a project
   */
  async listConversations(project: Project): Promise<ConversationMetadata[]> {
    const conversations: ConversationMetadata[] = [];

    try {
      const folderPath = this.getConversationsFolderPath(project);
      const folder = this.app.vault.getAbstractFileByPath(folderPath);

      if (!(folder instanceof TFolder)) {
        // Folder doesn't exist yet
        return conversations;
      }

      // Iterate through files in the folder
      for (const child of folder.children) {
        if (!(child instanceof TFile) || !child.path.endsWith(".md")) continue;

        const content = await this.app.vault.read(child);
        const metadata = this.parseConversationMetadata(content, project.id);

        if (metadata) {
          conversations.push(metadata);
        }
      }

      // Sort by updatedAt descending (most recent first)
      conversations.sort((a, b) => b.updatedAt - a.updatedAt);

      logInfo(
        `[ConversationPersistence] Listed ${conversations.length} conversations for project ${project.id}`
      );
      return conversations;
    } catch (error) {
      logError("[ConversationPersistence] Error listing conversations:", error);
      return conversations;
    }
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(project: Project, conversationId: string): Promise<boolean> {
    try {
      const filePath = this.getConversationFilePath(project, conversationId);
      const file = this.app.vault.getAbstractFileByPath(filePath);

      if (file instanceof TFile) {
        await this.app.vault.delete(file);
        logInfo(`[ConversationPersistence] Deleted conversation: ${filePath}`);
        return true;
      }

      logWarn(`[ConversationPersistence] Conversation file not found for deletion: ${filePath}`);
      return false;
    } catch (error) {
      logError("[ConversationPersistence] Error deleting conversation:", error);
      return false;
    }
  }

  /**
   * Generate conversation file content with YAML frontmatter
   */
  private generateConversationContent(data: {
    id: string;
    projectId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    messages: DiscussMessage[];
  }): string {
    const { id, projectId, title, createdAt, updatedAt, messageCount, messages } = data;

    // Build YAML frontmatter
    const frontmatter = `---
id: "${escapeYamlString(id)}"
projectId: "${escapeYamlString(projectId)}"
title: "${escapeYamlString(title)}"
createdAt: ${createdAt}
updatedAt: ${updatedAt}
messageCount: ${messageCount}
---`;

    // Build markdown body
    let body = `\n\n# ${title}\n`;

    for (const message of messages) {
      const sender = message.sender.toLowerCase();
      const timestamp = message.timestamp?.display || formatDateTime(new Date()).display;

      body += `\n## ${sender} (${timestamp})\n\n`;
      body += message.message;

      // Add sources for AI messages
      if (sender !== "user" && message.discussSources && message.discussSources.length > 0) {
        body += "\n\n**Sources:**";
        for (const source of message.discussSources) {
          body += `\n- [[${source.title}]]`;
        }
      }

      body += "\n";
    }

    return frontmatter + body;
  }

  /**
   * Parse conversation content back into Conversation object
   */
  private parseConversationContent(content: string, projectId: string): Conversation | null {
    try {
      // Extract YAML frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        logWarn("[ConversationPersistence] No frontmatter found in conversation file");
        return null;
      }

      const metadata = this.parseYamlFrontmatter(frontmatterMatch[1], projectId);
      if (!metadata) {
        return null;
      }

      // Parse messages from body
      const bodyContent = content.slice(frontmatterMatch[0].length).trim();
      const messages = this.parseMessages(bodyContent);

      return {
        metadata,
        messages,
      };
    } catch (error) {
      logError("[ConversationPersistence] Error parsing conversation content:", error);
      return null;
    }
  }

  /**
   * Parse just the metadata from conversation content
   */
  private parseConversationMetadata(
    content: string,
    projectId: string
  ): ConversationMetadata | null {
    try {
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        return null;
      }

      return this.parseYamlFrontmatter(frontmatterMatch[1], projectId);
    } catch (error) {
      logError("[ConversationPersistence] Error parsing conversation metadata:", error);
      return null;
    }
  }

  /**
   * Parse YAML frontmatter into ConversationMetadata
   */
  private parseYamlFrontmatter(
    yamlStr: string,
    fallbackProjectId: string
  ): ConversationMetadata | null {
    try {
      const result: Partial<ConversationMetadata> = {};
      const lines = yamlStr.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("id:")) {
          result.id = this.parseYamlValue(trimmed.slice(3));
        } else if (trimmed.startsWith("projectId:")) {
          result.projectId = this.parseYamlValue(trimmed.slice(10));
        } else if (trimmed.startsWith("title:")) {
          result.title = this.parseYamlValue(trimmed.slice(6));
        } else if (trimmed.startsWith("createdAt:")) {
          result.createdAt = parseInt(this.parseYamlValue(trimmed.slice(10)), 10);
        } else if (trimmed.startsWith("updatedAt:")) {
          result.updatedAt = parseInt(this.parseYamlValue(trimmed.slice(10)), 10);
        } else if (trimmed.startsWith("messageCount:")) {
          result.messageCount = parseInt(this.parseYamlValue(trimmed.slice(13)), 10);
        }
      }

      // Validate required fields
      if (!result.id || !result.title || !result.createdAt || !result.updatedAt) {
        logWarn("[ConversationPersistence] Missing required fields in frontmatter");
        return null;
      }

      // Use fallback project ID if not in frontmatter
      if (!result.projectId) {
        result.projectId = fallbackProjectId;
      }

      // Default messageCount to 0 if missing
      if (result.messageCount === undefined) {
        result.messageCount = 0;
      }

      return result as ConversationMetadata;
    } catch (error) {
      logError("[ConversationPersistence] Error parsing YAML frontmatter:", error);
      return null;
    }
  }

  /**
   * Parse a simple YAML value (removes quotes)
   */
  private parseYamlValue(value: string): string {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return trimmed;
  }

  /**
   * Parse messages from the markdown body
   */
  private parseMessages(bodyContent: string): DiscussMessage[] {
    const messages: DiscussMessage[] = [];

    // Match message sections: ## sender (timestamp)
    const messagePattern =
      /## (user|assistant|ai) \(([^)]+)\)\n\n([\s\S]*?)(?=\n## (?:user|assistant|ai) \(|$)/gi;

    let match;
    while ((match = messagePattern.exec(bodyContent)) !== null) {
      const senderRaw = match[1].toLowerCase();
      const sender = senderRaw === "user" ? USER_SENDER : AI_SENDER;
      const timestampStr = match[2];
      let messageText = match[3].trim();

      // Extract sources from AI messages
      let discussSources: { path: string; title: string; exists: boolean }[] | undefined;
      const sourcesMatch = messageText.match(/\n\n\*\*Sources:\*\*([\s\S]*?)$/);

      if (sourcesMatch) {
        // Remove sources from message text
        messageText = messageText.slice(0, sourcesMatch.index).trim();

        // Parse sources
        const sourcesText = sourcesMatch[1];
        const sourcePattern = /\[\[([^\]]+)\]\]/g;
        discussSources = [];

        let sourceMatch;
        while ((sourceMatch = sourcePattern.exec(sourcesText)) !== null) {
          const title = sourceMatch[1];
          // Try to find the file
          const files = this.app.vault.getMarkdownFiles().filter((f) => f.basename === title);
          const exists = files.length > 0;
          const path = exists ? files[0].path : `${title}.md`;

          discussSources.push({ path, title, exists });
        }
      }

      // Parse timestamp
      let epoch: number | undefined;
      const date = new Date(timestampStr);
      if (!isNaN(date.getTime())) {
        epoch = date.getTime();
      }

      messages.push({
        message: messageText,
        sender,
        isVisible: true,
        timestamp: epoch
          ? {
              epoch,
              display: timestampStr,
              fileName: "",
            }
          : null,
        discussSources,
      });
    }

    return messages;
  }
}
