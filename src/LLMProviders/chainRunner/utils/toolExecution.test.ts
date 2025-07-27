import { executeSequentialToolCall } from "./toolExecution";
import { createTool } from "@/tools/SimpleTool";
import { z } from "zod";

// Mock dependencies
jest.mock("@/plusUtils", () => ({
  checkIsPlusUser: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/tools/toolManager", () => ({
  ToolManager: {
    callTool: jest.fn(),
  },
}));

import { checkIsPlusUser } from "@/plusUtils";
import { ToolManager } from "@/tools/toolManager";

describe("toolExecution", () => {
  const mockCheckIsPlusUser = checkIsPlusUser as jest.MockedFunction<typeof checkIsPlusUser>;
  const mockCallTool = ToolManager.callTool as jest.MockedFunction<typeof ToolManager.callTool>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("executeSequentialToolCall", () => {
    it("should execute tools without isPlusOnly flag", async () => {
      const testTool = createTool({
        name: "testTool",
        description: "Test tool",
        schema: z.object({ input: z.string() }),
        handler: async ({ input }) => `Result: ${input}`,
      });

      mockCallTool.mockResolvedValueOnce("Tool executed successfully");

      const result = await executeSequentialToolCall(
        { name: "testTool", args: { input: "test" } },
        [testTool]
      );

      expect(result).toEqual({
        toolName: "testTool",
        result: "Tool executed successfully",
        success: true,
      });
      expect(mockCheckIsPlusUser).not.toHaveBeenCalled();
    });

    it("should block plus-only tools for non-plus users", async () => {
      const plusTool = createTool({
        name: "plusTool",
        description: "Plus-only tool",
        schema: z.void(),
        handler: async () => "Should not execute",
        isPlusOnly: true,
      });

      mockCheckIsPlusUser.mockResolvedValueOnce(false);

      const result = await executeSequentialToolCall({ name: "plusTool", args: {} }, [plusTool]);

      expect(result).toEqual({
        toolName: "plusTool",
        result: "Error: plusTool requires a Copilot Plus subscription",
        success: false,
      });
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("should allow plus-only tools for plus users", async () => {
      const plusTool = createTool({
        name: "plusTool",
        description: "Plus-only tool",
        schema: z.void(),
        handler: async () => "Plus tool executed",
        isPlusOnly: true,
      });

      mockCheckIsPlusUser.mockResolvedValueOnce(true);
      mockCallTool.mockResolvedValueOnce("Plus tool executed");

      const result = await executeSequentialToolCall({ name: "plusTool", args: {} }, [plusTool]);

      expect(result).toEqual({
        toolName: "plusTool",
        result: "Plus tool executed",
        success: true,
      });
      expect(mockCheckIsPlusUser).toHaveBeenCalled();
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("should handle tool not found", async () => {
      const result = await executeSequentialToolCall({ name: "unknownTool", args: {} }, []);

      expect(result).toEqual({
        toolName: "unknownTool",
        result: "Error: Tool 'unknownTool' not found. Available tools: ",
        success: false,
      });
    });

    it("should handle invalid tool call", async () => {
      const result = await executeSequentialToolCall(null as any, []);

      expect(result).toEqual({
        toolName: "unknown",
        result: "Error: Invalid tool call - missing tool name",
        success: false,
      });
    });
  });
});
