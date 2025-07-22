import { logError, logInfo, logWarn } from "@/logger";
import { getSystemPrompt } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { createGetFileTreeTool } from "@/tools/FileTreeTools";
import { indexTool, localSearchTool, webSearchTool } from "@/tools/SearchTools";
import {
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
  pomodoroTool,
} from "@/tools/TimeTools";
import { simpleYoutubeTranscriptionTool } from "@/tools/YoutubeTools";
import {
  extractAllYoutubeUrls,
  extractChatHistory,
  getMessageRole,
  withSuppressedTokenWarnings,
} from "@/utils";
import { CopilotPlusChainRunner } from "./CopilotPlusChainRunner";
import { messageRequiresTools, ModelAdapter, ModelAdapterFactory } from "./utils/modelAdapter";
import { ThinkBlockStreamer } from "./utils/ThinkBlockStreamer";
import {
  deduplicateSources,
  executeSequentialToolCall,
  getToolDisplayName,
  getToolEmoji,
  logToolCall,
  logToolResult,
  ToolExecutionResult,
} from "./utils/toolExecution";
import { parseXMLToolCalls, stripToolCallXML, escapeXml } from "./utils/xmlParsing";
import { writeToFileTool } from "@/tools/ComposerTools";
import { getToolConfirmtionMessage } from "./utils/toolExecution";
import { MessageContent } from "@/imageProcessing/imageProcessor";

export class AutonomousAgentChainRunner extends CopilotPlusChainRunner {
  private llmFormattedMessages: string[] = []; // Track LLM-formatted messages for memory

  /**
   * Process YouTube URLs in the user message and fetch transcriptions
   * @returns Array of conversation messages to add to the context
   */
  private async processYouTubeUrls(
    userMessage: string,
    updateCurrentAiMessage: (message: string) => void
  ): Promise<Array<{ role: string; content: string }>> {
    const youtubeUrls = extractAllYoutubeUrls(userMessage);
    if (youtubeUrls.length === 0) {
      return [];
    }

    updateCurrentAiMessage("🎥 Fetching YouTube transcription...");
    const transcriptions: string[] = [];

    for (const url of youtubeUrls) {
      try {
        const result = await simpleYoutubeTranscriptionTool.invoke({ url });
        const parsedResult = JSON.parse(result);

        if (parsedResult.success) {
          transcriptions.push(
            `<youtube_transcription>\n` +
              `<url>${escapeXml(url)}</url>\n` +
              `<transcript>\n${escapeXml(parsedResult.transcript)}\n</transcript>\n` +
              `</youtube_transcription>`
          );
        } else {
          transcriptions.push(
            `<youtube_transcription>\n` +
              `<url>${escapeXml(url)}</url>\n` +
              `<error>${escapeXml(parsedResult.message)}</error>\n` +
              `</youtube_transcription>`
          );
        }
      } catch (error) {
        logInfo(`Error transcribing YouTube video ${url}:`, error);
        transcriptions.push(
          `<youtube_transcription>\n` +
            `<url>${escapeXml(url)}</url>\n` +
            `<error>Failed to fetch transcription</error>\n` +
            `</youtube_transcription>`
        );
      }
    }

    if (transcriptions.length === 0) {
      return [];
    }

    // Return the conversation messages to add
    const transcriptionContext = transcriptions.join("\n\n");
    return [
      {
        role: "assistant",
        content: `I've fetched the YouTube transcription(s):\n\n${transcriptionContext}`,
      },
      {
        role: "user",
        content:
          "Please analyze or respond to my original request using the YouTube transcription(s) provided above.",
      },
    ];
  }

  private getAvailableTools(): any[] {
    // Get tools from the existing IntentAnalyzer
    const tools: any[] = [
      localSearchTool,
      webSearchTool,
      pomodoroTool,
      simpleYoutubeTranscriptionTool,
      getCurrentTimeTool,
      getTimeInfoByEpochTool,
      getTimeRangeMsTool,
      indexTool,
      writeToFileTool,
    ];

    // Add file tree tool if available
    if (this.chainManager.app?.vault) {
      const fileTreeTool = createGetFileTreeTool(this.chainManager.app.vault.getRoot());
      tools.push(fileTreeTool);
    }

    return tools;
  }

