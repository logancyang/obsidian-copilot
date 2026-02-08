import { getSelectedTextContexts } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { processPrompt } from "@/commands/customCommandUtils";
import { LOADING_MESSAGES } from "@/constants";
import { PromptContextEngine } from "@/context/PromptContextEngine";
import { compactXmlBlock, getL2RefetchInstruction } from "@/context/L2ContextCompactor";
import { CONTEXT_BLOCK_TYPES, detectBlockTag } from "@/context/contextBlockRegistry";
import { parseContextIntoSegments } from "@/context/parseContextSegments";
import {
  PromptContextEnvelope,
  PromptLayerId,
  PromptLayerSegment,
} from "@/context/PromptContextTypes";
import { ContextProcessor } from "@/contextProcessor";
import { logInfo } from "@/logger";
import { Mention } from "@/mentions/Mention";
import { getSettings } from "@/settings/model";
import { FileParserManager } from "@/tools/FileParserManager";
import { ChatMessage, MessageContext } from "@/types/message";
import { extractNoteFiles, getNotesFromPath, getNotesFromTags } from "@/utils";
import { TFile, Vault } from "obsidian";
import { MessageRepository } from "./MessageRepository";

// Lazy-loaded to avoid circular dependency issues in tests
let ContextCompactorClass: typeof import("./ContextCompactor").ContextCompactor | null = null;
async function getContextCompactor() {
  if (!ContextCompactorClass) {
    const module = await import("./ContextCompactor");
    ContextCompactorClass = module.ContextCompactor;
  }
  return ContextCompactorClass.getInstance();
}

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
    systemPrompt?: string,
    systemPromptIncludedFiles: TFile[] = [],
    updateLoadingMessage?: (message: string) => void
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

      // 2. Build L2 context from previous turns (uses stored envelope content, preserves compaction)
      const { l2Context, l2Paths } = this.buildL2ContextFromPreviousTurns(message.id!, messageRepo);

      // 3. Extract URLs and process them (for Copilot Plus chain)
      const contextUrls = message.context?.urls || [];
      const urlContextAddition =
        chainType === ChainType.COPILOT_PLUS_CHAIN
          ? await this.mention.processUrlList(contextUrls)
          : { urlContext: "", imageUrls: [] };

      // 4. Process context notes (L3 - current turn only, excluding files already in L2 or system prompt)
      // Combine exclusions: custom prompt files + system prompt files + files already in L2
      const processedNotePaths = new Set([
        ...includedFiles.map((file) => file.path),
        ...systemPromptIncludedFiles.map((file) => file.path),
        ...l2Paths,
      ]);
      // Track only L3 context paths (excludes L5 user message files from includedFiles)
      // This is used for compactedPaths to avoid false deduplication of L5 files
      const l3ContextPaths = new Set<string>();
      const contextNotes = message.context?.notes || [];

      // Filter out notes already in L2 to avoid duplication
      const notes = contextNotes.filter((note) => !l2Paths.has(note.path));

      // Add active note if requested and not already in L2
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

      // Add processed context notes to tracking sets
      notes.forEach((note) => {
        processedNotePaths.add(note.path);
        l3ContextPaths.add(note.path);
      });

      // 5. Process context tags
      const contextTags = message.context?.tags || [];
      let tagContextAddition = "";
      const tagNotePaths: string[] = [];

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

          // Add processed tagged notes to tracking sets and collect paths
          filteredTaggedNotes.forEach((note) => {
            processedNotePaths.add(note.path);
            l3ContextPaths.add(note.path);
            tagNotePaths.push(note.path);
          });
        }
      }

      // 6. Process context folders
      const contextFolders = message.context?.folders || [];
      let folderContextAddition = "";
      const folderNotePaths: string[] = [];

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

          // Add processed folder notes to tracking sets and collect paths
          filteredFolderNotes.forEach((note) => {
            processedNotePaths.add(note.path);
            l3ContextPaths.add(note.path);
            folderNotePaths.push(note.path);
          });
        }
      }

      // 7. Process selected text contexts
      const selectedTextContextAddition = this.contextProcessor.processSelectedTextContexts();

      // 8. Process web tab contexts (L3 - current turn only)
      const webTabs = message.context?.webTabs || [];
      const webTabContextAddition = await this.contextProcessor.processContextWebTabs(webTabs);

      // 9. Build context portion separately (for compaction boundary preservation)
      const contextPortion =
        l2Context +
        noteContextAddition +
        tagContextAddition +
        folderContextAddition +
        urlContextAddition.urlContext +
        selectedTextContextAddition +
        webTabContextAddition;

      // Combine everything (L2 previous context, then L3 current turn context)
      let finalProcessedMessage = processedUserMessage + contextPortion;

      // 10. Auto-compact if context exceeds threshold (tokens * 4 = chars estimate)
      // Projects mode uses a fixed 800k token threshold
      // TODO(logan): deprecate this threshold when Projects mode is out of alpha
      const PROJECT_COMPACT_THRESHOLD = 1000000;
      const tokenThreshold =
        chainType === ChainType.PROJECT_CHAIN
          ? PROJECT_COMPACT_THRESHOLD
          : getSettings().autoCompactThreshold;
      const charThreshold = tokenThreshold * 4;

      let wasCompacted = false;
      let compactedContextPortion = contextPortion;
      if (finalProcessedMessage.length > charThreshold) {
        updateLoadingMessage?.(LOADING_MESSAGES.COMPACTING);
        const compactor = await getContextCompactor();
        // Only compact context portion, not user message, to preserve boundary
        const result = await compactor.compact(contextPortion);
        if (result.wasCompacted) {
          compactedContextPortion = result.content;
          // Reconstruct with preserved user message + compacted context
          finalProcessedMessage = processedUserMessage + compactedContextPortion;
          wasCompacted = true;
          logInfo(
            `[ContextManager] Compacted context: ${result.originalCharCount} -> ${result.compactedCharCount} chars`
          );
        }
        updateLoadingMessage?.(LOADING_MESSAGES.DEFAULT);
      }

      logInfo(`[ContextManager] Successfully processed context for message ${message.id}`);

      // Build envelope - if compacted, use compacted context directly (no slicing needed)
      const contextEnvelope = wasCompacted
        ? this.buildCompactedEnvelope({
            chainType,
            message,
            systemPrompt: systemPrompt || "",
            processedUserMessage,
            compactedContext: compactedContextPortion,
            // Only include L3 context paths, not L5 user message files from includedFiles
            compactedPaths: Array.from(l3ContextPaths),
          })
        : this.buildPromptContextEnvelope({
            chainType,
            message,
            systemPrompt: systemPrompt || "",
            processedUserMessage,
            l2PreviousContext: l2Context,
            noteContextAddition,
            tagContextAddition,
            tagNotePaths,
            folderContextAddition,
            folderNotePaths,
            urlContext: urlContextAddition.urlContext,
            selectedText: selectedTextContextAddition,
            webTabContext: webTabContextAddition,
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
    systemPrompt?: string,
    systemPromptIncludedFiles: TFile[] = []
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
      systemPrompt,
      systemPromptIncludedFiles
    );

    messageRepo.updateProcessedText(message.id, processedContent, contextEnvelope);
    logInfo(`[ContextManager] Completed context reprocessing for message ${messageId}`);
  }

  /**
   * Build L2 context from previous turns in the conversation.
   * Uses stored L3 content from previous messages' envelopes (preserving compaction).
   * Returns both the context and the set of paths already in L2 (for deduplication in L3).
   *
   * Important: When a message was compacted, its L3 already contains all prior L2 context
   * (in summarized form). To avoid duplication, we only include L3 text from the most recent
   * compacted message onwards, but still collect paths from ALL messages for deduplication.
   *
   * NOTE: Staleness detection was intentionally removed for simplicity.
   * A previous implementation tracked file modification times (mtime) and would detect
   * when compacted context was stale (source files modified after compaction). This was
   * removed because:
   * 1. It added significant complexity (~100 lines of mtime tracking)
   * 2. The edge case of files changing mid-conversation is rare
   * 3. Users can manually trigger reprocessing if needed
   *
   * If staleness detection is needed in the future, consider:
   * - Tracking mtime alongside paths in compactedPaths metadata
   * - Comparing current file mtime with stored mtime when building L2
   * - Skipping path deduplication for stale compacted segments
   *
   * TODO: Deduplicate L2 content by notePath when building l2Context.
   * Currently, if the same note is included across multiple turns (e.g., auto-added active note),
   * its content is appended to L2 once per turn, causing linear growth. Consider deduplicating
   * by notePath when concatenating L3 segments, not just collecting paths for exclusions.
   */
  private buildL2ContextFromPreviousTurns(
    currentMessageId: string,
    messageRepo: MessageRepository
  ): { l2Context: string; l2Paths: Set<string> } {
    const allMessages = messageRepo.getDisplayMessages();
    const currentIndex = allMessages.findIndex((msg) => msg.id === currentMessageId);

    if (currentIndex === -1 || currentIndex === 0) {
      return { l2Context: "", l2Paths: new Set() };
    }

    const previousUserMessages = allMessages
      .slice(0, currentIndex)
      .filter((msg) => msg.sender === "user");

    const l2Parts: string[] = [];
    const l2Paths = new Set<string>();

    // Find the most recent compacted message index.
    // When a message is compacted, its L3 already includes all prior context (L2 + L3),
    // so we only need L3 text from that message onwards to avoid duplication.
    let mostRecentCompactedIndex = -1;
    for (let i = previousUserMessages.length - 1; i >= 0; i--) {
      const msg = previousUserMessages[i];
      const l3Layer = msg.contextEnvelope?.layers?.find((l) => l.id === "L3_TURN");
      const wasCompacted = l3Layer?.segments?.some((s) => s.metadata?.wasCompacted);
      if (wasCompacted) {
        mostRecentCompactedIndex = i;
        break;
      }
    }

    for (let i = 0; i < previousUserMessages.length; i++) {
      const msg = previousUserMessages[i];
      const l3Layer = msg.contextEnvelope?.layers?.find((l) => l.id === "L3_TURN");

      if (l3Layer) {
        // Only include L3 content from the most recent compacted message onwards.
        // Earlier messages' content is already included in the compacted L3.
        if (i >= mostRecentCompactedIndex) {
          const segmentContent: string[] = [];
          for (const segment of l3Layer.segments || []) {
            if (segment.content) {
              // Compact large L3 segments for L2 to reduce context size
              // This extracts structure + preview with tool hints for re-fetching
              const compacted = this.compactSegmentForL2(segment.content);
              segmentContent.push(compacted);
            }
          }
          if (segmentContent.length > 0) {
            l2Parts.push(segmentContent.join("\n"));
          }
        }

        // Track paths from ALL messages for deduplication
        for (const segment of l3Layer.segments || []) {
          if (segment.metadata?.notePath) {
            l2Paths.add(segment.metadata.notePath as string);
          }
          // Handle compacted segments
          if (segment.metadata?.compactedPaths) {
            for (const path of segment.metadata.compactedPaths as string[]) {
              l2Paths.add(path);
            }
          }
          // Handle tag/folder segments that store paths in notePaths
          if (segment.metadata?.notePaths) {
            for (const path of segment.metadata.notePaths as string[]) {
              l2Paths.add(path);
            }
          }
        }
      }
      // Note: Messages without envelopes (pre-envelope chat history or loaded from disk)
      // are intentionally NOT tracked for L2 deduplication to avoid filtering notes
      // without their content appearing in L2.
      //
      // TODO: Rebuild L2 context for loaded chats.
      // ChatPersistenceManager saves context metadata (note paths, tags, folders) but not
      // the full contextEnvelope. When a chat is loaded, messages have context but no envelope,
      // so L2 context is lost. This means:
      // 1. AI loses the "context library" from turns before the save
      // 2. Same notes can be duplicated if re-attached after loading
      // Fix options:
      // - Persist envelopes to disk (increases storage, requires migration)
      // - Rebuild L2 content by re-reading files from message.context on load (expensive)
      // - Lazy rebuild: process context.notes when first accessed after load
    }

    // Build the L2 context string
    const l2Content = l2Parts.join("\n");

    // Append re-fetch instruction if there's any L2 content with prior_context blocks
    const hasCompactedContent = l2Content.includes("<prior_context ");
    const l2Context = hasCompactedContent
      ? l2Content + "\n\n" + getL2RefetchInstruction()
      : l2Content;

    return { l2Context, l2Paths };
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

    // L2: Previous Turn Context - one segment per note with path as ID
    if (params.l2PreviousContext) {
      const l2Segments = this.parseContextIntoSegments(params.l2PreviousContext, true);
      if (l2Segments.length > 0) {
        layerSegments.L2_PREVIOUS = l2Segments;
      }
    }

    // L3: Turn Context - one segment per note with path as ID
    const turnSegments: PromptLayerSegment[] = [];

    // Parse notes into individual segments
    if (params.noteContextAddition) {
      const noteSegments = this.parseContextIntoSegments(params.noteContextAddition, false);
      turnSegments.push(...noteSegments);
    }

    // Parse other context types (tags, folders, URLs, selected text)
    // Store note paths in metadata for L2 deduplication
    this.appendTurnContextSegment(turnSegments, "tags", params.tagContextAddition, {
      source: "tags",
      notePaths: params.tagNotePaths,
    });
    this.appendTurnContextSegment(turnSegments, "folders", params.folderContextAddition, {
      source: "folders",
      notePaths: params.folderNotePaths,
    });
    this.appendTurnContextSegment(turnSegments, "urls", params.urlContext, {
      source: "urls",
    });
    this.appendTurnContextSegment(turnSegments, "selected_text", params.selectedText, {
      source: "selected_text",
    });
    this.appendTurnContextSegment(turnSegments, "web_tabs", params.webTabContext, {
      source: "web_tabs",
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

  /**
   * Build a simplified envelope after compaction.
   * All context is combined into a single L3 segment with the compacted content.
   * Stores paths for deduplication in multi-turn context.
   */
  private buildCompactedEnvelope(params: {
    chainType: ChainType;
    message: ChatMessage;
    systemPrompt: string;
    processedUserMessage: string;
    compactedContext: string;
    compactedPaths: string[];
  }): PromptContextEnvelope | undefined {
    const messageId = params.message.id;
    if (!messageId) {
      return undefined;
    }

    const layerSegments: Partial<Record<PromptLayerId, PromptLayerSegment[]>> = {};

    // L1: System & Policies - unchanged
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

    // L3: All compacted context as a single segment
    // Store paths for deduplication in multi-turn context
    if (params.compactedContext.trim()) {
      layerSegments.L3_TURN = [
        {
          id: "compacted_context",
          content: params.compactedContext,
          stable: false,
          metadata: {
            source: "compacted",
            wasCompacted: true,
            compactedPaths: params.compactedPaths,
          },
        },
      ];
    }

    // L5: User Message - unchanged
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
        debugLabel: `message:${messageId}:compacted`,
        chainType: params.chainType,
      },
    });
  }

  /**
   * Parse context XML string into individual segments (one per context item).
   * Delegates to the standalone parseContextIntoSegments function.
   */
  private parseContextIntoSegments(contextXml: string, stable: boolean): PromptLayerSegment[] {
    return parseContextIntoSegments(contextXml, stable);
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

  /**
   * Compact an L3 segment's content for inclusion in L2 (previous turn context).
   *
   * Large content is compacted by extracting structure (headings) and previews
   * from each section. Small content and selected text are kept verbatim.
   * A single re-fetch instruction is appended at the L2 level (not per-block).
   *
   * Handles multiple concatenated XML blocks of different types (e.g., web_tab_context
   * mixed with youtube_video_context) by finding and compacting each block independently.
   *
   * @param content - The segment content (one or more XML blocks)
   * @returns Compacted content for L2
   */
  private compactSegmentForL2(content: string): string {
    // Build a regex that matches any known block type
    const blockTags = CONTEXT_BLOCK_TYPES.map((bt) => bt.tag).join("|");
    const allBlocksRegex = new RegExp(`<(${blockTags})[^>]*>[\\s\\S]*?</\\1>`, "g");

    const blocks = content.match(allBlocksRegex);

    if (!blocks || blocks.length === 0) {
      // No recognized XML blocks, return as-is
      return content;
    }

    if (blocks.length === 1) {
      // Single block - detect type and compact
      const blockType = detectBlockTag(blocks[0]);
      if (!blockType) return content;
      return compactXmlBlock(blocks[0], blockType);
    }

    // Multiple blocks found - compact each one independently
    const compactedBlocks = blocks.map((block) => {
      const blockType = detectBlockTag(block);
      if (!blockType) return block;
      return compactXmlBlock(block, blockType);
    });

    return compactedBlocks.join("\n\n");
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
  tagNotePaths: string[];
  folderContextAddition: string;
  folderNotePaths: string[];
  urlContext: string;
  selectedText: string;
  webTabContext: string;
}
