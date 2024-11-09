import ChatModelManager from "@/LLMProviders/chatModelManager";
import VectorStoreManager from "@/VectorStoreManager";
import { BREVILABS_API_BASE_URL } from "@/constants";
import { indexTool, localSearchTool } from "@/tools/SearchTools";
import {
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
  pomodoroTool,
  TimeInfo,
} from "@/tools/TimeTools";
import { ToolManager } from "@/tools/toolManager";
import { Notice } from "obsidian";

export const COPILOT_TOOL_NAMES = ["@vault", "@web", "@youtube", "@pomodoro", "@index"];

type ToolCall = {
  tool: any;
  args: any;
};

export class IntentAnalyzer {
  private static licenseKey: string;
  private static tools = [
    getCurrentTimeTool,
    getTimeInfoByEpochTool,
    getTimeRangeMsTool,
    localSearchTool,
    indexTool,
    pomodoroTool,
  ];

  static initialize(licenseKey: string) {
    this.licenseKey = licenseKey;
  }

  static async analyzeIntent(
    userMessage: string,
    vectorStoreManager: VectorStoreManager,
    chatModelManager: ChatModelManager
  ): Promise<ToolCall[]> {
    if (!this.licenseKey) {
      new Notice(
        "Copilot Plus license key not found. Please enter your license key in the settings."
      );
      throw new Error("License key not initialized");
    }
    // Call brevilabs broca API
    const response = await fetch(`${BREVILABS_API_BASE_URL}/broca`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.licenseKey}`,
      },
      body: JSON.stringify({
        message: userMessage,
      }),
    });

    const brocaResponse = await response.json();
    console.log("==== brocaResponse ====:", brocaResponse);

    try {
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
          },
        });
      }

      const indexRegex =
        /\b(?:index|create\s+an?\s+index)(?:\s+(?:the|my|all|this))?\s*(?:vault|notes?)?\b/i;
      if (
        indexRegex.test(userMessage.toLowerCase()) ||
        userMessage.toLowerCase().includes("@index")
      ) {
        processedToolCalls.push({
          tool: indexTool,
          args: { vectorStoreManager },
        });
      }

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
