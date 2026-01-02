/**
 * DiscussChatState - State manager for Discuss conversations
 *
 * Manages:
 * - Current conversation (messages, metadata)
 * - Conversation persistence (auto-save)
 * - LLM streaming interaction
 * - Subscriber notifications
 */

import { AI_SENDER, USER_SENDER } from "@/constants";
import { ConversationPersistence } from "@/core/projects-plus/ConversationPersistence";
import { DiscussContextBuilder } from "@/core/projects-plus/DiscussContextBuilder";
import { ProjectManager } from "@/core/projects-plus/ProjectManager";
import ChainManager from "@/LLMProviders/chainManager";
import { ThinkBlockStreamer } from "@/LLMProviders/chainRunner/utils/ThinkBlockStreamer";
import { logError, logInfo, logWarn } from "@/logger";
import {
  buildConversationTitlePrompt,
  buildSuggestedQuestionsPrompt,
} from "@/prompts/discuss-system";
import { DiscussMessage, DiscussSource } from "@/types/discuss";
import { Project } from "@/types/projects-plus";
import { formatDateTime, withSuppressedTokenWarnings } from "@/utils";
import { App, TFile } from "obsidian";

/**
 * DiscussChatState - Manages state for a single Discuss conversation
 */
export class DiscussChatState {
  private listeners: Set<() => void> = new Set();
  private messages: DiscussMessage[] = [];
  private conversationId: string | null = null;
  private conversationTitle: string = "New Conversation";
  private isStreaming: boolean = false;
  private currentStreamContent: string = "";
  private abortController: AbortController | null = null;

  private persistence: ConversationPersistence;
  private contextBuilder: DiscussContextBuilder;

  constructor(
    private app: App,
    private project: Project,
    private chainManager: ChainManager,
    private projectManager?: ProjectManager
  ) {
    this.persistence = new ConversationPersistence(app);
    this.contextBuilder = new DiscussContextBuilder(app, app.vault);
  }

  // ================================
  // SUBSCRIPTION
  // ================================

  /**
   * Subscribe to state changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        logError("[DiscussChatState] Error in listener:", error);
      }
    });
  }

  // ================================
  // GETTERS
  // ================================

  getMessages(): DiscussMessage[] {
    return [...this.messages];
  }

  getConversationId(): string | null {
    return this.conversationId;
  }

  getConversationTitle(): string {
    return this.conversationTitle;
  }

  isCurrentlyStreaming(): boolean {
    return this.isStreaming;
  }

  getStreamContent(): string {
    return this.currentStreamContent;
  }

  getProject(): Project {
    return this.project;
  }

  // ================================
  // MESSAGE OPERATIONS
  // ================================

  /**
   * Send a message and get AI response
   */
  async sendMessage(displayText: string, forcedNotes: TFile[] = []): Promise<void> {
    if (!displayText.trim()) return;

    // Generate conversation ID if new conversation
    if (!this.conversationId) {
      this.conversationId = this.persistence.generateConversationId();
    }

    // 1. Add user message
    const userMessage: DiscussMessage = {
      message: displayText,
      sender: USER_SENDER,
      isVisible: true,
      timestamp: formatDateTime(new Date()),
    };
    this.messages.push(userMessage);
    this.notifyListeners();

    // 2. Build context
    const context = await this.contextBuilder.buildContext({
      project: this.project,
      userMessage: displayText,
      forcedNotes,
    });

    // 3. Stream AI response
    this.isStreaming = true;
    this.currentStreamContent = "";
    this.abortController = new AbortController();
    this.notifyListeners();

    try {
      const response = await this.streamResponse(displayText, context);

      // 4. Add AI message
      const aiMessage: DiscussMessage = {
        message: response.content,
        sender: AI_SENDER,
        isVisible: true,
        timestamp: formatDateTime(new Date()),
        discussSources: response.sources,
      };
      this.messages.push(aiMessage);

      // 5. Auto-save conversation
      await this.saveConversation();

      // 6. Generate title if first exchange
      if (this.messages.length === 2 && this.conversationTitle === "New Conversation") {
        this.generateTitle(displayText, response.content).catch((error) => {
          logWarn("[DiscussChatState] Failed to generate title:", error);
        });
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        logInfo("[DiscussChatState] Response aborted by user");
      } else {
        logError("[DiscussChatState] Error streaming response:", error);

        // Add error message
        const errorMessage: DiscussMessage = {
          message: `Error: ${(error as Error).message || "Failed to get response"}`,
          sender: AI_SENDER,
          isVisible: true,
          timestamp: formatDateTime(new Date()),
          isErrorMessage: true,
        };
        this.messages.push(errorMessage);
      }
    } finally {
      this.isStreaming = false;
      this.currentStreamContent = "";
      this.abortController = null;
      this.notifyListeners();
    }
  }

