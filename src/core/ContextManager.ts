import { getSelectedTextContexts } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { processPrompt } from "@/commands/customCommandUtils";
import { PromptContextEngine } from "@/context/PromptContextEngine";
import {
  PromptContextEnvelope,
  PromptLayerId,
  PromptLayerSegment,
} from "@/context/PromptContextTypes";
import { ContextProcessor } from "@/contextProcessor";
import { logInfo } from "@/logger";
import { Mention } from "@/mentions/Mention";
import { FileParserManager } from "@/tools/FileParserManager";
import { ChatMessage, MessageContext } from "@/types/message";
import { extractNoteFiles, getNotesFromTags, getNotesFromPath } from "@/utils";
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
  private promptContextEngine: PromptContextEngine;

  private constructor() {
    this.contextProcessor = ContextProcessor.getInstance();
    this.mention = Mention.getInstance();
    this.promptContextEngine = PromptContextEngine.getInstance();
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
    activeNote: TFile | null,
    messageRepo: MessageRepository,
    systemPrompt?: string
  ): Promise<ContextProcessingResult> {
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

      // 2. Build L2 context from previous turns (for cache stability)
      // Pass current message context for deduplication (L3 takes priority over L2)
      const l2Context = await this.buildL2ContextFromPreviousTurns(
        message.id!,
        messageRepo,
        fileParserManager,
        vault,
        chainType,
        message.context
      );

      // 3. Extract URLs and process them (for Copilot Plus chain)
      // Process URLs from context (only URLs explicitly added to context via URL pills)
      // This ensures url4llm is only called for URLs that appear in the context menu,
      // not for all URLs found in the message text.
      const contextUrls = message.context?.urls || [];
      const urlContextAddition =
        chainType === ChainType.COPILOT_PLUS_CHAIN
          ? await this.mention.processUrlList(contextUrls)
          : { urlContext: "", imageUrls: [] };

      // 4. Process context notes (L3 - current turn only)
      // Initialize tracking set with files already included from custom prompts
      const processedNotePaths = new Set(includedFiles.map((file) => file.path));
      const contextNotes = message.context?.notes || [];

      // Add active note if requested and not already included
      const notes = [...contextNotes];
      if (
        includeActiveNote &&
        chainType !== ChainType.PROJECT_CHAIN &&
        activeNote &&
        !processedNotePaths.has(activeNote.path) &&
        !notes.some((note) => note.path === activeNote.path)
      ) {
        notes.push(activeNote);
      }

      const noteContextAddition = await this.contextProcessor.processContextNotes(
        processedNotePaths,
        fileParserManager,
        vault,
        notes,
        includeActiveNote,
        activeNote,
        chainType
      );

      // Add processed context notes to tracking set
      notes.forEach((note) => processedNotePaths.add(note.path));

      // 5. Process context tags
      const contextTags = message.context?.tags || [];
      let tagContextAddition = "";

      if (contextTags.length > 0) {
        // Get all notes that have any of the specified tags (in frontmatter)
        const taggedNotes = getNotesFromTags(vault, contextTags);

        // Filter out already processed notes to avoid duplication
        const filteredTaggedNotes = taggedNotes.filter(
          (note) => !processedNotePaths.has(note.path)
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

          // Add processed tagged notes to tracking set
          filteredTaggedNotes.forEach((note) => processedNotePaths.add(note.path));
        }
      }

      // 6. Process context folders
      const contextFolders = message.context?.folders || [];
      let folderContextAddition = "";

      if (contextFolders.length > 0) {
        // Get all notes from the specified folders
        const folderNotes = contextFolders.flatMap((folder) => getNotesFromPath(vault, folder));

        // Filter out already processed notes to avoid duplication
        const filteredFolderNotes = folderNotes.filter(
          (note) => !processedNotePaths.has(note.path)
        );

        if (filteredFolderNotes.length > 0) {
          folderContextAddition = await this.contextProcessor.processContextNotes(
            new Set(), // Don't exclude any notes since we already filtered
            fileParserManager,
            vault,
            filteredFolderNotes,
            false, // Don't include active note again
            null,
            chainType
          );

          // Add processed folder notes to tracking set
          filteredFolderNotes.forEach((note) => processedNotePaths.add(note.path));
        }
      }

      // 7. Process selected text contexts
      const selectedTextContextAddition = this.contextProcessor.processSelectedTextContexts();

      // 8. Combine everything (L2 previous context, then L3 current turn context)
      const finalProcessedMessage =
        processedUserMessage +
        l2Context +
        noteContextAddition +
        tagContextAddition +
        folderContextAddition +
        urlContextAddition.urlContext +
        selectedTextContextAddition;

      logInfo(`[ContextManager] Successfully processed context for message ${message.id}`);
      const contextEnvelope = this.buildPromptContextEnvelope({
        chainType,
        message,
        systemPrompt: systemPrompt || "",
        processedUserMessage,
        l2PreviousContext: l2Context,
        noteContextAddition,
        tagContextAddition,
        folderContextAddition,
        urlContext: urlContextAddition.urlContext,
        selectedText: selectedTextContextAddition,
      });

      return {
        processedContent: finalProcessedMessage,
        contextEnvelope,
      };
    } catch (error) {
      logInfo(`[ContextManager] Error processing context for message ${message.id}:`, error);
      return {
        processedContent: message.originalMessage || message.message,
        contextEnvelope: undefined,
      };
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
    activeNote: TFile | null,
    systemPrompt?: string
  ): Promise<void> {
    const message = messageRepo.getMessage(messageId);

    if (!message || message.sender !== "user" || !message.id) {
      return;
    }

    logInfo(`[ContextManager] Reprocessing context for message ${messageId}`);

    const { processedContent, contextEnvelope } = await this.processMessageContext(
      message,
      fileParserManager,
      vault,
      chainType,
      includeActiveNote,
      activeNote,
      messageRepo, // Use same repo for L2 building
      systemPrompt
    );

    messageRepo.updateProcessedText(message.id, processedContent, contextEnvelope);
    logInfo(`[ContextManager] Completed context reprocessing for message ${messageId}`);
  }

  /**
   * Build L2 context from previous turns in the conversation.
   * Collects all context from messages before the current one.
   *
   * @param currentMessageId - ID of the current message (exclude from L2)
   * @param messageRepo - Repository containing message history
   * @param fileParserManager - For processing notes
   * @param vault - For accessing files
   * @param chainType - Current chain type (for restrictions)
   * @param currentTurnContext - Context from current turn to exclude from L2 (for deduplication)
   * @returns Processed context string with XML tags
   */
  private async buildL2ContextFromPreviousTurns(
    currentMessageId: string,
    messageRepo: MessageRepository,
    fileParserManager: FileParserManager,
    vault: Vault,
    chainType: ChainType,
    currentTurnContext?: MessageContext
  ): Promise<string> {
    // Get all messages (display view)
    const allMessages = messageRepo.getDisplayMessages();

    // Find current message index
    const currentIndex = allMessages.findIndex((msg) => msg.id === currentMessageId);
    if (currentIndex === -1 || currentIndex === 0) {
      // No previous messages or message not found
      return "";
    }

    // Get all previous messages (user messages only, not AI responses)
    const previousMessages = allMessages
      .slice(0, currentIndex)
      .filter((msg) => msg.sender === "user");

    // Collect unique context items by their IDs, tracking first appearance
    interface ContextItem {
      file: TFile;
      firstSeen: number; // timestamp for stable ordering
    }

    const uniqueNotes = new Map<string, ContextItem>();
    const uniqueUrls = new Map<string, { url: string; firstSeen: number }>();

    // Collect from all previous user messages
    for (const msg of previousMessages) {
      if (!msg.context) continue;

      // Collect notes
      if (msg.context.notes) {
        for (const note of msg.context.notes) {
          if (!uniqueNotes.has(note.path)) {
            uniqueNotes.set(note.path, {
              file: note,
              firstSeen: msg.timestamp?.epoch || Date.now(),
            });
          }
        }
      }

      // Collect URLs
      if (msg.context.urls) {
        for (const url of msg.context.urls) {
          if (!uniqueUrls.has(url)) {
            uniqueUrls.set(url, {
              url,
              firstSeen: msg.timestamp?.epoch || Date.now(),
            });
          }
        }
      }

      // TODO: Collect selected text contexts (if needed)
      // TODO: Collect folder contexts (if needed)
      // TODO: Collect tag contexts (if needed)
    }

    // Deduplicate: Remove any items that appear in current turn's context (L3 takes priority)
    if (currentTurnContext) {
      // Remove current turn notes from L2
      const currentTurnNotePaths = new Set(
        (currentTurnContext.notes || []).map((note) => note.path)
      );
      for (const notePath of currentTurnNotePaths) {
        uniqueNotes.delete(notePath);
      }

      // Remove current turn URLs from L2
      const currentTurnUrls = new Set(currentTurnContext.urls || []);
      for (const url of currentTurnUrls) {
        uniqueUrls.delete(url);
      }

      // TODO: Remove current turn selected text, folders, tags (if needed)
    }

    // Sort by first appearance for stable ordering
    const sortedNotes = Array.from(uniqueNotes.values()).sort((a, b) => a.firstSeen - b.firstSeen);

    // Process notes into XML format (reuse existing processor)
    let l2Context = "";

    if (sortedNotes.length > 0) {
      const noteFiles = sortedNotes.map((item) => item.file);
      const processedNotes = await this.contextProcessor.processContextNotes(
        new Set(), // Don't exclude any notes
        fileParserManager,
        vault,
        noteFiles,
        false, // Don't include active note (it goes in L3)
        null,
        chainType
      );
      l2Context += processedNotes;
    }

    // TODO: Process URLs similarly

    return l2Context;
  }

  private buildPromptContextEnvelope(
    params: BuildPromptContextEnvelopeParams
  ): PromptContextEnvelope | undefined {
    const messageId = params.message.id;
    if (!messageId) {
      return undefined;
    }

    const layerSegments: Partial<Record<PromptLayerId, PromptLayerSegment[]>> = {};

    // L1: System & Policies - stable across conversation
    if (params.systemPrompt) {
      layerSegments.L1_SYSTEM = [
        {
          id: "system",
          content: params.systemPrompt,
          stable: true,
          metadata: { source: "system_prompt" },
        },
      ];
    }

    // L2: Previous Turn Context - auto-promoted from previous L3
    if (params.l2PreviousContext) {
      layerSegments.L2_PREVIOUS = [
        {
          id: "previous_context",
          content: params.l2PreviousContext,
          stable: true, // Stable when user doesn't add new context
          metadata: { source: "previous_turns" },
        },
      ];
    }

    // L3: Turn Context - varies per turn
    const turnSegments: PromptLayerSegment[] = [];
    this.appendTurnContextSegment(turnSegments, "notes", params.noteContextAddition, {
      source: "notes",
    });
    this.appendTurnContextSegment(turnSegments, "tags", params.tagContextAddition, {
      source: "tags",
    });
    this.appendTurnContextSegment(turnSegments, "folders", params.folderContextAddition, {
      source: "folders",
    });
    this.appendTurnContextSegment(turnSegments, "urls", params.urlContext, {
      source: "urls",
    });
    this.appendTurnContextSegment(turnSegments, "selected_text", params.selectedText, {
      source: "selected_text",
    });

    if (turnSegments.length > 0) {
      layerSegments.L3_TURN = turnSegments;
    }

    // L5: User Message - varies per turn
    layerSegments.L5_USER = [
      {
        id: `${messageId}-user`,
        content: params.processedUserMessage,
        stable: false,
        metadata: { source: "user_input" },
      },
    ];

    return this.promptContextEngine.buildEnvelope({
      conversationId: null,
      messageId,
      layerSegments,
      metadata: {
        debugLabel: `message:${messageId}`,
        chainType: params.chainType,
      },
    });
  }

  private appendTurnContextSegment(
    target: PromptLayerSegment[],
    segmentId: string,
    content: string,
    metadata: Record<string, unknown>
  ) {
    const normalized = (content || "").trim();
    if (!normalized) {
      return;
    }

    target.push({
      id: `${segmentId}`,
      content: normalized,
      stable: false,
      metadata,
    });
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

/**
 * Result returned by ContextManager after processing context for a message.
 */
export interface ContextProcessingResult {
  processedContent: string;
  contextEnvelope?: PromptContextEnvelope;
}

interface BuildPromptContextEnvelopeParams {
  chainType: ChainType;
  message: ChatMessage;
  systemPrompt: string;
  processedUserMessage: string;
  l2PreviousContext: string;
  noteContextAddition: string;
  tagContextAddition: string;
  folderContextAddition: string;
  urlContext: string;
  selectedText: string;
}
