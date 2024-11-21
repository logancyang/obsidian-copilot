import ChatModelManager from "@/LLMProviders/chatModelManager";
import VectorStoreManager from "@/VectorStoreManager";
import { indexTool, localSearchTool, webSearchTool } from "@/tools/SearchTools";
import {
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
  pomodoroTool,
  TimeInfo,
} from "@/tools/TimeTools";
import { ToolManager } from "@/tools/toolManager";
import { BrevilabsClient } from "./brevilabsClient";

// TODO: Add @index with explicit pdf files in chat context menu
export const COPILOT_TOOL_NAMES = ["@vault", "@web", "@youtube", "@pomodoro"];

type ToolCall = {
  tool: any;
  args: any;
};

export class IntentAnalyzer {
  private static tools = [
    getCurrentTimeTool,
    getTimeInfoByEpochTool,
    getTimeRangeMsTool,
    localSearchTool,
    indexTool,
    pomodoroTool,
    webSearchTool,
  ];

  static async analyzeIntent(
    originalMessage: string,
    vectorStoreManager: VectorStoreManager,
    chatModelManager: ChatModelManager,
    brevilabsClient: BrevilabsClient
  ): Promise<ToolCall[]> {
    try {
      // Only analyze the original message
      const brocaResponse = await brevilabsClient.broca(originalMessage);
      const brocaToolCalls = brocaResponse.response.tool_calls;
      const salientTerms = brocaResponse.response.salience_terms;

      const processedToolCalls: ToolCall[] = [];
      let timeRange: { startTime: TimeInfo; endTime: TimeInfo } | undefined;

      // Process tool calls from broca
      for (const brocaToolCall of brocaToolCalls) {
        const tool = this.tools.find((t) => t.name === brocaToolCall.tool);
        if (tool) {
          const args = brocaToolCall.args || {};

          if (tool.name === "getTimeRangeMs") {
            timeRange = await ToolManager.callTool(tool, args);
          }

          if (tool.name === "indexVault") {
            args.vectorStoreManager = vectorStoreManager;
          }

          processedToolCalls.push({ tool, args });
        }
      }

      // Process @ commands from original message only
      await this.processAtCommands(originalMessage, processedToolCalls, {
        timeRange,
        salientTerms,
        vectorStoreManager,
        chatModelManager,
        brevilabsClient,
      });

      return processedToolCalls;
    } catch (error) {
      console.error("Error in intent analysis:", error);
      return [];
    }
  }

  private static async processAtCommands(
    originalMessage: string,
    processedToolCalls: ToolCall[],
    context: {
      timeRange?: { startTime: TimeInfo; endTime: TimeInfo };
      salientTerms: string[];
      vectorStoreManager: VectorStoreManager;
      chatModelManager: ChatModelManager;
      brevilabsClient: BrevilabsClient;
    }
  ): Promise<void> {
    const message = originalMessage.toLowerCase();
    const { timeRange, salientTerms, vectorStoreManager, chatModelManager, brevilabsClient } =
      context;

    // Handle @vault command
    if (message.includes("@vault") && (salientTerms.length > 0 || timeRange)) {
      // Remove all @commands from the query
      const cleanQuery = this.removeAtCommands(originalMessage);

      processedToolCalls.push({
        tool: localSearchTool,
        args: {
          timeRange: timeRange || undefined,
          query: cleanQuery,
          salientTerms,
          vectorStoreManager,
          chatModelManager,
          brevilabsClient,
        },
      });
    }

    // Handle @web command
    if (message.includes("@web")) {
      const cleanQuery = this.removeAtCommands(originalMessage);
      processedToolCalls.push({
        tool: webSearchTool,
        args: {
          query: cleanQuery,
          brevilabsClient,
        },
      });
    }

    // Handle @pomodoro command
    if (message.includes("@pomodoro")) {
      const pomodoroMatch = originalMessage.match(/@pomodoro\s+(\S+)/i);
      const interval = pomodoroMatch ? pomodoroMatch[1] : "25min";
      processedToolCalls.push({
        tool: pomodoroTool,
        args: { interval },
      });
    }
  }

  private static removeAtCommands(message: string): string {
    return message
      .split(" ")
      .filter((word) => !COPILOT_TOOL_NAMES.includes(word.toLowerCase()))
      .join(" ")
      .trim();
  }
}
