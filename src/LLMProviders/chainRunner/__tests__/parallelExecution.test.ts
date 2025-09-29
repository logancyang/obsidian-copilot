jest.mock("@/LLMProviders/chainRunner/utils/toolExecution", () => ({
  executeToolCallsInParallel: jest.fn(),
  deduplicateSources: (sources: any[]) => sources,
  getToolDisplayName: jest.fn((name: string) => name),
  getToolEmoji: jest.fn(() => "🛠"),
  getToolConfirmationMessage: jest.fn(() => ""),
}));

jest.mock("@/LLMProviders/chainRunner/utils/parallelConfig", () => ({
  resolveParallelToolConfig: jest.fn(() => ({ useParallel: true, concurrency: 4 })),
}));

jest.mock("@/LLMProviders/chainRunner/utils/observability", () => ({
  emitToolSpan: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const { executeCoordinatorFlow } = require("@/LLMProviders/chainRunner/utils/parallelExecution");
const {
  executeToolCallsInParallel,
  getToolDisplayName,
  getToolEmoji,
} = require("@/LLMProviders/chainRunner/utils/toolExecution");
const { resolveParallelToolConfig } = require("@/LLMProviders/chainRunner/utils/parallelConfig");
const { emitToolSpan } = require("@/LLMProviders/chainRunner/utils/observability");
const { logInfo } = require("@/logger");
const { processToolResults } = require("@/utils/toolResultUtils");

describe("executeCoordinatorFlow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveParallelToolConfig.mockReturnValue({ useParallel: true, concurrency: 4 });
    (getToolDisplayName as jest.Mock).mockImplementation((name: string) => name);
    (getToolEmoji as jest.Mock).mockReturnValue("🛠");
  });

  it("updates markers for visible tools only and records telemetry", async () => {
    const abortController = new AbortController();
    const updateCurrentAiMessage = jest.fn();

    const params = {
      toolCalls: [
        { name: "visibleTool", args: {} },
        { name: "backgroundTool", args: {} },
      ],
      iterationHistory: [],
      currentIterationToolCallMessages: [
        '<marker id="temp-visibleTool-0"></marker>',
        '<marker id="temp-backgroundTool-1"></marker>',
      ],
      updateCurrentAiMessage,
      originalUserPrompt: "prompt",
      collectedSources: [],
      abortController,
      availableTools: [
        { name: "visibleTool", isBackground: false },
        { name: "backgroundTool", isBackground: true },
      ],
      getTemporaryToolCallId: (name: string, index: number) => `temp-${name}-${index}`,
      processLocalSearchResult: () => ({
        formattedForLLM: "<localSearch>result</localSearch>",
        formattedForDisplay: "result",
        sources: [],
      }),
    };

    (executeToolCallsInParallel as jest.Mock).mockImplementation(
      async (_calls: any, context: any) => {
        context.hooks?.onStart?.(0, { name: "visibleTool", background: false });
        context.hooks?.onStart?.(1, { name: "backgroundTool", background: true });

        context.hooks?.onSettle?.(0, {
          index: 0,
          name: "visibleTool",
          status: "ok",
          payload: "visible-data",
        });
        context.hooks?.onSettle?.(1, {
          index: 1,
          name: "backgroundTool",
          status: "ok",
          payload: "background-data",
        });

        return [
          { index: 0, name: "visibleTool", status: "ok", payload: "visible-data" },
          { index: 1, name: "backgroundTool", status: "ok", payload: "background-data" },
        ];
      }
    );

    const execution = await executeCoordinatorFlow(params);

    expect(execution.toolResults).toHaveLength(2);
    expect(execution.toolResults[0]).toMatchObject({ success: true, result: "visible-data" });
    expect(execution.toolResults[1]).toMatchObject({ success: true, result: "background-data" });

    const updatedMessages = execution.updatedMessages as string[];
    expect(updatedMessages[0]).toContain("visible-data");
    expect(updatedMessages[1]).toContain("temp-backgroundTool-1");

    expect(updateCurrentAiMessage).toHaveBeenCalled();
    expect(
      (logInfo as jest.Mock).mock.calls.some(
        (call: any[]) => call[0] === "[parallel] execution summary"
      )
    ).toBe(true);
  });

  it("preserves prompt aggregation parity with sequential flow", async () => {
    const abortController = new AbortController();
    const params = {
      toolCalls: [
        { name: "visibleTool", args: {} },
        { name: "backgroundTool", args: {} },
      ],
      iterationHistory: [],
      currentIterationToolCallMessages: [
        '<marker id="temp-visibleTool-0"></marker>',
        '<marker id="temp-backgroundTool-1"></marker>',
      ],
      updateCurrentAiMessage: jest.fn(),
      originalUserPrompt: "prompt",
      collectedSources: [],
      abortController,
      availableTools: [
        { name: "visibleTool", isBackground: false },
        { name: "backgroundTool", isBackground: true },
      ],
      getTemporaryToolCallId: (name: string, index: number) => `temp-${name}-${index}`,
      processLocalSearchResult: () => ({
        formattedForLLM: "<localSearch>result</localSearch>",
        formattedForDisplay: "result",
        sources: [],
      }),
    };

    (executeToolCallsInParallel as jest.Mock).mockImplementation(
      async (_calls: any, context: any) => {
        context.hooks?.onStart?.(0, { name: "visibleTool", background: false });
        context.hooks?.onStart?.(1, { name: "backgroundTool", background: true });

        context.hooks?.onSettle?.(0, {
          index: 0,
          name: "visibleTool",
          status: "ok",
          payload: "visible-data",
        });
        context.hooks?.onSettle?.(1, {
          index: 1,
          name: "backgroundTool",
          status: "ok",
          payload: "background-data",
        });

        return [
          { index: 0, name: "visibleTool", status: "ok", payload: "visible-data" },
          { index: 1, name: "backgroundTool", status: "ok", payload: "background-data" },
        ];
      }
    );

    const parallelExecution = await executeCoordinatorFlow(params);

    const sequentialResults = [
      { toolName: "visibleTool", result: "visible-data", success: true },
      { toolName: "backgroundTool", result: "background-data", success: true },
    ];

    const parallelAggregation = processToolResults(parallelExecution.toolResults, false);
    const sequentialAggregation = processToolResults(sequentialResults, false);

    expect(parallelAggregation).toEqual(sequentialAggregation);
  });

  it("suppresses marker updates after abort", async () => {
    const abortController = new AbortController();
    const updateCurrentAiMessage = jest.fn();

    const params = {
      toolCalls: [{ name: "visibleTool", args: {} }],
      iterationHistory: [],
      currentIterationToolCallMessages: ['<marker id="temp-visibleTool-0"></marker>'],
      updateCurrentAiMessage,
      originalUserPrompt: undefined,
      collectedSources: [],
      abortController,
      availableTools: [{ name: "visibleTool", isBackground: false }],
      getTemporaryToolCallId: (name: string, index: number) => `temp-${name}-${index}`,
      processLocalSearchResult: () => ({
        formattedForLLM: "<localSearch>result</localSearch>",
        formattedForDisplay: "result",
        sources: [],
      }),
    };

    (executeToolCallsInParallel as jest.Mock).mockImplementation(
      async (_calls: any, context: any) => {
        context.hooks?.onStart?.(0, { name: "visibleTool", background: false });
        abortController.abort();
        context.hooks?.onSettle?.(0, {
          index: 0,
          name: "visibleTool",
          status: "cancelled",
          error: "Aborted",
        });
        return [{ index: 0, name: "visibleTool", status: "cancelled", error: "Aborted" }];
      }
    );

    const execution = await executeCoordinatorFlow(params);

    expect(execution.toolResults).toHaveLength(1);
    expect(execution.toolResults[0]).toMatchObject({ success: false, result: "Aborted" });
    expect((execution.updatedMessages as string[])[0]).toContain("Aborted");
    expect(updateCurrentAiMessage).toHaveBeenCalled();
  });

  it("records span durations for telemetry analysis", async () => {
    const abortController = new AbortController();
    const params = {
      toolCalls: [
        { name: "toolA", args: {} },
        { name: "toolB", args: {} },
      ],
      iterationHistory: [],
      currentIterationToolCallMessages: [],
      updateCurrentAiMessage: jest.fn(),
      originalUserPrompt: undefined,
      collectedSources: [],
      abortController,
      availableTools: [
        { name: "toolA", isBackground: false },
        { name: "toolB", isBackground: false },
      ],
      getTemporaryToolCallId: (name: string, index: number) => `temp-${name}-${index}`,
      processLocalSearchResult: () => ({
        formattedForLLM: "result",
        formattedForDisplay: "result",
        sources: [],
      }),
    };

    let now = 0;
    const dateSpy = jest.spyOn(Date, "now").mockImplementation(() => now);

    (executeToolCallsInParallel as jest.Mock).mockImplementation(
      async (_calls: any, context: any) => {
        now = 0;
        context.hooks?.onStart?.(0, { name: "toolA", background: false });
        now = 5;
        context.hooks?.onSettle?.(0, {
          index: 0,
          name: "toolA",
          status: "ok",
          payload: "A",
        });

        now = 5;
        context.hooks?.onStart?.(1, { name: "toolB", background: false });
        now = 9;
        context.hooks?.onSettle?.(1, {
          index: 1,
          name: "toolB",
          status: "ok",
          payload: "B",
        });

        return [
          { index: 0, name: "toolA", status: "ok", payload: "A" },
          { index: 1, name: "toolB", status: "ok", payload: "B" },
        ];
      }
    );

    await executeCoordinatorFlow(params);
    dateSpy.mockRestore();

    const summaryCall = (logInfo as jest.Mock).mock.calls.find(
      (call: any[]) => call[0] === "[parallel] execution summary"
    );
    expect(summaryCall).toBeDefined();
    const summaryPayload = summaryCall?.[1];
    expect(summaryPayload.durations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, durationMs: 5 }),
        expect.objectContaining({ index: 1, durationMs: 4 }),
      ])
    );
    const sequentialTotal = summaryPayload.durations.reduce(
      (sum: number, item: any) => sum + item.durationMs,
      0
    );
    const parallelTotal = Math.max(...summaryPayload.durations.map((item: any) => item.durationMs));
    expect(parallelTotal).toBeLessThan(sequentialTotal);
  });
});
