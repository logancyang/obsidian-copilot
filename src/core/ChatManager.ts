import { getSettings } from "@/settings/model";
import {
  getEffectiveUserPrompt,
  getSystemPrompt,
  getSystemPromptWithMemory,
} from "@/system-prompts/systemPromptBuilder";
import { ChainType } from "@/chainType";
import { getChainType } from "@/aiParams";
import { logError, logInfo, logWarn } from "@/logger";
import { ChatMessage, MessageContext } from "@/types/message";
import { processPrompt, type ProcessedPromptResult } from "@/commands/customCommandUtils";
import { resolveCustomCommandPrefix } from "@/commands/resolveCustomCommandPrefix";
import { getCachedCustomCommands } from "@/commands/state";
import { FileParserManager } from "@/tools/FileParserManager";
import ChainManager from "@/LLMProviders/chainManager";
import { updateChatMemory } from "@/chatUtils";
import CopilotPlugin from "@/main";
import { ContextManager } from "./ContextManager";
import { MessageRepository } from "./MessageRepository";
import { ChatPersistenceManager } from "./ChatPersistenceManager";
import { ACTIVE_WEB_TAB_MARKER, USER_SENDER } from "@/constants";
import { MessageContent } from "@/imageProcessing/imageProcessor";
import { TFile, Vault } from "obsidian";
import { buildWebTabsWithActiveSnapshot } from "@/services/webViewerService/activeWebTabSnapshot";

export class ChatManager {
  private chatSource: { path: string } | null = null;
  private conversationGeneration = 0;
  private contextManager: ContextManager;
  private persistenceManager: ChatPersistenceManager;
  private onMessageCreatedCallback?: (messageId: string) => void;

  constructor(
    private messageRepo: MessageRepository,
    private chainManager: ChainManager,
    private fileParserManager: FileParserManager,
    private plugin: CopilotPlugin
  ) {
    this.contextManager = ContextManager.getInstance();
    this.persistenceManager = new ChatPersistenceManager(plugin.app, messageRepo, chainManager);
  }

  setOnMessageCreatedCallback(callback: (messageId: string) => void): void {
    this.onMessageCreatedCallback = callback;
  }

  private async processSystemPromptTemplates(
    prompt: string,
    vault: Vault,
    activeNote: TFile | null
  ): Promise<ProcessedPromptResult> {
    if (!prompt.includes("{") || !prompt.includes("}")) {
      return { processedPrompt: prompt, includedFiles: [] };
    }

    const settings = getSettings();
    if (!settings.enableCustomPromptTemplating) {
      return { processedPrompt: prompt, includedFiles: [] };
    }

    try {
      const result = await processPrompt(this.plugin.app, prompt, "", vault, activeNote, true);

      return {
        processedPrompt: result.processedPrompt.trimEnd(),
        includedFiles: result.includedFiles,
      };
    } catch (error) {
      logWarn("[ChatManager] Error processing system prompt templates:", error);
      return { processedPrompt: prompt, includedFiles: [] };
    }
  }

  private injectProcessedUserCustomPromptIntoSystemPrompt(params: {
    systemPromptWithoutMemory: string;
    userCustomPrompt: string;
    processedUserCustomPrompt: string;
  }): string {
    const { systemPromptWithoutMemory, userCustomPrompt, processedUserCustomPrompt } = params;

    const userInstructionsBlockRegex =
      /<user_custom_instructions>\n[\s\S]*?\n<\/user_custom_instructions>/;

    if (userInstructionsBlockRegex.test(systemPromptWithoutMemory)) {
      return systemPromptWithoutMemory.replace(
        userInstructionsBlockRegex,
        () =>
          `<user_custom_instructions>\n${processedUserCustomPrompt}\n</user_custom_instructions>`
      );
    }

    if (systemPromptWithoutMemory === userCustomPrompt) {
      return processedUserCustomPrompt;
    }

    logInfo(
      "[ChatManager] Could not locate <user_custom_instructions> block for injection; returning original system prompt."
    );
    return systemPromptWithoutMemory;
  }

  private replaceSystemPromptWithoutMemoryInBasePrompt(params: {
    basePromptWithMemory: string;
    systemPromptWithoutMemory: string;
    processedSystemPromptWithoutMemory: string;
  }): string {
    const { basePromptWithMemory, systemPromptWithoutMemory, processedSystemPromptWithoutMemory } =
      params;

    if (!basePromptWithMemory.endsWith(systemPromptWithoutMemory)) {
      logInfo(
        "[ChatManager] basePromptWithMemory does not end with systemPromptWithoutMemory; returning original base prompt."
      );
      return basePromptWithMemory;
    }

    const prefix = basePromptWithMemory.slice(
      0,
      basePromptWithMemory.length - systemPromptWithoutMemory.length
    );
    return `${prefix}${processedSystemPromptWithoutMemory}`;
  }

