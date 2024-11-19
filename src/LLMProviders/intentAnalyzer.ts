import ChatModelManager from "@/LLMProviders/chatModelManager";
import VectorStoreManager from "@/VectorStoreManager";
import { indexTool, localSearchTool } from "@/tools/SearchTools";
import {
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
  pomodoroTool,
  TimeInfo,
} from "@/tools/TimeTools";
import { ToolManager } from "@/tools/toolManager";
import { BrevilabsClient } from "./brevilabsClient";

export const COPILOT_TOOL_NAMES = ["@vault", "@web", "@youtube", "@pomodoro", "@index"];

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
  ];

  static async analyzeIntent(
    userMessage: string,
    vectorStoreManager: VectorStoreManager,
    chatModelManager: ChatModelManager,
    brevilabsClient: BrevilabsClient
  ): Promise<ToolCall[]> {
    let brocaResponse;
    try {
      brocaResponse = await brevilabsClient.broca(userMessage);
      const brocaToolCalls = brocaResponse.response.tool_calls;

      const processedToolCalls: ToolCall[] = [];
      let timeRange: { startTime: TimeInfo; endTime: TimeInfo } | undefined;
      const salientTerms = brocaResponse.response.salience_terms;

      console.log("Initial toolCalls from IntentAnalyzer:", brocaToolCalls);
      for (const brocaToolCall of brocaToolCalls) {
        const tool = this.tools.find((t) => t.name === brocaToolCall.tool);
        if (tool) {
          const args = brocaToolCall.args || {};

          if (tool.name === "getTimeRangeMs") {
            // Execute getTimeRangeMs tool and store the result
            const result = await ToolManager.callTool(tool, args);
            timeRange = result;
          }

          if (tool.name === "indexVault") {
            args.vectorStoreManager = vectorStoreManager;
          }

          processedToolCalls.push({ tool, args });
        }
      }

      // Add localSearchTool if there are salient terms or a time range
      if (userMessage.toLowerCase().includes("@vault") && (salientTerms.length > 0 || timeRange)) {
        processedToolCalls.push({
          tool: localSearchTool,
          args: {
            timeRange: timeRange || undefined,
            // TODO: Remove all @tools from the query
            query: userMessage.replace("@vault", "").trim(),
            salientTerms,
            vectorStoreManager,
            chatModelManager,
            brevilabsClient,
          },
        });
      }

      // TODO: Re-enable this for indexing pdfs and other files in the vault
      // const indexRegex =
      //   /\b(?:index|create\s+an?\s+index)(?:\s+(?:the|my|all|this))?\s*(?:vault|notes?)?\b/i;
      // if (
      //   indexRegex.test(userMessage.toLowerCase()) ||
      //   userMessage.toLowerCase().includes("@index")
      // ) {
      //   processedToolCalls.push({
      //     tool: indexTool,
      //     args: { vectorStoreManager },
      //   });
      // }

      if (userMessage.toLowerCase().includes("@pomodoro")) {
        const pomodoroMatch = userMessage.match(/@pomodoro\s+(\S+)/i);
        const interval = pomodoroMatch ? pomodoroMatch[1] : "25min";
        processedToolCalls.push({
          tool: pomodoroTool,
          args: { interval },
        });
      }

      return processedToolCalls;
    } catch (error) {
      console.error("Error parsing LLM response:", error, brocaResponse);
      return [];
    }
  }
}
