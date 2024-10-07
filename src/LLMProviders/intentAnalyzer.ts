import ChatModelManager from "@/LLMProviders/chatModelManager";
import VectorStoreManager from "@/VectorStoreManager";
import { getSalientTermsTool, indexTool, localSearchTool } from "@/tools/SearchTools";
import {
  getCurrentTimeTool,
  getTimeInfoByEpochTool,
  getTimeRangeMsTool,
  pomodoroTool,
  TimeInfo,
} from "@/tools/TimeTools";
import { ToolManager } from "@/tools/toolManager";
import { extractJsonFromCodeBlock } from "@/utils";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export const COPILOT_TOOL_NAMES = ["@vault", "@web", "@youtube", "@pomodoro", "@index"];

type ToolCall = {
  tool: any;
  args: any;
};

export class IntentAnalyzer {
  private static chatModelManager: ChatModelManager;
  private static tools = [
    getCurrentTimeTool,
    getTimeInfoByEpochTool,
    getTimeRangeMsTool,
    localSearchTool,
    getSalientTermsTool,
    indexTool,
    pomodoroTool,
  ];

  static initialize(chatModelManager: ChatModelManager) {
    this.chatModelManager = chatModelManager;
  }

  static async analyzeIntent(
    userMessage: string,
    vectorStoreManager: VectorStoreManager,
    chatModelManager: ChatModelManager
  ): Promise<ToolCall[]> {
    // NOTE: Output in JSON format only. Some weaker LLMs can return non-JSON outputs,
    // so we need to wrap the output in a try-catch block to prevent the plugin from crashing.
    const systemPrompt = `
      You are tasked with determining which tools, if any, are needed to answer a user's query. Output your response in **JSON format only**.
      Available tools:
      1. getCurrentTime: Gets the current time info, including unix time, local time, and timezone.
      2. getTimeRangeMs: Gets a time range [startTime<TimeInfo>, endTime<TimeInfo>] based on user time expressions.
      3. getTimeInfoByEpoch: Gets the time info based on a Unix timestamp (in seconds or milliseconds).

      Respond with a JSON array of objects containing the tool name and any necessary arguments.

      Examples are provided below.

      ## Single point in time queries
      Use the getCurrentTime tool for all queries that ask for the current time-related information, or a specific point in time that is relative to now, or any planning related to the current time.

      Input: "What is the time now?"
      Output: [{"tool": "getCurrentTime"}]

      Input: "What is the time in UTC now?"
      Output: [{"tool": "getCurrentTime"}]

      Input: "What is the unix time?"
      Output: [{"tool": "getCurrentTime"}]

      Input: "What is the local time?"
      Output: [{"tool": "getCurrentTime"}]

      Input: "How many days until January 1st 2025?"
      Output: [{"tool": "getCurrentTime"}]

      Input: "Given my current progress, what should be my pace if I'd like to finish all the books before the end of 2024?"
      Output: [{"tool": "getCurrentTime"}]

      ## Time range queries
      For the getTimeRangeMs tool, extract a single "timeExpression" argument that captures the entire time-related part of the user's query. Invoke this tool for queries that ask for a time range in the past, usually used for searching past notes by metadata.

      Here are some examples:

      Input: "what did i do last week?"
      Output: [{"tool": "getTimeRangeMs", "args": {"timeExpression": "last week"}}]

      Input: "what did i write about topic X last month?"
      Output: [{"tool": "getTimeRangeMs", "args": {"timeExpression": "last month"}}]

      Input: "Summarize my notes from the week of 2024-07-20"
      Output: [{"tool": "getTimeRangeMs", "args": {"timeExpression": "week of 2024-07-20"}}]

      Input: "What notes did I write yesterday?"
      Output: [{"tool": "getTimeRangeMs", "args": {"timeExpression": "yesterday"}}]

      Input: "Find all my notes from August"
      Output: [{"tool": "getTimeRangeMs", "args": {"timeExpression": "August"}}]

      Input: "What notes did I write from July 20 to July 25, 2024?"
      Output: [{"tool": "getTimeRangeMs", "args": {"timeExpression": "from July 20 to July 25, 2024"}}]

      ## Unix timestamp queries
      Use the getTimeInfoByEpoch tool for queries that ask for a specific point in time using a Unix timestamp (in seconds or milliseconds).

      Input: "What is the date for 1727679600000?"
      Output: [{"tool": "getTimeInfoByEpoch", "args": {"epoch": 1727679600000}}]

      Input: "What is the time for 1728623366?"
      Output: [{"tool": "getTimeInfoByEpoch", "args": {"epoch": 1728623366}}]

      ## Open-ended queries with no specific time range
      Input: "what did I write about topic X"
      Output: []

      Input: "Summarize #projectX"
      Output: []

      Input: "Have I renewed my passport?"
      Output: []

      Analyze the user's message and provide the appropriate tool calls.
      Output (provide only the JSON array, no additional text, must not be in a markdown code block):
    `;

    const llm = this.chatModelManager.getChatModel();
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ]);

    try {
      const toolCalls = extractJsonFromCodeBlock(response.content as string);
      // Always add the getSalientTerms tool call
      toolCalls.push({
        tool: "getSalientTerms",
        args: { query: userMessage, llm },
      });

      const processedToolCalls: ToolCall[] = [];
      let timeRange: { startTime: TimeInfo; endTime: TimeInfo } | undefined;
      let salientTerms: string[] = [];
      console.log("Initial toolCalls from IntentAnalyzer:", toolCalls);
      for (const call of toolCalls) {
        const tool = this.tools.find((t) => t.name === call.tool);
        if (tool) {
          const args = call.args || {};

          if (tool.name === "getTimeRangeMs") {
            // Execute getTimeRangeMs tool and store the result
            const result = await ToolManager.callTool(tool, args);
            timeRange = result;
          }

          if (tool.name === "getSalientTerms") {
            // Execute getSalientTerms tool and store the result
            const terms = await ToolManager.callTool(tool, args);
            salientTerms = terms;
            console.log("salientTerms:", salientTerms);
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
            timeRange,
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
      console.error("Error parsing LLM response:", error, response.content);
      return [];
    }
  }
}