  private async getSystemPromptForMessage(
    vault: Vault,
    activeNote: TFile | null
  ): Promise<ProcessedPromptResult> {
    // Keep one instruction snapshot across memory composition and template expansion.
    // https://github.com/logancyang/obsidian-copilot/issues/3210
    const userCustomPrompt = await getEffectiveUserPrompt(this.plugin.app);
    const allIncludedFiles: TFile[] = [];

    const basePromptWithMemory = await getSystemPromptWithMemory(
      this.chainManager.userMemoryManager,
      userCustomPrompt
    );
    const systemPromptWithoutMemory = getSystemPrompt(userCustomPrompt);

    let processedBasePromptWithMemory = basePromptWithMemory;

    if (userCustomPrompt) {
      const userPromptResult = await this.processSystemPromptTemplates(
        userCustomPrompt,
        vault,
        activeNote
      );

      const processedSystemPromptWithoutMemory =
        this.injectProcessedUserCustomPromptIntoSystemPrompt({
          systemPromptWithoutMemory,
          userCustomPrompt,
          processedUserCustomPrompt: userPromptResult.processedPrompt,
        });

      const nextProcessedBasePromptWithMemory = this.replaceSystemPromptWithoutMemoryInBasePrompt({
        basePromptWithMemory,
        systemPromptWithoutMemory,
        processedSystemPromptWithoutMemory,
      });

      if (nextProcessedBasePromptWithMemory !== basePromptWithMemory) {
        allIncludedFiles.push(...userPromptResult.includedFiles);
      }

      processedBasePromptWithMemory = nextProcessedBasePromptWithMemory;
    }

    return {
      processedPrompt: processedBasePromptWithMemory,
      includedFiles: allIncludedFiles,
    };
  }

  async sendMessage(
    displayText: string,
    context: MessageContext,
    chainType: ChainType,
    includeActiveNote: boolean = false,
    includeActiveWebTab: boolean = false,
    content?: MessageContent[],
    updateLoadingMessage?: (message: string) => void
  ): Promise<string> {
    try {
      logInfo(`[ChatManager] Sending message: "${displayText}"`);

      const activeNote = this.plugin.app.workspace.getActiveFile();

      // The slash menu leaves an alias in the composer; expand it so Quick Chat sends the same full prompt as Agent Chat.
      // https://github.com/logancyang/obsidian-copilot/issues/2960#issuecomment-5445353610
      const messageText = resolveCustomCommandPrefix(displayText, getCachedCustomCommands()).text;

      const updatedContext = { ...context };
      if (includeActiveNote && activeNote) {
        const existingNotes = context.notes || [];
        const hasActiveNote = existingNotes.some((note) => note.path === activeNote.path);
        updatedContext.notes = hasActiveNote ? existingNotes : [...existingNotes, activeNote];
      }

      const shouldIncludeActiveWebTab =
        includeActiveWebTab || messageText.includes(ACTIVE_WEB_TAB_MARKER);
      updatedContext.webTabs = buildWebTabsWithActiveSnapshot(
        this.plugin.app,
        updatedContext.webTabs || [],
        shouldIncludeActiveWebTab
      );

      const messageId = this.messageRepo.addMessage(
        messageText,
        messageText,
        USER_SENDER,
        updatedContext,
        content
      );

      if (this.onMessageCreatedCallback) {
        this.onMessageCreatedCallback(messageId);
      }

      const message = this.messageRepo.getMessage(messageId);
      if (!message) {
        throw new Error(`Failed to retrieve message ${messageId}`);
      }

      const { processedPrompt: systemPrompt, includedFiles: systemPromptIncludedFiles } =
        await this.getSystemPromptForMessage(this.plugin.app.vault, activeNote);

      const { processedContent, contextEnvelope } = await this.contextManager.processMessageContext(
        this.plugin.app,
        message,
        this.fileParserManager,
        this.plugin.app.vault,
        chainType,
        includeActiveNote,
        activeNote,
        this.messageRepo,
        systemPrompt,
        systemPromptIncludedFiles,
        updateLoadingMessage
      );

      this.messageRepo.updateProcessedText(messageId, processedContent, contextEnvelope);

      logInfo(`[ChatManager] Successfully sent message ${messageId}`);
      return messageId;
    } catch (error) {
      logInfo(`[ChatManager] Error sending message:`, error);
      throw error;
    }
  }

