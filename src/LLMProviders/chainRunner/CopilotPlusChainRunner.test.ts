import { CopilotPlusChainRunner } from "@/LLMProviders/chainRunner/CopilotPlusChainRunner";
import { ToolManager } from "@/tools/toolManager";
import type { StructuredTool } from "@langchain/core/tools";

jest.mock("@/logger");
jest.mock("@/LLMProviders/chainOwner", () => ({ __esModule: true, default: {} }));
jest.mock("@/tools/builtinTools", () => ({ initializeBuiltinTools: jest.fn() }));
jest.mock("@/tools/SearchTools", () => ({
  createLocalSearchTool: jest.fn(),
  webSearchTool: {},
}));
jest.mock("@/tools/ComposerTools", () => ({ createWriteFileTool: jest.fn() }));
jest.mock("@/tools/memoryTools", () => ({ createUpdateMemoryTool: jest.fn() }));
jest.mock("@/tools/toolManager", () => ({ ToolManager: { callTool: jest.fn() } }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ debug: false })),
}));

type ToolCall = { tool: StructuredTool; args: Record<string, unknown> };

/**
 * Reach the private tool-execution step without driving a full chat turn.
 *
 * @param toolCalls - Tool calls to execute in order.
 * @returns The runner's collected tool outputs and sources.
 */
function executeToolCalls(toolCalls: ToolCall[]) {
  const runner = new CopilotPlusChainRunner({} as never) as unknown as {
    executeToolCalls: (calls: ToolCall[]) => Promise<{
      toolOutputs: { tool: string; output: unknown }[];
      sources: unknown[];
    }>;
  };
  return runner.executeToolCalls(toolCalls);
}

describe("CopilotPlusChainRunner", () => {
  describe("executeToolCalls()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("turns a thrown localSearch error into a failed search the model can explain (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
      (ToolManager.callTool as jest.Mock).mockRejectedValue(
        new Error("Miyo is unavailable. Open Miyo, then retry vault search.")
      );

      const { toolOutputs } = await executeToolCalls([
        { tool: { name: "localSearch" } as StructuredTool, args: { query: "notes" } },
      ]);

      expect(toolOutputs).toEqual([
        {
          tool: "localSearch",
          output:
            "<localSearch>\nSearch failed: Miyo is unavailable. Open Miyo, then retry vault search.\n</localSearch>",
        },
      ]);
    });

    it("propagates a thrown error from any other tool", async () => {
      (ToolManager.callTool as jest.Mock).mockRejectedValue(new Error("web search down"));

      await expect(
        executeToolCalls([{ tool: { name: "webSearch" } as StructuredTool, args: {} }])
      ).rejects.toThrow("web search down");
    });
  });
});
