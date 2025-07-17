import { getSettings } from "@/settings/model";
import { ChainType } from "@/chainFactory";
import { logInfo } from "@/logger";
import { ChatMessage, MessageContext } from "@/types/message";
import { FileParserManager } from "@/tools/FileParserManager";
import ChainManager from "@/LLMProviders/chainManager";
import { updateChatMemory } from "@/chatUtils";
import CopilotPlugin from "@/main";
import { ContextManager } from "./ContextManager";
import { MessageRepository } from "./MessageRepository";
import { ChatPersistenceManager } from "./ChatPersistenceManager";
import { USER_SENDER } from "@/constants";

/**
 * ChatManager - Central business logic coordinator
 *
 * This is the main business logic hub that coordinates all chat operations.
 * It orchestrates MessageRepository, ContextManager, and LLM chain operations
 * while providing a clean API for UI components.
 */
export class ChatManager {
  private contextManager: ContextManager;
  private projectMessageRepos: Map<string, MessageRepository> = new Map();
  private defaultProjectKey = "defaultProjectKey";
  private lastKnownProjectId: string | null = null;
  private persistenceManager: ChatPersistenceManager;

  constructor(
    private messageRepo: MessageRepository,
    private chainManager: ChainManager,
    private fileParserManager: FileParserManager,
    private plugin: CopilotPlugin
  ) {
    this.contextManager = ContextManager.getInstance();
    // Initialize default project repository
    this.projectMessageRepos.set(this.defaultProjectKey, messageRepo);
    // Initialize persistence manager with default repository
    this.persistenceManager = new ChatPersistenceManager(plugin.app, messageRepo);
  }

  /**
   * Get the current project's message repository
   * Automatically detects project changes and handles repository switching
   */
  private getCurrentMessageRepo(): MessageRepository {
    const currentProjectId = this.plugin.projectManager.getCurrentProjectId();
    const projectKey = currentProjectId ?? this.defaultProjectKey;

    // Detect if project has changed
    if (this.lastKnownProjectId !== currentProjectId) {
      logInfo(
        `[ChatManager] Project changed from ${this.lastKnownProjectId} to ${currentProjectId}`
      );
      this.lastKnownProjectId = currentProjectId;
    }

    // Create a new repository for this project if it doesn't exist
    if (!this.projectMessageRepos.has(projectKey)) {
      logInfo(`[ChatManager] Creating new message repository for project: ${projectKey}`);
      const newRepo = new MessageRepository();
      this.projectMessageRepos.set(projectKey, newRepo);
    }

    const currentRepo = this.projectMessageRepos.get(projectKey)!;

    // Update persistence manager to use current repository
    this.persistenceManager = new ChatPersistenceManager(this.plugin.app, currentRepo);

    return currentRepo;
  }

  /**
   * Send a new message with context processing
   */
  async sendMessage(
    displayText: string,
    context: MessageContext,
    chainType: ChainType,
    includeActiveNote: boolean = false
  ): Promise<string> {
    try {
      logInfo(`[ChatManager] Sending message: "${displayText}"`);

      // Get active note
      const activeNote = this.plugin.app.workspace.getActiveFile();

      // If includeActiveNote is true and there's an active note, add it to context
      const updatedContext = { ...context };
      if (includeActiveNote && activeNote) {
        const existingNotes = context.notes || [];
        // Only add activeNote if it's not already in the context
        const hasActiveNote = existingNotes.some((note) => note.path === activeNote.path);
        updatedContext.notes = hasActiveNote ? existingNotes : [...existingNotes, activeNote];
      }

      // Create the message with initial content
      const currentRepo = this.getCurrentMessageRepo();
      const messageId = currentRepo.addMessage(
        displayText,
        displayText, // Will be updated with processed content
        USER_SENDER,
        updatedContext
      );

      // Get the message for context processing
      const message = currentRepo.getMessage(messageId);
      if (!message) {
        throw new Error(`Failed to retrieve message ${messageId}`);
      }

      // Process context to generate LLM content
      const processedContent = await this.contextManager.processMessageContext(
        message,
        this.fileParserManager,
        this.plugin.app.vault,
        chainType,
        includeActiveNote,
        activeNote
      );

      // Update the processed content
      currentRepo.updateProcessedText(messageId, processedContent);

      logInfo(`[ChatManager] Successfully sent message ${messageId}`);
      return messageId;
    } catch (error) {
      logInfo(`[ChatManager] Error sending message:`, error);
      throw error;
    }
  }