  async editMessage(
    messageId: string,
    newText: string,
    chainType: ChainType,
    includeActiveNote: boolean = false
  ): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Editing message ${messageId}: "${newText}"`);

      const editSuccess = this.messageRepo.editMessage(messageId, newText);
      if (!editSuccess) {
        return false;
      }

      const activeNote = this.plugin.app.workspace.getActiveFile();
      const { processedPrompt: systemPrompt, includedFiles: systemPromptIncludedFiles } =
        await this.getSystemPromptForMessage(this.plugin.app.vault, activeNote);
      await this.contextManager.reprocessMessageContext(
        this.plugin.app,
        messageId,
        this.messageRepo,
        this.fileParserManager,
        this.plugin.app.vault,
        chainType,
        includeActiveNote,
        activeNote,
        systemPrompt,
        systemPromptIncludedFiles
      );

      await this.updateChainMemory();

      logInfo(`[ChatManager] Successfully edited message ${messageId}`);
      return true;
    } catch (error) {
      logInfo(`[ChatManager] Error editing message ${messageId}:`, error);
      return false;
    }
  }

  async regenerateMessage(
    messageId: string,
    onUpdateCurrentMessage: (message: string) => void,
    onAddMessage: (message: ChatMessage) => void,
    onTruncate?: () => void
  ): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Regenerating message ${messageId}`);

      const message = this.messageRepo.getMessage(messageId);
      if (!message) {
        logInfo(`[ChatManager] Message not found: ${messageId}`);
        return false;
      }

      const displayMessages = this.messageRepo.getDisplayMessages();
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

      this.messageRepo.truncateAfter(messageIndex - 1);

      if (onTruncate) {
        onTruncate();
      }

      await this.updateChainMemory();

      if (!userMessage.id) {
        logInfo(`[ChatManager] User message has no ID for regeneration`);
        return false;
      }

      let llmMessage = this.messageRepo.getLLMMessage(userMessage.id);
      if (!llmMessage) {
        logInfo(`[ChatManager] LLM message not found for regeneration`);
        return false;
      }

      // Fresh instructions can change template-note dedup, so retries rebuild context even when an envelope exists.
      // https://github.com/logancyang/obsidian-copilot/issues/3210
      const chainType = getChainType();
      const activeNote = this.plugin.app.workspace.getActiveFile();
      const { processedPrompt: systemPrompt, includedFiles: systemPromptIncludedFiles } =
        await this.getSystemPromptForMessage(this.plugin.app.vault, activeNote);
      await this.contextManager.reprocessMessageContext(
        this.plugin.app,
        userMessage.id,
        this.messageRepo,
        this.fileParserManager,
        this.plugin.app.vault,
        chainType,
        false,
        activeNote,
        systemPrompt,
        systemPromptIncludedFiles
      );
      llmMessage = this.messageRepo.getLLMMessage(userMessage.id)!;
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

  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      logInfo(`[ChatManager] Deleting message ${messageId}`);

      const deleteSuccess = this.messageRepo.deleteMessage(messageId);
      if (!deleteSuccess) {
        return false;
      }

      await this.updateChainMemory();

      logInfo(`[ChatManager] Successfully deleted message ${messageId}`);
      return true;
    } catch (error) {
      logInfo(`[ChatManager] Error deleting message ${messageId}:`, error);
      return false;
    }
  }

  addMessage(message: ChatMessage): string {
    const messageId = this.messageRepo.addMessage(message);
    return messageId;
  }

  clearMessages(): void {
    this.chatSource = null;
    this.conversationGeneration++;
    this.messageRepo.clear();
    void this.chainManager.memoryManager
      .clearChatMemory()
      .catch((err) => logError("clearChatMemory failed", err));
    logInfo(`[ChatManager] Cleared all messages`);
  }

  async truncateAfterMessageId(messageId: string): Promise<void> {
    this.messageRepo.truncateAfterMessageId(messageId);

    await this.updateChainMemory();

    logInfo(`[ChatManager] Truncated messages after ${messageId}`);
  }

  getDisplayMessages(): ChatMessage[] {
    return this.messageRepo.getDisplayMessages();
  }

  getLLMMessages(): ChatMessage[] {
    return this.messageRepo.getLLMMessages();
  }

  getMessage(id: string): ChatMessage | undefined {
    return this.messageRepo.getMessage(id);
  }

  getLLMMessage(id: string): ChatMessage | undefined {
    return this.messageRepo.getLLMMessage(id);
  }

  private async updateChainMemory(): Promise<void> {
    try {
      const llmMessages = this.messageRepo.getLLMMessages();
      await updateChatMemory(llmMessages, this.chainManager.memoryManager);
      logInfo(`[ChatManager] Updated chain memory with ${llmMessages.length} messages`);
    } catch (error) {
      logInfo(`[ChatManager] Error updating chain memory:`, error);
    }
  }

  async loadMessages(messages: ChatMessage[]): Promise<void> {
    this.chatSource = null;
    this.conversationGeneration++;
    this.messageRepo.clear();
    messages.forEach((msg) => {
      this.messageRepo.addMessage(msg);
    });

    await this.updateChainMemory();

    logInfo(`[ChatManager] Loaded ${messages.length} messages`);
  }

  async saveChat(modelKey: string): Promise<void> {
    const generation = this.conversationGeneration;
    const source = await this.persistenceManager.saveChat(modelKey);
    // An older save must not change link resolution after another chat starts or reopens.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/539
    if (source && generation === this.conversationGeneration) this.chatSource = source;
  }

  getSourcePath(): string {
    return this.chatSource?.path ?? "";
  }

  getDebugInfo() {
    return this.messageRepo.getDebugInfo();
  }

  async loadChatHistory(file: TFile): Promise<void> {
    this.clearMessages();

    const messages = await this.persistenceManager.loadChat(file);
    this.chatSource = file;

    for (const message of messages) {
      this.messageRepo.addMessage(message);
    }

    await this.updateChainMemory();

    logInfo(`[ChatManager] Loaded ${messages.length} messages from chat history`);
  }
}