  /**
   * Stream response from LLM
   */
  private async streamResponse(
    userText: string,
    context: { systemPrompt: string; noteContents: string; notes: TFile[] }
  ): Promise<{ content: string; sources: DiscussSource[] }> {
    const chatModel = this.chainManager.chatModelManager.getChatModel();

    // Build messages array
    const messages: { role: string; content: string }[] = [];

    // System message with project context
    let systemContent = context.systemPrompt;
    if (context.noteContents) {
      systemContent += `\n\n## Project Notes\n\n${context.noteContents}`;
    }
    messages.push({ role: "system", content: systemContent });

    // Add conversation history (excluding the just-added user message)
    for (let i = 0; i < this.messages.length - 1; i++) {
      const msg = this.messages[i];
      messages.push({
        role: msg.sender === USER_SENDER ? "user" : "assistant",
        content: msg.message,
      });
    }

    // Current user message
    messages.push({ role: "user", content: userText });

    // Stream response
    const streamer = new ThinkBlockStreamer((content: string) => {
      this.currentStreamContent = content;
      this.notifyListeners();
    });

    const chatStream = await withSuppressedTokenWarnings(() =>
      chatModel.stream(messages, {
        signal: this.abortController?.signal,
      })
    );

    for await (const chunk of chatStream) {
      if (this.abortController?.signal.aborted) {
        break;
      }
      streamer.processChunk(chunk);
    }

    const result = streamer.close();

    // Extract sources from context notes
    const sources: DiscussSource[] = context.notes.map((note) => ({
      path: note.path,
      title: note.basename,
      exists: true,
    }));

    return {
      content: result.content,
      sources,
    };
  }

  /**
   * Abort current streaming response
   */
  abortResponse(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // ================================
  // CONVERSATION MANAGEMENT
  // ================================

  /**
   * Start a new conversation
   */
  async startNewConversation(): Promise<void> {
    this.messages = [];
    this.conversationId = this.persistence.generateConversationId();
    this.conversationTitle = "New Conversation";
    this.isStreaming = false;
    this.currentStreamContent = "";
    this.notifyListeners();
  }

  /**
   * Load an existing conversation
   */
  async loadConversation(conversationId: string): Promise<void> {
    const result = await this.persistence.loadConversation(this.project, conversationId);

    if (!result) {
      throw new Error("Conversation not found");
    }

    // Validate note sources still exist
    for (const message of result.messages) {
      if (message.discussSources) {
        for (const source of message.discussSources) {
          const file = this.app.vault.getAbstractFileByPath(source.path);
          source.exists = file instanceof TFile;
        }
      }
    }

    this.messages = result.messages;
    this.conversationId = conversationId;
    this.conversationTitle = result.metadata.title;
    this.notifyListeners();
  }

  /**
   * Save current conversation to disk and update project reference
   */
  async saveConversation(): Promise<void> {
    if (!this.conversationId) return;

    await this.persistence.saveConversation(
      this.project,
      this.conversationId,
      this.conversationTitle,
      this.messages
    );

    // Update conversation reference in project
    if (this.projectManager) {
      await this.projectManager.updateConversationRef(
        this.project.id,
        this.conversationId,
        this.conversationTitle,
        this.messages.length
      );
    }
  }

  // ================================
  // TITLE MANAGEMENT
  // ================================

  /**
   * Generate title from first exchange
   */
  async generateTitle(userMessage: string, assistantMessage: string): Promise<string> {
    try {
      const chatModel = this.chainManager.chatModelManager.getChatModel();
      const prompt = buildConversationTitlePrompt(userMessage, assistantMessage);

      const response = await chatModel.invoke([{ role: "user", content: prompt }]);

      const title =
        typeof response.content === "string" ? response.content.trim() : "New Conversation";

      // Clean up title (remove quotes, limit length)
      const cleanTitle = title.replace(/^["']|["']$/g, "").slice(0, 100);

      this.conversationTitle = cleanTitle;
      await this.saveConversation();
      this.notifyListeners();

      return cleanTitle;
    } catch (error) {
      logWarn("[DiscussChatState] Failed to generate title:", error);
      return this.conversationTitle;
    }
  }

  /**
   * Manually set conversation title
   */
  setTitle(title: string): void {
    this.conversationTitle = title;
    this.saveConversation().catch((error) => {
      logWarn("[DiscussChatState] Failed to save after title change:", error);
    });
    this.notifyListeners();
  }

  // ================================
  // SUGGESTED QUESTIONS
  // ================================

  /**
   * Generate suggested questions for a new conversation
   */
  async generateSuggestedQuestions(): Promise<string[]> {
    try {
      // Get project notes for summary
      const projectNotes = this.project.notes
        .slice(0, 5)
        .map((n) => this.app.vault.getAbstractFileByPath(n.path))
        .filter((f): f is TFile => f instanceof TFile);

      const notesSummary = await this.contextBuilder.buildNotesSummary(projectNotes);

      const prompt = buildSuggestedQuestionsPrompt({
        projectTitle: this.project.title,
        projectDescription: this.project.description,
        successCriteria: this.project.successCriteria,
        notesSummary,
      });

      const chatModel = this.chainManager.chatModelManager.getChatModel();
      const response = await chatModel.invoke([{ role: "user", content: prompt }]);

      const content = typeof response.content === "string" ? response.content.trim() : "";

      // Parse JSON array
      try {
        const questions = JSON.parse(content);
        if (Array.isArray(questions)) {
          return questions.slice(0, 4);
        }
      } catch {
        logWarn("[DiscussChatState] Failed to parse suggested questions JSON");
      }

      return [];
    } catch (error) {
      logWarn("[DiscussChatState] Failed to generate suggested questions:", error);
      return [];
    }
  }
}
