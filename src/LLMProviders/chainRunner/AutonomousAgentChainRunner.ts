import { MessageContent } from "@/imageProcessing/imageProcessor";
import { logError, logInfo, logWarn } from "@/logger";
import { checkIsPlusUser } from "@/plusUtils";
import { getSettings, getSystemPrompt } from "@/settings/model";
import { extractParametersFromZod, SimpleTool } from "@/tools/SimpleTool";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { initializeBuiltinTools } from "@/tools/builtinTools";
import { ChatMessage } from "@/types/message";
import { getMessageRole, withSuppressedTokenWarnings } from "@/utils";
import { processToolResults } from "@/utils/toolResultUtils";
import { CopilotPlusChainRunner } from "./CopilotPlusChainRunner";
import { addChatHistoryToMessages } from "./utils/chatHistoryUtils";
import { messageRequiresTools, ModelAdapter, ModelAdapterFactory } from "./utils/modelAdapter";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import { createToolCallMarker, updateToolCallMarker } from "./utils/toolCallParser";
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

  private generateToolDescriptions(): string {
    const tools = this.getAvailableTools();
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

  private buildIterationDisplay(
    iterationHistory: string[],
    currentIteration: number,
    currentMessage: string
  ): string {
    // Simply join all history without headers or separators
    const allParts = [...iterationHistory];

    // Add current message if present
    if (currentMessage) {
      allParts.push(currentMessage);
    }

    // Join with simple spacing
    return allParts.join("\n\n");
  }

  private generateSystemPrompt(): string {
    const basePrompt = getSystemPrompt();
    const toolDescriptions = this.generateToolDescriptions();
    const availableTools = this.getAvailableTools();
    const toolNames = availableTools.map((tool) => tool.name);

    // Get tool metadata for custom instructions
    const registry = ToolRegistry.getInstance();
    const toolMetadata = availableTools
      .map((tool) => registry.getToolMetadata(tool.name))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);

    // Use model adapter for clean model-specific handling
    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const adapter = ModelAdapterFactory.createAdapter(chatModel);

    return adapter.enhanceSystemPrompt(basePrompt, toolDescriptions, toolNames, toolMetadata);
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
    const collectedSources: { title: string; path: string; score: number }[] = []; // Collect sources from localSearch
    this.llmFormattedMessages = []; // Reset LLM messages for this run
    const isPlusUser = await checkIsPlusUser();
    if (!isPlusUser) {
      await this.handleError(new Error("Invalid license key"), addMessage, updateCurrentAiMessage);
      return "";
    }

    try {
      // Get chat history from memory
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      // Use raw history to preserve multimodal content
      const rawHistory = memoryVariables.history || [];

      // Build initial conversation messages
      const customSystemPrompt = this.generateSystemPrompt();
      const chatModel = this.chainManager.chatModelManager.getChatModel();
      const adapter = ModelAdapterFactory.createAdapter(chatModel);

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
          (message) => {
            // Show tool calls as indicators during streaming for clarity, preserve think blocks
            const cleanedMessage = stripToolCallXML(message);
            // Build display with ALL content including tool calls from history
            const displayParts = [];

            // Add all iteration history (which includes tool call markers)
            displayParts.push(...iterationHistory);

            // Add current iteration's tool calls if any
            if (currentIterationToolCallMessages.length > 0) {
              displayParts.push(currentIterationToolCallMessages.join("\n"));
            }

            // Add the current streaming message
            if (cleanedMessage.trim()) {
              displayParts.push(cleanedMessage);
            }

            // Add tool call marker for the tool call that is being generated
            const toolName = extractToolNameFromPartialBlock(message);
            if (toolName) {
              const toolCallMarker = createToolCallMarker(
                "temporary-tool-call-id",
                toolName,
                getToolDisplayName(toolName),
                getToolEmoji(toolName),
                "", // confirmationMessage
                true, // isExecuting
                "", // content (empty for now)
                "" // result (empty until execution completes)
              );
              displayParts.push(toolCallMarker);
            }

            const currentDisplay = displayParts.join("\n\n");
            updateCurrentAiMessage(currentDisplay);
          },
          adapter
        );

        if (!response) break;

        // Parse tool calls from the response
        const toolCalls = parseXMLToolCalls(response);

        // Use model adapter to detect and handle premature responses
        const prematureResponseResult = adapter.detectPrematureResponse?.(response);
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
          const cleanedResponse = stripToolCallXML(response);

          // Build full response from history (which includes tool call markers) and final response
          const allParts = [...iterationHistory];
          if (cleanedResponse.trim()) {
            allParts.push(cleanedResponse);
          }
          fullAIResponse = allParts.join("\n\n");

          // Add final response to LLM messages
          this.llmFormattedMessages.push(response);
          break;
        }

        // Use model adapter to sanitize response if needed
        let sanitizedResponse = response;
        if (adapter.sanitizeResponse && prematureResponseResult?.hasPremature) {
          sanitizedResponse = adapter.sanitizeResponse(response, iteration);
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
            const toolDisplayName = getToolDisplayName(toolCall.name);
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

            currentIterationToolCallMessages.push(toolCallMarker);

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
                result.result
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

          // Collect sources from localSearch results
          if (toolCall.name === "localSearch" && result.success) {
            try {
              const searchResults = JSON.parse(result.result);
              if (Array.isArray(searchResults)) {
                const sources = searchResults.map((doc: any) => ({
                  title: doc.title || doc.path,
                  path: doc.path || doc.title || "",
                  score: doc.rerank_score || doc.score || 0,
                }));
                collectedSources.push(...sources);
              }
            } catch (e) {
              logWarn("Failed to parse localSearch results for sources:", e);
            }
          }
        }

        // Add all tool call messages to history so they persist
        if (currentIterationToolCallMessages.length > 0) {
          const toolCallsString = currentIterationToolCallMessages.join("\n");
          iterationHistory.push(toolCallsString);
        }

        // Don't add tool results to display - they're internal only

        // Track LLM-formatted messages for memory
        // Add the assistant's response with tool calls
        this.llmFormattedMessages.push(response);

        // Add tool results in LLM format (truncated for memory)
        if (toolResults.length > 0) {
          const toolResultsForLLM = processToolResults(toolResults, true); // truncated for memory
          if (toolResultsForLLM) {
            this.llmFormattedMessages.push(toolResultsForLLM);
          }
        }

        // Add AI response to conversation for next iteration
        conversationMessages.push({
          role: "assistant",
          content: response,
        });

        // Add tool results as user messages for next iteration (full results for current turn)
        const toolResultsForConversation = processToolResults(toolResults, false); // full results

        conversationMessages.push({
          role: "user",
          content: toolResultsForConversation,
        });

        logInfo("Tool results added to conversation:", toolResultsForConversation);
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

    return this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      uniqueSources.length > 0 ? uniqueSources : undefined,
      llmFormattedOutput
    );
  }

  private async streamResponse(
    messages: any[],
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    adapter: ModelAdapter
  ): Promise<string> {
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

        return streamer.close();
      } catch (error) {
        if (error.name === "AbortError" || abortController.signal.aborted) {
          return streamer.close();
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
    return streamer.close();
  }
}