  /**
   * Edit an existing message
   */
  async editMessage(
    messageId: string,
    newText: string,
    chainType: ChainType,
    includeActiveNote: boolean = false
  ): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Editing message ${messageId}: "${newText}"`);

      // Edit the message (this marks it for context reprocessing)
      const currentRepo = this.getCurrentMessageRepo();
      const editSuccess = currentRepo.editMessage(messageId, newText);
      if (!editSuccess) {
        return false;
      }

      // Reprocess context for the edited message
      const activeNote = this.plugin.app.workspace.getActiveFile();
      await this.contextManager.reprocessMessageContext(
        messageId,
        currentRepo,
        this.fileParserManager,
        this.plugin.app.vault,
        chainType,
        includeActiveNote,
        activeNote
      );

      // Update chain memory with fresh LLM messages
      await this.updateChainMemory();

      logInfo(`[ChatManager] Successfully edited message ${messageId}`);
      return true;
    } catch (error) {
      logInfo(`[ChatManager] Error editing message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Regenerate an AI response
   */
  async regenerateMessage(
    messageId: string,
    onUpdateCurrentMessage: (message: string) => void,
    onAddMessage: (message: ChatMessage) => void
  ): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Regenerating message ${messageId}`);

      // Find the message to regenerate
      const currentRepo = this.getCurrentMessageRepo();
      const message = currentRepo.getMessage(messageId);
      if (!message) {
        logInfo(`[ChatManager] Message not found: ${messageId}`);
        return false;
      }

      // Find the corresponding user message (should be the previous message)
      const displayMessages = currentRepo.getDisplayMessages();
      const messageIndex = displayMessages.findIndex((msg) => msg.id === messageId);

      if (messageIndex <= 0) {
        logInfo(`[ChatManager] Cannot regenerate first message or no user message found`);
        return false;
      }

      const userMessage = displayMessages[messageIndex - 1];
      if (userMessage.sender !== USER_SENDER) {
        logInfo(`[ChatManager] Previous message is not from user`);
        return false;
      }

      // Truncate messages after the user message
      currentRepo.truncateAfter(messageIndex - 1);

      // Update chain memory
      await this.updateChainMemory();

      // Get the LLM version of the user message for regeneration
      if (!userMessage.id) {
        logInfo(`[ChatManager] User message has no ID for regeneration`);
        return false;
      }

      const llmMessage = currentRepo.getLLMMessage(userMessage.id);
      if (!llmMessage) {
        logInfo(`[ChatManager] LLM message not found for regeneration`);
        return false;
      }

      // Run the chain to regenerate the response
      const abortController = new AbortController();
      await this.chainManager.runChain(
        llmMessage,
        abortController,
        onUpdateCurrentMessage,
        onAddMessage,
        { debug: getSettings().debug }
      );

      logInfo(`[ChatManager] Successfully regenerated message ${messageId}`);
      return true;
    } catch (error) {
      logInfo(`[ChatManager] Error regenerating message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Deleting message ${messageId}`);

      const currentRepo = this.getCurrentMessageRepo();
      const deleteSuccess = currentRepo.deleteMessage(messageId);
      if (!deleteSuccess) {
        return false;
      }

      // Update chain memory
      await this.updateChainMemory();

      logInfo(`[ChatManager] Successfully deleted message ${messageId}`);
      return true;
    } catch (error) {
      logInfo(`[ChatManager] Error deleting message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Add a display-only message (for AI responses)
   */
  addDisplayMessage(text: string, sender: string, id?: string): string {
    const currentRepo = this.getCurrentMessageRepo();
    const messageId = currentRepo.addDisplayOnlyMessage(text, sender, id);
    return messageId;
  }

