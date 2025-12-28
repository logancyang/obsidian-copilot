import { getSettings, getSystemPromptWithMemory } from "@/settings/model";
import { ChainType } from "@/chainFactory";
import { getCurrentProject } from "@/aiParams";
import { logInfo, logWarn } from "@/logger";
import { ChatMessage, MessageContext, WebTabContext } from "@/types/message";
import { FileParserManager } from "@/tools/FileParserManager";
import ChainManager from "@/LLMProviders/chainManager";
import ProjectManager from "@/LLMProviders/projectManager";
import { updateChatMemory } from "@/chatUtils";
import CopilotPlugin from "@/main";
import { ContextManager } from "./ContextManager";
import { MessageRepository } from "./MessageRepository";
import { ChatPersistenceManager } from "./ChatPersistenceManager";
import { ACTIVE_WEB_TAB_MARKER, USER_SENDER } from "@/constants";
import { TFile } from "obsidian";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import {
  normalizeUrlString,
  sanitizeWebTabContexts,
} from "@/utils/urlNormalization";

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
  private onMessageCreatedCallback?: (messageId: string) => void;

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
    this.persistenceManager = new ChatPersistenceManager(plugin.app, messageRepo, chainManager);
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
    this.persistenceManager = new ChatPersistenceManager(
      this.plugin.app,
      currentRepo,
      this.chainManager
    );

    return currentRepo;
  }

  /**
   * Set callback for when a message is created (before context processing)
   */
  setOnMessageCreatedCallback(callback: (messageId: string) => void): void {
    this.onMessageCreatedCallback = callback;
  }

  /**
   * Build system prompt for the current message, including project context if in project mode.
   *
   * @param chainType - The chain type being used
   * @returns System prompt with project context appended if applicable
   */
  private async getSystemPromptForMessage(chainType: ChainType): Promise<string> {
    const basePrompt = await getSystemPromptWithMemory(this.chainManager.userMemoryManager);

    // Special case: Add project context for project chain
    if (chainType === ChainType.PROJECT_CHAIN) {
      const project = getCurrentProject();
      if (project) {
        const context = await ProjectManager.instance.getProjectContext(project.id);
        let result = `${basePrompt}\n\n<project_system_prompt>\n${project.systemPrompt}\n</project_system_prompt>`;

        // Only add project_context block if context exists
        if (context) {
          result += `\n\n<project_context>\n${context}\n</project_context>`;
        }

        return result;
      }
    }

    return basePrompt;
  }

  /**
   * Build webTabs array with Active Web Tab snapshot injected.
   *
   * This implements snapshot semantics:
   * - Active Web Tab URL is resolved at message creation time
   * - The URL is stored in message.context.webTabs with isActive: true
   * - Edit/reprocess will use the stored URL, not the current active tab
   *
   * @param displayText - The message text (checked for ACTIVE_WEB_TAB_MARKER fallback)
   * @param existingWebTabs - Existing webTabs from context
   * @param includeActiveWebTab - Whether to include active web tab
   * @returns Updated webTabs array with active tab snapshot
   */
  private buildWebTabsWithActiveSnapshot(
    displayText: string,
    existingWebTabs: WebTabContext[],
    includeActiveWebTab: boolean
  ): WebTabContext[] {
    // Determine if we should include active web tab
    // Either explicitly requested or via marker in text
    const shouldInclude = includeActiveWebTab || displayText.includes(ACTIVE_WEB_TAB_MARKER);

    // Always sanitize existing webTabs (normalize URLs, dedupe, ensure single isActive)
    const sanitizedTabs = sanitizeWebTabContexts(existingWebTabs);

    if (!shouldInclude) {
      return sanitizedTabs;
    }

    try {
      // Get active web tab from WebViewerService
      // Use activeWebTabForMentions to match UI behavior:
      // - Preserved only when switching directly to chat panel
      // - Cleared when switching to other views (e.g., note tab)
      const service = getWebViewerService(this.plugin.app);
      const state = service.getActiveWebTabState();
      const activeTab = state.activeWebTabForMentions;

      const activeUrl = normalizeUrlString(activeTab?.url);
      if (!activeUrl) {
        // No active web tab available, return sanitized tabs unchanged
        return sanitizedTabs;
      }

      // Clear any existing isActive flags to ensure only one active tab
      const clearedTabs: WebTabContext[] = sanitizedTabs.map((tab) => {
        if (tab.isActive) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { isActive: _unused, ...rest } = tab;
          return rest;
        }
        return tab;
      });

      // Check if active URL already exists in the list
      const existingIndex = clearedTabs.findIndex(
        (tab) => normalizeUrlString(tab.url) === activeUrl
      );

      if (existingIndex >= 0) {
        // Merge metadata and mark as active
        const existing = clearedTabs[existingIndex];
        clearedTabs[existingIndex] = {
          ...existing,
          title: activeTab?.title ?? existing.title,
          faviconUrl: activeTab?.faviconUrl ?? existing.faviconUrl,
          isActive: true,
        };
        return clearedTabs;
      }

      // Add new active tab entry
      return [
        ...clearedTabs,
        {
          url: activeUrl,
          title: activeTab?.title,
          faviconUrl: activeTab?.faviconUrl,
          isActive: true,
        },
      ];
    } catch (error) {
      // Web Viewer not available (e.g., mobile platform) - don't fail the message
      logWarn("[ChatManager] Failed to resolve active web tab:", error);
      return sanitizedTabs;
    }
  }

  /**
   * Send a new message with context processing
   */
  async sendMessage(
    displayText: string,
    context: MessageContext,
    chainType: ChainType,
    includeActiveNote: boolean = false,
    includeActiveWebTab: boolean = false,
    content?: any[]
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

      // Inject Active Web Tab snapshot if requested (快照语义)
      // This resolves the active web tab URL at message creation time
      updatedContext.webTabs = this.buildWebTabsWithActiveSnapshot(
        displayText,
        updatedContext.webTabs || [],
        includeActiveWebTab
      );

      // Create the message with initial content
      const currentRepo = this.getCurrentMessageRepo();
      const messageId = currentRepo.addMessage(
        displayText,
        displayText, // Will be updated with processed content
        USER_SENDER,
        updatedContext,
        content
      );

      // Notify that message was created (for immediate UI update)
      if (this.onMessageCreatedCallback) {
        this.onMessageCreatedCallback(messageId);
      }

      // Get the message for context processing
      const message = currentRepo.getMessage(messageId);
      if (!message) {
        throw new Error(`Failed to retrieve message ${messageId}`);
      }

      // Get system prompt for L1 layer (includes project context if in project mode)
      const systemPrompt = await this.getSystemPromptForMessage(chainType);

      // Process context to generate LLM content
      const { processedContent, contextEnvelope } = await this.contextManager.processMessageContext(
        message,
        this.fileParserManager,
        this.plugin.app.vault,
        chainType,
        includeActiveNote,
        activeNote,
        currentRepo, // Pass MessageRepository for L2 building
        systemPrompt
      );

      // Update the processed content
      currentRepo.updateProcessedText(messageId, processedContent, contextEnvelope);

      logInfo(`[ChatManager] Successfully sent message ${messageId}`);
      return messageId;
    } catch (error) {
      logInfo(`[ChatManager] Error sending message:`, error);
      throw error;
    }
  }

  /**
   * Edit an existing message
   *
   * Design note: This method only updates the message text, not the context (notes/urls/webTabs/etc).
   * The original context is preserved because:
   * 1. Context represents the state at message creation time (which files/URLs were referenced)
   * 2. Allowing context modification would require complex UI for editing pills/references
   * 3. The reprocessMessageContext() call below re-fetches content using the ORIGINAL context,
   *    ensuring the LLM sees fresh content from the same sources
   */
  async editMessage(
    messageId: string,
    newText: string,
    chainType: ChainType,
    includeActiveNote: boolean = false
  ): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Editing message ${messageId}: "${newText}"`);

      // Edit the message text only - context remains unchanged (see design note above)
      const currentRepo = this.getCurrentMessageRepo();
      const editSuccess = currentRepo.editMessage(messageId, newText);
      if (!editSuccess) {
        return false;
      }

      // Reprocess context for the edited message
      const activeNote = this.plugin.app.workspace.getActiveFile();
      const systemPrompt = await this.getSystemPromptForMessage(chainType);
      await this.contextManager.reprocessMessageContext(
        messageId,
        currentRepo,
        this.fileParserManager,
        this.plugin.app.vault,
        chainType,
        includeActiveNote,
        activeNote,
        systemPrompt
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
    onAddMessage: (message: ChatMessage) => void,
    onTruncate?: () => void
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

      // Notify that truncation happened
      if (onTruncate) {
        onTruncate();
      }

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
   * Add a message
   */
  addMessage(message: ChatMessage): string {
    const currentRepo = this.getCurrentMessageRepo();
    const messageId = currentRepo.addMessage(message);
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
      currentRepo.addMessage(msg);
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

  /**
   * Load chat history from a file
   *
   * Design note: This method does NOT reprocess context (URLs/webTabs content fetching) for loaded messages.
   * This is intentional because:
   * 1. Historical messages represent a past conversation state - refetching would alter the original context
   * 2. URL content may have changed since the original conversation
   * 3. WebTabs are ephemeral - the tabs referenced in history are likely closed
   * 4. Performance - loading history should be fast, not trigger network requests
   *
   * The persisted chat only stores references (file paths, URLs) not the fetched content.
   * If the user wants fresh content, they should start a new conversation or regenerate specific messages.
   */
  async loadChatHistory(file: TFile): Promise<void> {
    // Clear current messages first
    this.clearMessages();

    // Load messages from file - only restores message text and context references (not fetched content)
    const messages = await this.persistenceManager.loadChat(file);

    // Add messages to the current repository
    const currentRepo = this.getCurrentMessageRepo();
    for (const message of messages) {
      currentRepo.addMessage(message);
    }

    // Update chain memory with loaded messages
    await this.updateChainMemory();

    logInfo(`[ChatManager] Loaded ${messages.length} messages from chat history`);
  }
}
