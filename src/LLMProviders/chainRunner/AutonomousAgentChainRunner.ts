import { MessageContent } from "@/imageProcessing/imageProcessor";
import { logError, logInfo, logWarn } from "@/logger";
import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { checkIsPlusUser } from "@/plusUtils";
import { getSettings, getSystemPromptWithMemory } from "@/settings/model";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import { extractParametersFromZod, SimpleTool } from "@/tools/SimpleTool";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { ChatMessage, ResponseMetadata, StreamingResult } from "@/types/message";
import { getMessageRole, withSuppressedTokenWarnings } from "@/utils";
import { processToolResults } from "@/utils/toolResultUtils";
import { CopilotPlusChainRunner } from "./CopilotPlusChainRunner";
import { addChatHistoryToMessages } from "./utils/chatHistoryUtils";
import {
  messageRequiresTools,
  ModelAdapter,
  ModelAdapterFactory,
  STREAMING_TRUNCATE_THRESHOLD,
} from "./utils/modelAdapter";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import {
  createToolCallMarker,
  updateToolCallMarker,
  ensureEncodedToolCallMarkerResults,
} from "./utils/toolCallParser";
import {
  deduplicateSources,
  executeSequentialToolCall,
  getToolConfirmtionMessage,
  getToolDisplayName,
  getToolEmoji,
  logToolCall,
  logToolResult,
  ToolExecutionResult,
} from "./utils/toolExecution";

import {
  appendInlineCitationReminder,
  ensureCiCOrderingWithQuestion,
} from "./utils/cicPromptUtils";
import { buildAgentPromptDebugReport } from "./utils/promptDebugService";
import { recordPromptPayload } from "./utils/promptPayloadRecorder";
import { PromptDebugReport } from "./utils/toolPromptDebugger";
import {
  extractToolNameFromPartialBlock,
  parseXMLToolCalls,
  stripToolCallXML,
} from "./utils/xmlParsing";

export class AutonomousAgentChainRunner extends CopilotPlusChainRunner {
  private llmFormattedMessages: string[] = []; // Track LLM-formatted messages for memory

  private getAvailableTools(): SimpleTool<any, any>[] {
    const settings = getSettings();
    const registry = ToolRegistry.getInstance();

    // Initialize tools if not already done
    if (registry.getAllTools().length === 0) {
      initializeBuiltinTools(this.chainManager.app?.vault);
    }

    // Get enabled tool IDs from settings
    const enabledToolIds = new Set(settings.autonomousAgentEnabledToolIds || []);

    // Get all enabled tools from registry
    return registry.getEnabledTools(enabledToolIds, !!this.chainManager.app?.vault);
  }

  public static generateToolDescriptions(availableTools: SimpleTool<any, any>[]): string {
    const tools = availableTools;
    return tools
      .map((tool) => {
        let params = "";

        // All tools now have Zod schema
        const parameters = extractParametersFromZod(tool.schema);
        if (Object.keys(parameters).length > 0) {
          params = Object.entries(parameters)
            .map(([key, description]) => `<${key}>${description}</${key}>`)
            .join("\n");
        }

        return `<${tool.name}>
<description>${tool.description}</description>
<parameters>
${params}
</parameters>
</${tool.name}>`;
      })
      .join("\n\n");
  }

  public static async generateSystemPrompt(
    availableTools: SimpleTool<any, any>[],
    adapter: ModelAdapter,
    userMemoryManager?: UserMemoryManager
  ): Promise<string> {
    const basePrompt = await getSystemPromptWithMemory(userMemoryManager);
    const toolDescriptions = AutonomousAgentChainRunner.generateToolDescriptions(availableTools);

    const toolNames = availableTools.map((tool) => tool.name);

    // Get tool metadata for custom instructions
    const registry = ToolRegistry.getInstance();
    const toolMetadata = availableTools
      .map((tool) => registry.getToolMetadata(tool.name))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);

