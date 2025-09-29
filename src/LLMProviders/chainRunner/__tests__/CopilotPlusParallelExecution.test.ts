import { ToolManager } from "@/tools/toolManager";
import { resolveParallelToolConfig } from "@/LLMProviders/chainRunner/utils/parallelConfig";
import { executeCoordinatorFlow } from "@/LLMProviders/chainRunner/utils/parallelExecution";
import { LOADING_MESSAGES } from "@/constants";
import { CopilotPlusChainRunner } from "@/LLMProviders/chainRunner/CopilotPlusChainRunner";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/chainUtils", () => ({
  getStandaloneQuestion: jest.fn(() => "standalone question"),
}));

jest.mock("@/imageProcessing/imageProcessor", () => ({
  ImageBatchProcessor: {
    processUrlBatch: jest.fn(async () => []),
    processChatImageBatch: jest.fn(async () => []),
    showFailedImagesNotice: jest.fn(),
  },
}));

jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: () => ({
      broca: jest.fn(async () => ({ response: { tool_calls: [], salience_terms: [] } })),
      youtube4llm: jest.fn(async () => ({ response: { transcript: "" } })),
    }),
  },
}));

jest.mock("@/LLMProviders/intentAnalyzer", () => {
  const tools: any[] = [];
  return {
    COPILOT_TOOL_NAMES: [],
    IntentAnalyzer: {
      analyzeIntent: jest.fn(async () => []),
      initTools: jest.fn(),
      get tools() {
        return tools;
      },
      set tools(values) {
        tools.splice(0, tools.length, ...(values ?? []));
      },
    },
  };
});

jest.mock("@/plusUtils", () => ({
  checkIsPlusUser: jest.fn(async () => true),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ parallelToolCalls: { enabled: true, concurrency: 4 } })),
  getSystemPrompt: jest.fn(() => ""),
}));

jest.mock("@/tools/ComposerTools", () => ({
  writeToFileTool: {},
}));

jest.mock("@/utils", () => ({
  extractYoutubeUrl: jest.fn(() => null),
  getApiErrorMessage: jest.fn((error) => String(error)),
  getMessageRole: jest.fn(() => "user"),
  withSuppressedTokenWarnings: jest.fn((fn) => fn()),
}));

jest.mock("@langchain/core/language_models/chat_models", () => ({
  BaseChatModel: class {},
}));

jest.mock("@langchain/core/output_parsers", () => ({}));
jest.mock("@langchain/core/prompts", () => ({}));
jest.mock("@langchain/core/retrievers", () => ({}));
jest.mock("@langchain/core/runnables", () => ({}));

jest.mock("@/tools/toolManager", () => ({
  ToolManager: {
    callTool: jest.fn(),
  },
}));

jest.mock("@/LLMProviders/chainRunner/utils/parallelConfig", () => ({
  resolveParallelToolConfig: jest.fn(() => ({ useParallel: true, concurrency: 4 })),
}));

jest.mock("@/LLMProviders/chainRunner/utils/parallelExecution", () => ({
  executeCoordinatorFlow: jest.fn(),
}));

const buildRunner = () => new CopilotPlusChainRunner({} as any);
const mockedExecuteCoordinatorFlow = jest.mocked(executeCoordinatorFlow);
const mockedResolveParallelToolConfig = jest.mocked(resolveParallelToolConfig);
const mockedToolManager = jest.mocked(ToolManager);

describe("CopilotPlusChainRunner parallel tool execution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes tool execution through the coordinator when parallel mode is enabled", async () => {
    const abortController = new AbortController();
    const runner = buildRunner();
    const toolCalls = [
      { tool: { name: "localSearch", isBackground: false }, args: { query: "foo" } },
      { tool: { name: "webSearch", isBackground: false }, args: { query: "foo" } },
    ];

    mockedExecuteCoordinatorFlow.mockImplementation(async (config) => {
      const payload = JSON.stringify({
        type: "local_search",
        documents: [
          {
            title: "Doc",
            content: "Content",
            path: "Doc.md",
            score: 0.9,
            includeInContext: true,
          },
        ],
      });
      const processed = config.processLocalSearchResult({ result: payload, success: true });
      config.collectedSources.push({
        title: "Doc",
        path: "Doc.md",
        score: 0.9,
      });

      return {
        toolResults: [
          { toolName: "localSearch", result: processed.formattedForLLM, success: true },
          { toolName: "webSearch", result: '{"status":"ok"}', success: true },
        ],
        updatedMessages: [],
      };
    });

    const result = await (runner as any).executeToolCalls({
      toolCalls,
      abortController,
      updateLoadingMessage: jest.fn(),
      updateCurrentAiMessage: jest.fn(),
      originalUserMessage: "question",
    });

    expect(mockedExecuteCoordinatorFlow).toHaveBeenCalledTimes(1);
    const config = mockedExecuteCoordinatorFlow.mock.calls[0][0];
    expect(config.availableTools).toHaveLength(2);
    expect(config.abortController).toBe(abortController);

    expect(result.toolOutputs).toEqual([
      { tool: "localSearch", output: expect.stringContaining("<localSearch") },
      { tool: "webSearch", output: '{"status":"ok"}' },
    ]);
    expect(result.sources).toHaveLength(1);
    expect(config.availableTools[0]).toHaveProperty("isBackground", false);
  });

  it("propagates abort results returned by the coordinator", async () => {
    mockedResolveParallelToolConfig.mockReturnValue({ useParallel: true, concurrency: 4 });
    const abortController = new AbortController();
    const runner = buildRunner();
    const toolCalls = [{ tool: { name: "webSearch", isBackground: false }, args: {} }];

    mockedExecuteCoordinatorFlow.mockResolvedValue({
      toolResults: [{ toolName: "webSearch", result: "Aborted", success: false }],
      updatedMessages: [],
    });

    const result = await (runner as any).executeToolCalls({
      toolCalls,
      abortController,
      updateLoadingMessage: jest.fn(),
      originalUserMessage: "question",
    });

    expect(mockedExecuteCoordinatorFlow).toHaveBeenCalled();
    expect(result.toolOutputs).toEqual([{ tool: "webSearch", output: "Aborted" }]);
  });

  it("falls back to sequential execution when parallel mode is disabled", async () => {
    mockedResolveParallelToolConfig.mockReturnValue({ useParallel: false, concurrency: 1 });
    const abortController = new AbortController();
    const updateLoadingMessage = jest.fn();
    const runner = buildRunner();
    const tool = { name: "webSearch" };
    const toolCalls = [{ tool, args: { query: "foo" } }];

    mockedToolManager.callTool.mockResolvedValue({ status: "ok" });

    const result = await (runner as any).executeToolCalls({
      toolCalls,
      abortController,
      updateLoadingMessage,
      originalUserMessage: "question",
    });

    expect(mockedExecuteCoordinatorFlow).not.toHaveBeenCalled();
    expect(mockedToolManager.callTool).toHaveBeenCalledWith(tool, { query: "foo" });
    expect(updateLoadingMessage).toHaveBeenLastCalledWith(LOADING_MESSAGES.DEFAULT);
    expect(result.toolOutputs).toEqual([{ tool: "webSearch", output: { status: "ok" } }]);
  });
});

export {};
