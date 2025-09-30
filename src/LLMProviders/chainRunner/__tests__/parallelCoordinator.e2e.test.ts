import { createTool } from "@/tools/SimpleTool";
import { z } from "zod";
import { executeCoordinatorFlow } from "@/LLMProviders/chainRunner/utils/parallelExecution";
import { executeSequentialToolCall } from "@/LLMProviders/chainRunner/utils/toolExecution";
import { ToolManager } from "@/tools/toolManager";
import { processToolResults } from "@/utils/toolResultUtils";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    parallelToolCalls: { enabled: true, concurrency: 4 },
    enableSemanticSearchV3: false,
  })),
  getSystemPrompt: jest.fn(() => ""),
}));

jest.mock("@/plusUtils", () => ({
  checkIsPlusUser: jest.fn(async () => true),
}));

jest.mock("@/tools/toolManager", () => ({
  ToolManager: {
    callTool: jest.fn(),
  },
}));

jest.mock("@/utils", () => ({
  err2String: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

describe("Parallel coordinator synthetic harness", () => {
  jest.setTimeout(10000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("matches sequential aggregation for mixed-latency tool calls", async () => {
    const alphaTool = createTool({
      name: "alpha",
      description: "Alpha tool",
      schema: z.object({ payload: z.string(), delayMs: z.number() }),
      handler: async ({ payload, delayMs }) => {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        return `alpha:${payload}`;
      },
    });

    const betaTool = createTool({
      name: "beta",
      description: "Beta tool",
      schema: z.object({ payload: z.string(), delayMs: z.number() }),
      handler: async ({ payload, delayMs }) => {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        return `beta:${payload}`;
      },
    });

    const shadowTool = createTool({
      name: "shadow",
      description: "Background tool",
      schema: z.object({ payload: z.string(), delayMs: z.number() }),
      handler: async ({ payload, delayMs }) => {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        return `shadow:${payload}`;
      },
      isBackground: true,
    });

    const availableTools = [alphaTool, betaTool, shadowTool];

    const mockCallTool = ToolManager.callTool as jest.Mock;
    mockCallTool.mockImplementation(async (tool, args: any) => tool.call(args));

    const toolCalls = [
      { name: "alpha", args: { payload: "A", delayMs: 25 } },
      { name: "beta", args: { payload: "B", delayMs: 5 } },
      { name: "shadow", args: { payload: "S", delayMs: 15 } },
    ];

    const sequentialResults = [];
    for (const call of toolCalls) {
      const result = await executeSequentialToolCall(call, availableTools, "prompt");
      sequentialResults.push(result);
    }

    const sequentialAggregation = processToolResults(
      sequentialResults.map(({ toolName, result }) => ({ toolName, result })),
      false
    );

    const abortController = new AbortController();
    const updateCurrentAiMessage = jest.fn();
    const initialMarkers = toolCalls.map(
      (call, index) => `<marker id="temp-${call.name}-${index}"></marker>`
    );

    const coordinatorExecution = await executeCoordinatorFlow({
      toolCalls,
      iterationHistory: [],
      currentIterationToolCallMessages: [...initialMarkers],
      updateCurrentAiMessage,
      originalUserPrompt: "prompt",
      collectedSources: [],
      abortController,
      availableTools,
      getTemporaryToolCallId: (name, index) => `temp-${name}-${index}`,
      processLocalSearchResult: ({ result: formatted }) => ({
        formattedForLLM: formatted,
        formattedForDisplay: formatted,
        sources: [],
      }),
    });

    const parallelAggregation = processToolResults(
      coordinatorExecution.toolResults.map(({ toolName, result }) => ({ toolName, result })),
      false
    );

    expect(parallelAggregation).toEqual(sequentialAggregation);
    expect(coordinatorExecution.toolResults.map((result) => result.result)).toEqual([
      "alpha:A",
      "beta:B",
      "shadow:S",
    ]);

    // Background tool markers should remain placeholders while foreground markers are updated.
    const [alphaMarker, betaMarker, shadowMarker] = coordinatorExecution.updatedMessages;
    expect(alphaMarker).toContain("TOOL_CALL_END:alpha");
    expect(betaMarker).toContain("TOOL_CALL_END:beta");
    expect(shadowMarker).toContain("temp-shadow-2");

    expect(updateCurrentAiMessage).toHaveBeenCalled();
  });
});
