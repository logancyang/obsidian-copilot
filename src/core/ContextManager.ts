import { getSelectedTextContexts } from "@/aiParams";
import { ChainType } from "@/chainType";
import { processPrompt } from "@/commands/customCommandUtils";
import { LOADING_MESSAGES } from "@/constants";
import { PromptContextEngine } from "@/context/PromptContextEngine";
import { compactXmlBlock, getL2RefetchInstruction } from "@/context/L2ContextCompactor";
import { CONTEXT_BLOCK_TYPES } from "@/context/contextBlockRegistry";
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
import { ChatMessage } from "@/types/message";
import { getNotesFromPath, getNotesFromTags } from "@/utils";
import { App, TFile, Vault } from "obsidian";
import { MessageRepository } from "./MessageRepository";

let ContextCompactorClass: typeof import("./ContextCompactor").ContextCompactor | null = null;
async function getContextCompactor() {
  if (!ContextCompactorClass) {
    const module = await import("./ContextCompactor");
    ContextCompactorClass = module.ContextCompactor;
  }
  return ContextCompactorClass.getInstance();
}

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

  async processMessageContext(
    app: App,
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

      const { processedPrompt: processedUserMessage, includedFiles } = await processPrompt(
        app,
        processedMessage,
        "",
        vault,
        activeNote
      );

      const { l2Context, l2Paths } = this.buildL2ContextFromPreviousTurns(message.id!, messageRepo);

      const contextUrls = message.context?.urls || [];
      const urlContextAddition =
        chainType === ChainType.COPILOT_PLUS_CHAIN
          ? await this.mention.processUrlList(vault, contextUrls)
          : { urlContext: "", imageUrls: [] };

      const processedNotePaths = new Set([
        ...includedFiles.map((file) => file.path),
        ...systemPromptIncludedFiles.map((file) => file.path),
        ...l2Paths,
      ]);
      const l3ContextPaths = new Set<string>();
      const contextNotes = message.context?.notes || [];

      const notes = contextNotes.filter((note) => !l2Paths.has(note.path));

      if (
        includeActiveNote &&
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

      notes.forEach((note) => {
        processedNotePaths.add(note.path);
        l3ContextPaths.add(note.path);
      });

      const contextTags = message.context?.tags || [];
      let tagContextAddition = "";
      const tagNotePaths: string[] = [];

      if (contextTags.length > 0) {
        const taggedNotes = getNotesFromTags(app, contextTags);

        const filteredTaggedNotes = taggedNotes.filter(
          (note) => !processedNotePaths.has(note.path)
        );

        if (filteredTaggedNotes.length > 0) {
          tagContextAddition = await this.contextProcessor.processContextNotes(
            new Set(),
            fileParserManager,
            vault,
            filteredTaggedNotes,
            false,
            null,
            chainType
          );

          filteredTaggedNotes.forEach((note) => {
            processedNotePaths.add(note.path);
            l3ContextPaths.add(note.path);
            tagNotePaths.push(note.path);
          });
        }
      }

      const contextFolders = message.context?.folders || [];
      let folderContextAddition = "";
      const folderNotePaths: string[] = [];

      if (contextFolders.length > 0) {
        const folderNotes = contextFolders.flatMap((folder) => getNotesFromPath(vault, folder));

        const filteredFolderNotes = folderNotes.filter(
          (note) => !processedNotePaths.has(note.path)
        );

        if (filteredFolderNotes.length > 0) {
          folderContextAddition = await this.contextProcessor.processContextNotes(
            new Set(),
            fileParserManager,
            vault,
            filteredFolderNotes,
            false,
            null,
            chainType
          );

          filteredFolderNotes.forEach((note) => {
            processedNotePaths.add(note.path);
            l3ContextPaths.add(note.path);
            folderNotePaths.push(note.path);
          });
        }
      }

      // Retries must preserve the sent excerpts even if the composer now has another selection.
      // https://github.com/logancyang/obsidian-copilot/issues/3210
      const selectedTextContextAddition = this.contextProcessor.processSelectedTextContexts(
        message.context?.selectedTextContexts
      );

      const webTabs = message.context?.webTabs || [];
      const webTabContextAddition = await this.contextProcessor.processContextWebTabs(webTabs);

      const contextPortion =
        l2Context +
        noteContextAddition +
        tagContextAddition +
        folderContextAddition +
        urlContextAddition.urlContext +
        selectedTextContextAddition +
        webTabContextAddition;

      let finalProcessedMessage = processedUserMessage + contextPortion;

      const charThreshold = getSettings().autoCompactThreshold * 4;

      let wasCompacted = false;
      let compactedContextPortion = contextPortion;
      if (finalProcessedMessage.length > charThreshold) {
        updateLoadingMessage?.(LOADING_MESSAGES.COMPACTING);
        const compactor = await getContextCompactor();
        const result = await compactor.compact(contextPortion);
        if (result.wasCompacted) {
          compactedContextPortion = result.content;
          finalProcessedMessage = processedUserMessage + compactedContextPortion;
          wasCompacted = true;
          logInfo(
            `[ContextManager] Compacted context: ${result.originalCharCount} -> ${result.compactedCharCount} chars`
          );
        }
        updateLoadingMessage?.(LOADING_MESSAGES.DEFAULT);
      }

      logInfo(`[ContextManager] Successfully processed context for message ${message.id}`);

      const contextEnvelope = wasCompacted
        ? this.buildCompactedEnvelope({
            chainType,
            message,
            systemPrompt: systemPrompt || "",
            processedUserMessage,
            compactedContext: compactedContextPortion,
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

  async reprocessMessageContext(
    app: App,
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
      app,
      message,
      fileParserManager,
      vault,
      chainType,
      includeActiveNote,
      activeNote,
      messageRepo,
      systemPrompt,
      systemPromptIncludedFiles
    );

    messageRepo.updateProcessedText(message.id, processedContent, contextEnvelope);
    logInfo(`[ContextManager] Completed context reprocessing for message ${messageId}`);
  }

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

    const l2SegmentMap = new Map<string, string>();
    const l2SegmentOrder: string[] = [];
    const l2Paths = new Set<string>();

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
        if (i >= mostRecentCompactedIndex) {
          for (const segment of l3Layer.segments || []) {
            if (segment.content) {
              const compacted = this.compactSegmentForL2(segment.content);
              if (!compacted.trim()) {
                continue;
              }
              if (!l2SegmentMap.has(segment.id)) {
                l2SegmentOrder.push(segment.id);
              }
              l2SegmentMap.set(segment.id, compacted);
            }
          }
        }

        for (const segment of l3Layer.segments || []) {
          if (segment.metadata?.notePath) {
            l2Paths.add(segment.metadata.notePath as string);
          }
          if (segment.metadata?.compactedPaths) {
            for (const path of segment.metadata.compactedPaths as string[]) {
              l2Paths.add(path);
            }
          }
          if (segment.metadata?.notePaths) {
            for (const path of segment.metadata.notePaths as string[]) {
              l2Paths.add(path);
            }
          }
        }
      }
    }

    const l2Content = l2SegmentOrder.map((id) => l2SegmentMap.get(id)!).join("\n");

    const hasCompactedContent = /<prior_context\s+source=/.test(l2Content);
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

    if (params.l2PreviousContext) {
      const l2Segments = this.parseContextIntoSegments(params.l2PreviousContext, true);
      if (l2Segments.length > 0) {
        layerSegments.L2_PREVIOUS = l2Segments;
      }
    }

    const turnSegments: PromptLayerSegment[] = [];

    if (params.noteContextAddition) {
      const noteSegments = this.parseContextIntoSegments(params.noteContextAddition, false);
      turnSegments.push(...noteSegments);
    }

    this.appendParsedSegments(turnSegments, params.tagContextAddition, {
      source: "tags",
      notePaths: params.tagNotePaths,
    });
    this.appendParsedSegments(turnSegments, params.folderContextAddition, {
      source: "folders",
      notePaths: params.folderNotePaths,
    });
    this.appendParsedSegments(turnSegments, params.urlContext);
    this.appendParsedSegments(turnSegments, params.selectedText);
    this.appendParsedSegments(turnSegments, params.webTabContext);

    if (turnSegments.length > 0) {
      layerSegments.L3_TURN = turnSegments;
    }

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

  private parseContextIntoSegments(contextXml: string, stable: boolean): PromptLayerSegment[] {
    return parseContextIntoSegments(contextXml, stable);
  }

  private appendParsedSegments(
    target: PromptLayerSegment[],
    content: string,
    extraMetadata?: Record<string, unknown>
  ) {
    const normalized = (content || "").trim();
    if (!normalized) {
      return;
    }

    const segments = this.parseContextIntoSegments(normalized, false);
    if (segments.length > 0) {
      for (const seg of segments) {
        if (extraMetadata) {
          seg.metadata = { ...seg.metadata, ...extraMetadata };
        }
        target.push(seg);
      }
    } else {
      target.push({
        id: `unparsed-${Date.now()}`,
        content: normalized,
        stable: false,
        metadata: { source: "unparsed", ...extraMetadata },
      });
    }
  }

  needsContextReprocessing(message: ChatMessage): boolean {
    return message.needsContextReprocessing === true;
  }

  getSelectedTextContexts() {
    return getSelectedTextContexts();
  }

  private compactSegmentForL2(content: string): string {
    const allTags = [
      ...CONTEXT_BLOCK_TYPES.map((bt) => bt.tag),
      "prior_context",
      "prior_context_note",
    ].join("|");
    const blockRegex = new RegExp(`<(${allTags})(\\s[^>]*)?>[\\s\\S]*?</\\1>`, "g");

    const result = content.replace(blockRegex, (block, tag: string) => {
      const blockType = CONTEXT_BLOCK_TYPES.find((bt) => bt.tag === tag);
      if (blockType && !blockType.recoverable) {
        return "";
      }

      if (tag === "prior_context_note") {
        return "";
      }

      if (tag === "prior_context") {
        return block;
      }

      if (blockType) {
        return compactXmlBlock(block, tag);
      }

      return block;
    });

    return result.trim();
  }
}

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