    return adapter.enhanceSystemPrompt(basePrompt, toolDescriptions, toolNames, toolMetadata);
  }

  private async generateSystemPrompt(): Promise<string> {
    const availableTools = this.getAvailableTools();

    // Use model adapter for clean model-specific handling
    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const adapter = ModelAdapterFactory.createAdapter(chatModel);

    return AutonomousAgentChainRunner.generateSystemPrompt(
      availableTools,
      adapter,
      this.chainManager.userMemoryManager
    );
  }

  /**
   * Build an annotated prompt report for debugging tool call prompting.
   *
   * @param userMessage - The user chat message to inspect.
   * @returns A prompt debug report containing sections and annotated string output.
   */
  public async buildToolPromptDebugReport(userMessage: ChatMessage): Promise<PromptDebugReport> {
    const availableTools = this.getAvailableTools();
    const adapter = ModelAdapterFactory.createAdapter(
      this.chainManager.chatModelManager.getChatModel()
    );
    const toolDescriptions = AutonomousAgentChainRunner.generateToolDescriptions(availableTools);

    return buildAgentPromptDebugReport({
      chainManager: this.chainManager,
      adapter,
      availableTools,
      toolDescriptions,
      userMessage,
    });
  }

  /**
   * Apply CiC ordering by appending the original user question after the local search payload.
   *
   * @param localSearchPayload - XML-wrapped local search payload prepared for the LLM.
   * @param originalPrompt - The original user prompt (before any enhancements).
   * @returns Payload with question appended using CiC ordering when needed.
   */
  protected applyCiCOrderingToLocalSearchResult(
    localSearchPayload: string,
    originalPrompt: string
  ): string {
    const settings = getSettings();
    const promptWithReminder = appendInlineCitationReminder(
      originalPrompt,
      Boolean(settings?.enableInlineCitations)
    );
    return ensureCiCOrderingWithQuestion(localSearchPayload, promptWithReminder);
  }

  private getTemporaryToolCallId(toolName: string, index: number): string {
    return `temporary-tool-call-id-${toolName}-${index}`;
  }

  async run(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
      updateLoadingMessage?: (message: string) => void;
    }
  ): Promise<string> {
    let fullAIResponse = "";
    const conversationMessages: any[] = [];
    const iterationHistory: string[] = []; // Track all iterations for display
    const collectedSources: { title: string; path: string; score: number; explanation?: any }[] =
      []; // Collect sources from localSearch
    this.llmFormattedMessages = []; // Reset LLM messages for this run
    let responseMetadata: ResponseMetadata | undefined;
    const isPlusUser = await checkIsPlusUser({
      isAutonomousAgent: true,
    });
    if (!isPlusUser) {
      await this.handleError(new Error("Invalid license key"), addMessage, updateCurrentAiMessage);
      return "";
    }

    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const adapter = ModelAdapterFactory.createAdapter(chatModel);
    const modelNameForLog = (chatModel as { modelName?: string } | undefined)?.modelName;

    try {
      // Get chat history from memory
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      // Use raw history to preserve multimodal content
      const rawHistory = memoryVariables.history || [];

      // Build initial conversation messages
      const customSystemPrompt = await this.generateSystemPrompt();

      if (customSystemPrompt) {
        conversationMessages.push({
          role: getMessageRole(chatModel),
          content: customSystemPrompt,
        });
      }

      // Add chat history - safely handle different message formats
      addChatHistoryToMessages(rawHistory, conversationMessages);

      // Check if the model supports multimodal (vision) capability
      const isMultimodal = this.isMultimodalModel(chatModel);

      // Add current user message with model-specific enhancements
      const requiresTools = messageRequiresTools(userMessage.message);
      const enhancedUserMessage = adapter.enhanceUserMessage(userMessage.message, requiresTools);

      // Build message content with images if multimodal, otherwise just use text
      const content: string | MessageContent[] = isMultimodal
        ? await this.buildMessageContent(enhancedUserMessage, userMessage)
        : enhancedUserMessage;

      conversationMessages.push({
        role: "user",
        content,
      });

      // Store original user prompt for tools that need it
      const originalUserPrompt = userMessage.originalMessage || userMessage.message;

      // Autonomous agent loop
      const maxIterations = getSettings().autonomousAgentMaxIterations; // Get from settings
      let iteration = 0;

      while (iteration < maxIterations) {
        if (abortController.signal.aborted) {
          break;
        }

        iteration++;
        logInfo(`=== Autonomous Agent Iteration ${iteration} ===`);

        // Store tool call messages for this iteration (declared here so it's accessible in the streaming callback)
        const currentIterationToolCallMessages: string[] = [];

        // Get AI response
        const response = await this.streamResponse(
          conversationMessages,
          abortController,
          (fullMessage) => {
            // Show tool calls as indicators during streaming for clarity, preserve think blocks
            const cleanedMessage = stripToolCallXML(fullMessage);
            // Build display with ALL content including tool calls from history
            const displayParts = [];

            // Add all iteration history (which includes tool call markers)
            displayParts.push(...iterationHistory);

            // Add the current streaming message
            if (cleanedMessage.trim()) {
              displayParts.push(cleanedMessage);
            }

            // Collect tool names from the current streaming message, including partial tool call block
            const toolCalls = parseXMLToolCalls(fullMessage);
            let toolNames: string[] = [];
            if (toolCalls.length > 0) {
              toolNames = toolCalls.map((toolCall) => toolCall.name);
            }

            // Determine background tools to avoid showing banners during streaming
            const availableTools = this.getAvailableTools();
            const backgroundToolNames = new Set(
              availableTools.filter((t) => t.isBackground).map((t) => t.name)
            );

            // Include partial tool name if long enough, then filter out background tools
            const toolName = extractToolNameFromPartialBlock(fullMessage);
            if (toolName) {
              // Only add the partial tool call block if the block is larger than STREAMING_TRUNCATE_THRESHOLD
              const lastToolNameIndex = fullMessage.lastIndexOf(toolName);
              if (fullMessage.length - lastToolNameIndex > STREAMING_TRUNCATE_THRESHOLD) {
                toolNames.push(toolName);
              }
            }

            // Filter out background tools (should be invisible)
            toolNames = toolNames.filter((name) => !backgroundToolNames.has(name));

            // Create tool call markers if they don't exist
            // Generate temporary tool call id based on index of the tool name in the toolNames array
            for (let i = 0; i < toolNames.length; i++) {
              const toolName = toolNames[i];
              const toolCallId = this.getTemporaryToolCallId(toolName, i);
              // Check if the tool call marker already exists
              const messageIndex = currentIterationToolCallMessages.findIndex((msg) =>
                msg.includes(toolCallId)
              );
              if (messageIndex !== -1) {
                continue;
              }

              const toolCallMarker = createToolCallMarker(
                toolCallId,
                toolName,
                getToolDisplayName(toolName),
                getToolEmoji(toolName),
                "", // confirmationMessage (empty until generation completes)
                true, // isExecuting
                "", // content (empty for now)
                "" // result (empty until execution completes)
              );

              currentIterationToolCallMessages.push(toolCallMarker);
            }

            // Add current iteration's tool calls if any
            if (currentIterationToolCallMessages.length > 0) {
              displayParts.push(currentIterationToolCallMessages.join("\n"));
            }

            const currentDisplay = displayParts.join("\n\n");
            updateCurrentAiMessage(currentDisplay);
          },
          adapter
        );

        // Store truncation metadata if response was truncated
        if (response.wasTruncated) {
          responseMetadata = {
            wasTruncated: response.wasTruncated,
            tokenUsage: response.tokenUsage ?? undefined,
          };
        }

        const responseContent = response.content;

        if (!responseContent) break;

        // Parse tool calls from the response
        const toolCalls = parseXMLToolCalls(responseContent);

        // Use model adapter to detect and handle premature responses
        const prematureResponseResult = adapter.detectPrematureResponse?.(responseContent);
        if (prematureResponseResult?.hasPremature && iteration === 1) {
          if (prematureResponseResult.type === "before") {
            logWarn("⚠️  Model provided premature response BEFORE tool calls!");
            logWarn("Sanitizing response to keep only tool calls for first iteration");
          } else if (prematureResponseResult.type === "after") {
            logWarn("⚠️  Model provided hallucinated response AFTER tool calls!");
            logWarn("Truncating response at last tool call for first iteration");
          }
        }

        if (toolCalls.length === 0) {
          // No tool calls, this is the final response
          // Strip any tool call XML from final response but preserve think blocks
          const cleanedResponse = stripToolCallXML(responseContent);

          // Build full response from history (which includes tool call markers) and final response
          const allParts = [...iterationHistory];
          if (cleanedResponse.trim()) {
            allParts.push(cleanedResponse);
          }
          fullAIResponse = allParts.join("\n\n");

          const safeAssistantMessage = ensureEncodedToolCallMarkerResults(responseContent);
          conversationMessages.push({
            role: "assistant",
            content: safeAssistantMessage,
          });

          // Add final response to LLM messages
          this.llmFormattedMessages.push(responseContent);
          break;
        }

        // Use model adapter to sanitize response if needed
        let sanitizedResponse = responseContent;
        if (adapter.sanitizeResponse && prematureResponseResult?.hasPremature) {
          sanitizedResponse = adapter.sanitizeResponse(responseContent, iteration);
        }

        // Store this iteration's response (AI reasoning) with tool indicators and think blocks preserved
        const responseForHistory: string = stripToolCallXML(sanitizedResponse);

        // Only add to history if there's meaningful content
        if (responseForHistory.trim()) {
          iterationHistory.push(responseForHistory);
        }

        // Execute tool calls and show progress
        const toolResults: ToolExecutionResult[] = [];
        const toolCallIdMap = new Map<number, string>(); // Map index to tool call ID

        // Truncate currentIterationToolCallMessages based on the toolCalls array size
        currentIterationToolCallMessages.splice(toolCalls.length);

        for (let i = 0; i < toolCalls.length; i++) {
          const toolCall = toolCalls[i];
          if (abortController.signal.aborted) break;

          // Log tool call details for debugging
          logToolCall(toolCall, iteration);

          // Find the tool to check if it's a background tool
          const availableTools = this.getAvailableTools();
          const tool = availableTools.find((t) => t.name === toolCall.name);
          const isBackgroundTool = tool?.isBackground || false;

          let toolCallId: string | undefined;

          // Only show tool calling message for non-background tools
          if (!isBackgroundTool) {
            // Create tool calling message with structured marker
            const toolEmoji = getToolEmoji(toolCall.name);
            let toolDisplayName = getToolDisplayName(toolCall.name);
            if (toolCall.name === "readNote") {
              const notePath =
                typeof toolCall.args?.notePath === "string" ? toolCall.args.notePath : null;
              if (notePath && notePath.trim().length > 0) {
                toolDisplayName = notePath.trim();
              }
            }
            const confirmationMessage = getToolConfirmtionMessage(toolCall.name);

            // Generate unique ID for this tool call
            toolCallId = `${toolCall.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            toolCallIdMap.set(i, toolCallId);

            // Create structured tool call marker
            const toolCallMarker = createToolCallMarker(
              toolCallId,
              toolCall.name,
              toolDisplayName,
              toolEmoji,
              confirmationMessage || "",
              true, // isExecuting
              "", // content (empty for now)
              "" // result (empty until execution completes)
            );

            // Check if the tool call marker already created during streaming
            const messageIndex = currentIterationToolCallMessages.findIndex((msg) =>
              msg.includes(this.getTemporaryToolCallId(toolCall.name, i))
            );
            if (messageIndex !== -1) {
              currentIterationToolCallMessages[messageIndex] = toolCallMarker;
            } else {
              currentIterationToolCallMessages.push(toolCallMarker);
              logWarn(
                "Created tool call marker for tool call that was not created during streaming",
                toolCall.name
              );
            }

            // Show all history plus all tool call messages
            const currentDisplay = [...iterationHistory, ...currentIterationToolCallMessages].join(
              "\n\n"
            );
            updateCurrentAiMessage(currentDisplay);
          }

          const result = await executeSequentialToolCall(
            toolCall,
            availableTools,
            originalUserPrompt
          );

          // Process localSearch results using the inherited method
          if (toolCall.name === "localSearch") {
            // Note: We don't have access to time expression in autonomous agent context
            // as it processes tools individually, not in batch with toolCalls

            // Use the inherited method for consistent processing
            const processed = this.processLocalSearchResult(result);

            // Collect sources for UI
            collectedSources.push(...processed.sources);

            // Update result with formatted text for LLM
            result.result = this.applyCiCOrderingToLocalSearchResult(
              processed.formattedForLLM,
              originalUserPrompt || ""
            );
            result.displayResult = processed.formattedForDisplay;
          }

          toolResults.push(result);

          // Update the tool call marker with the result if we have an ID
          if (toolCallId && !isBackgroundTool) {
            // Update the specific tool call message
            const messageIndex = currentIterationToolCallMessages.findIndex((msg) =>
              msg.includes(toolCallId)
            );
            if (messageIndex !== -1) {
              currentIterationToolCallMessages[messageIndex] = updateToolCallMarker(
                currentIterationToolCallMessages[messageIndex],
                toolCallId,
                result.displayResult ?? result.result
              );
            }

            // Update the display with the result
            const currentDisplay = [...iterationHistory, ...currentIterationToolCallMessages].join(
              "\n\n"
            );
            updateCurrentAiMessage(currentDisplay);
          }

          // Log tool result
          logToolResult(toolCall.name, result);
        }

        // Add all tool call messages to history so they persist
        if (currentIterationToolCallMessages.length > 0) {
          const toolCallsString = currentIterationToolCallMessages.join("\n");
          iterationHistory.push(toolCallsString);
        }

        // Don't add tool results to display - they're internal only

        // Track LLM-formatted messages for memory
        // Add the assistant's response with tool calls
        this.llmFormattedMessages.push(responseContent);

        // Add tool results in LLM format (truncated for memory)
        if (toolResults.length > 0) {
          const toolResultsForLLM = processToolResults(toolResults, true); // truncated for memory
          if (toolResultsForLLM) {
            this.llmFormattedMessages.push(toolResultsForLLM);
          }
        }

        // Add AI response to conversation for next iteration
        // Ensure any tool markers have encoded results before storing in conversation
        const safeAssistantContent = ensureEncodedToolCallMarkerResults(sanitizedResponse);
        conversationMessages.push({
          role: "assistant",
          content: safeAssistantContent,
        });

        // Add tool results as user messages for next iteration (full results for current turn)
        const toolResultsForConversation = processToolResults(toolResults, false); // full results

        conversationMessages.push({
          role: "user",
          content: toolResultsForConversation,
        });

        // Keep logs concise: avoid dumping full tool results
        logInfo("Tool results added to conversation");
      }

      // If we hit max iterations, add a message explaining the limit was reached
      if (iteration >= maxIterations && !fullAIResponse) {
        logWarn(
          `Autonomous agent reached maximum iterations (${maxIterations}) without completing the task`
        );

        const limitMessage =
          `\n\nI've reached the maximum number of iterations (${maxIterations}) for this task. ` +
          "I attempted to gather information using various tools but couldn't complete the analysis within the iteration limit. " +
          "You may want to try a more specific question or break down your request into smaller parts.";

        fullAIResponse = iterationHistory.join("\n\n") + limitMessage;
        conversationMessages.push({
          role: "assistant",
          content: fullAIResponse,
        });
      }
    } catch (error: any) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        logInfo("Autonomous agent stream aborted by user", {
          reason: abortController.signal.reason,
        });
      } else {
        logError("Autonomous agent failed, falling back to regular Plus mode:", error);

        // Fallback to regular CopilotPlusChainRunner
        try {
          const fallbackRunner = new CopilotPlusChainRunner(this.chainManager);
          return await fallbackRunner.run(
            userMessage,
            abortController,
            updateCurrentAiMessage,
            addMessage,
            options
          );
        } catch (fallbackError) {
          logError("Fallback to regular Plus mode also failed:", fallbackError);
          await this.handleError(fallbackError, addMessage, updateCurrentAiMessage);
          return "";
        }
      }
    }

    // Handle response like the parent class, with sources if we found any
    const uniqueSources = deduplicateSources(collectedSources);

    // Create LLM-formatted output for memory
    const llmFormattedOutput = this.llmFormattedMessages.join("\n\n");

    // If we somehow don't have a fullAIResponse but have iteration history, use that
    if (!fullAIResponse && iterationHistory.length > 0) {
      logWarn("fullAIResponse was empty, using iteration history");
      fullAIResponse = iterationHistory.join("\n\n");
    }

    if (conversationMessages.length > 0) {
      recordPromptPayload({
        messages: [...conversationMessages],
        modelName: modelNameForLog,
      });
    }

    // Decode encoded tool marker results for clearer logging only
    await import("./utils/toolCallParser");
    // Keep llmFormattedOutput encoded for memory storage; no decoded variant needed
    // Readable log removed to reduce verbosity

    await this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      uniqueSources.length > 0 ? uniqueSources : undefined,
      llmFormattedOutput,
      responseMetadata
    );

    return fullAIResponse;
  }

  private async streamResponse(
    messages: any[],
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    adapter: ModelAdapter
  ): Promise<StreamingResult> {
    const streamer = new ThinkBlockStreamer(updateCurrentAiMessage, adapter);

    const maxRetries = 2;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        const chatStream = await withSuppressedTokenWarnings(() =>
          this.chainManager.chatModelManager.getChatModel().stream(messages, {
            signal: abortController.signal,
          })
        );

        for await (const chunk of chatStream) {
          if (abortController.signal.aborted) {
            break;
          }
          streamer.processChunk(chunk);
        }

        const result = streamer.close();

        return {
          content: result.content,
          wasTruncated: result.wasTruncated,
          tokenUsage: result.tokenUsage,
        };
      } catch (error) {
        if (error.name === "AbortError" || abortController.signal.aborted) {
          const result = streamer.close();
          return {
            content: result.content,
            wasTruncated: result.wasTruncated,
            tokenUsage: result.tokenUsage,
          };
        }

        // Check if this is an overloaded error that we should retry
        const isOverloadedError =
          error?.message?.includes("overloaded") ||
          error?.message?.includes("Overloaded") ||
          error?.error?.type === "overloaded_error";

        if (isOverloadedError && retryCount < maxRetries) {
          retryCount++;
          logInfo(
            `Retrying autonomous agent request (attempt ${retryCount}/${maxRetries + 1}) due to overloaded error`
          );

          // Wait before retrying (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
          continue;
        }

        throw error;
      }
    }

    // This should never be reached, but just in case
    const result = streamer.close();
    return {
      content: result.content,
      wasTruncated: result.wasTruncated,
      tokenUsage: result.tokenUsage,
    };
  }
}