  private generateToolDescriptions(): string {
    const tools = this.getAvailableTools();
    return tools
      .map((tool) => {
        const schema = tool.schema || {};
        const params = schema.properties
          ? Object.entries(schema.properties)
              .map(
                ([key, val]: [string, any]) =>
                  `  - ${escapeXml(key)}: ${escapeXml(val.description || "No description")}`
              )
              .join("\n")
          : "";

        return `<${escapeXml(tool.name)}>
+<description>${escapeXml(tool.description)}</description>
+<parameters>
+${params}
+</parameters>
+</${escapeXml(tool.name)}>`;
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

    // Use model adapter for clean model-specific handling
    const chatModel = this.chainManager.chatModelManager.getChatModel();
    const adapter = ModelAdapterFactory.createAdapter(chatModel);

    return adapter.enhanceSystemPrompt(basePrompt, toolDescriptions);
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

    try {
      // Get chat history from memory
      const memory = this.chainManager.memoryManager.getMemory();
      const memoryVariables = await memory.loadMemoryVariables({});
      const chatHistory = extractChatHistory(memoryVariables);

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

      // Add chat history
      for (const entry of chatHistory) {
        conversationMessages.push({ role: entry.role, content: entry.content });
      }

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

      // Process YouTube URLs if present
      const youtubeMessages = await this.processYouTubeUrls(
        userMessage.message,
        updateCurrentAiMessage
      );
      conversationMessages.push(...youtubeMessages);

      // Autonomous agent loop
      const maxIterations = 4; // Prevent infinite loops while allowing sufficient reasoning
      let iteration = 0;

      while (iteration < maxIterations) {
        if (abortController.signal.aborted) {
          break;
        }

        iteration++;
        logInfo(`=== Autonomous Agent Iteration ${iteration} ===`);

        // Get AI response
        const response = await this.streamResponse(
          conversationMessages,
          abortController,
          (message) => {
            // Show tool calls as indicators during streaming for clarity, preserve think blocks
            const cleanedMessage = stripToolCallXML(message);
            const currentDisplay = [...iterationHistory, cleanedMessage].join("\n\n");
            updateCurrentAiMessage(currentDisplay);
          },
          adapter
        );

        if (!response) break;

        // Parse tool calls from the response
        const toolCalls = parseXMLToolCalls(response);

        // Debug logging for tool call parsing
        logInfo(`=== Iteration ${iteration} Response Analysis ===`);
        logInfo(`Response length: ${response.length} characters`);
        logInfo(`Parsed tool calls: ${toolCalls.length}`);

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
          logInfo("No XML tool calls found in response:");
          logInfo(response.substring(0, 500) + (response.length > 500 ? "..." : ""));
        } else {
          logInfo(
            "Found tool calls:",
            toolCalls.map((tc) => tc.name)
          );
        }

        if (toolCalls.length === 0) {
          // No tool calls, this is the final response
          // Strip any tool call XML from final response but preserve think blocks
          const cleanedResponse = stripToolCallXML(response);
          fullAIResponse = [...iterationHistory, cleanedResponse].join("\n\n");

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
        const toolCallMessages: string[] = [];

        for (const toolCall of toolCalls) {
          if (abortController.signal.aborted) break;

          // Log tool call details for debugging
          logToolCall(toolCall, iteration);

          // Create tool calling message with better spacing and display name
          const toolEmoji = getToolEmoji(toolCall.name);
          const toolDisplayName = getToolDisplayName(toolCall.name);
          let toolMessage = `${toolEmoji} *Calling ${toolDisplayName}...*`;
          const confirmationMessage = getToolConfirmtionMessage(toolCall.name);
          if (confirmationMessage) {
            toolMessage += `\n⏳ *${confirmationMessage}...*`;
          }
          const toolCallingMessage = `<br/>\n\n${toolMessage}\n\n<br/>`;
          toolCallMessages.push(toolCallingMessage);

          // Show all history plus all tool call messages
          const currentDisplay = [...iterationHistory, ...toolCallMessages].join("\n\n");
          updateCurrentAiMessage(currentDisplay);

          const result = await executeSequentialToolCall(toolCall, this.getAvailableTools());
          toolResults.push(result);

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
        if (toolCallMessages.length > 0) {
          iterationHistory.push(toolCallMessages.join("\n"));
        }

        // Don't add tool results to display - they're internal only

        // Track LLM-formatted messages for memory
        // Add the assistant's response with tool calls
        this.llmFormattedMessages.push(response);

        // Add tool results in LLM format
        if (toolResults.length > 0) {
          const toolResultsForLLM = toolResults
            .map((result) => `Tool '${result.toolName}' result: ${result.result}`)
            .join("\n\n");
          this.llmFormattedMessages.push(toolResultsForLLM);
        }

        // Add AI response to conversation for next iteration
        conversationMessages.push({
          role: "assistant",
          content: response,
        });

        // Add tool results as user messages for next iteration
        const toolResultsForConversation = toolResults
          .map((result) => `Tool '${result.toolName}' result: ${result.result}`)
          .join("\n\n");

        conversationMessages.push({
          role: "user",
          content: toolResultsForConversation,
        });

        logInfo("Tool results added to conversation:", toolResultsForConversation);
      }

      // If we hit max iterations, the last response becomes the final one
      if (iteration >= maxIterations && !fullAIResponse) {
        fullAIResponse = iterationHistory.join("\n\n");
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