  /**
   * Add a full message object
   */
  addFullMessage(message: ChatMessage): string {
    const currentRepo = this.getCurrentMessageRepo();
    const messageId = currentRepo.addFullMessage(message);
    return messageId;
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    const currentRepo = this.getCurrentMessageRepo();
    currentRepo.clear();
    // Clear chain memory directly
    this.chainManager.memoryManager.clearChatMemory();
    logInfo(`[ChatManager] Cleared all messages`);
  }

  /**
   * Truncate messages after a specific message ID
   */
  async truncateAfterMessageId(messageId: string): Promise<void> {
    const currentRepo = this.getCurrentMessageRepo();
    currentRepo.truncateAfterMessageId(messageId);

    // Update chain memory with the truncated messages
    await this.updateChainMemory();

    logInfo(`[ChatManager] Truncated messages after ${messageId}`);
  }

  /**
   * Get display messages for UI
   */
  getDisplayMessages(): ChatMessage[] {
    const currentRepo = this.getCurrentMessageRepo();
    return currentRepo.getDisplayMessages();
  }

  /**
   * Get LLM messages for AI communication
   */
  getLLMMessages(): ChatMessage[] {
    const currentRepo = this.getCurrentMessageRepo();
    return currentRepo.getLLMMessages();
  }

  /**
   * Get a specific message by ID (display version)
   */
  getMessage(id: string): ChatMessage | undefined {
    const currentRepo = this.getCurrentMessageRepo();
    return currentRepo.getMessage(id);
  }

  /**
   * Get a specific message for LLM processing
   */
  getLLMMessage(id: string): ChatMessage | undefined {
    const currentRepo = this.getCurrentMessageRepo();
    return currentRepo.getLLMMessage(id);
  }

  /**
   * Update chain memory with current LLM messages
   */
  private async updateChainMemory(): Promise<void> {
    try {
      const currentRepo = this.getCurrentMessageRepo();
      const llmMessages = currentRepo.getLLMMessages();
      await updateChatMemory(llmMessages, this.chainManager.memoryManager);
      logInfo(`[ChatManager] Updated chain memory with ${llmMessages.length} messages`);
    } catch (error) {
      logInfo(`[ChatManager] Error updating chain memory:`, error);
    }
  }

  /**
   * Load messages from saved chat
   */
  async loadMessages(messages: ChatMessage[]): Promise<void> {
    const currentRepo = this.getCurrentMessageRepo();
    currentRepo.clear();
    messages.forEach((msg) => {
      currentRepo.addFullMessage(msg);
    });

    // Update chain memory with loaded messages
    await this.updateChainMemory();

    logInfo(`[ChatManager] Loaded ${messages.length} messages`);
  }

  /**
   * Save current chat history
   */
  async saveChat(modelKey: string): Promise<void> {
    await this.persistenceManager.saveChat(modelKey);
  }

  /**
   * Get debug information
   */
  getDebugInfo() {
    const currentRepo = this.getCurrentMessageRepo();
    return {
      ...currentRepo.getDebugInfo(),
      currentProject: this.plugin.projectManager.getCurrentProjectId(),
      totalProjects: this.projectMessageRepos.size,
    };
  }

  /**
   * Force a project switch refresh
   * This ensures the UI gets the correct messages when switching projects
   */
  async handleProjectSwitch(): Promise<void> {
    const currentProjectId = this.plugin.projectManager.getCurrentProjectId();
    logInfo(`[ChatManager] Handling project switch to: ${currentProjectId}`);

    // Force detection of project change
    this.lastKnownProjectId = null; // Reset to force change detection
    const currentRepo = this.getCurrentMessageRepo();

    // Sync chain memory with the current project's messages
    await this.updateChainMemory();

    logInfo(
      `[ChatManager] Project switch complete. Messages: ${currentRepo.getDisplayMessages().length}`
    );
  }
}
