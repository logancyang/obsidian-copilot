import { getSelectedTextContexts } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { processPrompt } from "@/commands/customCommandUtils";
import { ContextProcessor } from "@/contextProcessor";
import { logInfo } from "@/logger";
import { Mention } from "@/mentions/Mention";
import { FileParserManager } from "@/tools/FileParserManager";
import { ChatMessage, MessageContext } from "@/types/message";
import { extractNoteFiles, getNotesFromTags } from "@/utils";
import { TFile, Vault } from "obsidian";
import { MessageRepository } from "./MessageRepository";

/**
 * ContextManager - Handles all context processing business logic
 *
 * Key responsibilities:
 * - Process context for individual messages
 * - Reprocess context when files change or messages are edited
 * - Ensure context is always fresh and up-to-date
 * - Handle different types of context (notes, URLs, selected text)
 */
export class ContextManager {
  private static instance: ContextManager;
  private contextProcessor: ContextProcessor;
  private mention: Mention;

  private constructor() {
    this.contextProcessor = ContextProcessor.getInstance();
    this.mention = Mention.getInstance();
  }

  static getInstance(): ContextManager {
    if (!ContextManager.instance) {
      ContextManager.instance = new ContextManager();
    }
    return ContextManager.instance;
  }

  /**
   * Process context for a single message
   * This generates fresh context content from current file states
   */
  async processMessageContext(
    message: ChatMessage,
    fileParserManager: FileParserManager,
    vault: Vault,
    chainType: ChainType,
    includeActiveNote: boolean,
    activeNote: TFile | null
  ): Promise<string> {
    try {
      logInfo(`[ContextManager] Processing context for message ${message.id}`);

      const processedMessage = message.originalMessage || message.message;

      // 1. Process custom prompts first
      const { processedPrompt: processedUserMessage, includedFiles } = await processPrompt(
        processedMessage,
        "",
        vault,
        activeNote
      );

      // 2. Extract URLs and process them (for Copilot Plus chain)
      // Process URLs from context (only URLs explicitly added to context via URL pills)
      // This ensures url4llm is only called for URLs that appear in the context menu,
      // not for all URLs found in the message text.
      const contextUrls = message.context?.urls || [];
      const urlContextAddition =
        chainType === ChainType.COPILOT_PLUS_CHAIN
          ? await this.mention.processUrlList(contextUrls)
          : { urlContext: "", imageUrls: [] };

      // 3. Process context notes
      const excludedNotePaths = new Set(includedFiles.map((file) => file.path));
      const contextNotes = message.context?.notes || [];

      // Add active note if requested and not already included
      const notes = [...contextNotes];
      if (
        includeActiveNote &&
        chainType !== ChainType.PROJECT_CHAIN &&
        activeNote &&
        !notes.some((note) => note.path === activeNote.path)
      ) {
        notes.push(activeNote);
      }

      const noteContextAddition = await this.contextProcessor.processContextNotes(
        excludedNotePaths,
        fileParserManager,
        vault,
        notes,
        includeActiveNote,
        activeNote,
        chainType
      );

      // 4. Process context tags
      const contextTags = message.context?.tags || [];
      let tagContextAddition = "";

      if (contextTags.length > 0) {
        // Get all notes that have any of the specified tags (in frontmatter)
        const taggedNotes = getNotesFromTags(vault, contextTags);

        // Filter out already processed notes to avoid duplication
        const filteredTaggedNotes = taggedNotes.filter(
          (note) => !excludedNotePaths.has(note.path) && !notes.some((n) => n.path === note.path)
        );

        if (filteredTaggedNotes.length > 0) {
          tagContextAddition = await this.contextProcessor.processContextNotes(
            new Set(), // Don't exclude any notes since we already filtered
            fileParserManager,
            vault,
            filteredTaggedNotes,
            false, // Don't include active note again
            null,
            chainType
          );
        }
      }

      // 5. Process selected text contexts
      const selectedTextContextAddition = this.contextProcessor.processSelectedTextContexts();

      // 6. Combine everything
      const finalProcessedMessage =
        processedUserMessage +
        urlContextAddition.urlContext +
        noteContextAddition +
        tagContextAddition +
        selectedTextContextAddition;

      logInfo(`[ContextManager] Successfully processed context for message ${message.id}`);
      return finalProcessedMessage;
    } catch (error) {
      logInfo(`[ContextManager] Error processing context for message ${message.id}:`, error);
      return message.originalMessage || message.message; // Return original on error
    }
  }

  /**
   * Reprocess context for a specific message
   * This ensures edited messages get fresh context
   */
  async reprocessMessageContext(
    messageId: string,
    messageRepo: MessageRepository,
    fileParserManager: FileParserManager,
    vault: Vault,
    chainType: ChainType,
    includeActiveNote: boolean,
    activeNote: TFile | null
  ): Promise<void> {
    const message = messageRepo.getMessage(messageId);

    if (!message || message.sender !== "user" || !message.id) {
      return;
    }

    logInfo(`[ContextManager] Reprocessing context for message ${messageId}`);

    const processedContent = await this.processMessageContext(
      message,
      fileParserManager,
      vault,
      chainType,
      includeActiveNote,
      activeNote
    );

    messageRepo.updateProcessedText(message.id, processedContent);
    logInfo(`[ContextManager] Completed context reprocessing for message ${messageId}`);
  }

  /**
   * Create message context from various sources
   */
  createMessageContext(
    contextNotes: TFile[],
    contextUrls: string[],
    selectedTextContexts = getSelectedTextContexts()
  ): MessageContext {
    return {
      notes: contextNotes,
      urls: contextUrls,
      selectedTextContexts,
    };
  }

  /**
   * Extract note files from various sources
   */
  async extractContextNotes(
    content: string,
    vault: Vault,
    additionalNotes: TFile[] = []
  ): Promise<TFile[]> {
    const extractedNotes = await extractNoteFiles(content, vault);

    // Combine and deduplicate
    const allNotes = [...extractedNotes, ...additionalNotes];
    const uniqueNotes = allNotes.filter(
      (note, index, array) => array.findIndex((n) => n.path === note.path) === index
    );

    return uniqueNotes;
  }

  /**
   * Check if a message needs context reprocessing
   */
  needsContextReprocessing(message: ChatMessage): boolean {
    return message.needsContextReprocessing === true;
  }

  /**
   * Get all selected text contexts
   */
  getSelectedTextContexts() {
    return getSelectedTextContexts();
  }
}
