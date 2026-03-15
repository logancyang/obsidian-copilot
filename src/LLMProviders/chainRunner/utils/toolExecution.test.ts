import { executeSequentialToolCall } from "./toolExecution";
import { createLangChainTool } from "@/tools/createLangChainTool";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { z } from "zod";

// Mock dependencies
jest.mock("@/plusUtils", () => ({
  checkIsPlusUser: jest.fn(),
  isSelfHostModeValid: jest.fn().mockReturnValue(false),
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

// Mock global app.vault for .base file existence checks
const mockGetAbstractFileByPath = jest.fn();
(globalThis as any).app = {
  vault: { getAbstractFileByPath: mockGetAbstractFileByPath },
};

describe("toolExecution", () => {
  const mockCheckIsPlusUser = checkIsPlusUser as jest.MockedFunction<typeof checkIsPlusUser>;
  const mockCallTool = ToolManager.callTool as jest.MockedFunction<typeof ToolManager.callTool>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the registry before each test
    ToolRegistry.getInstance().clear();
    // Default: files don't exist (for .base guard tests)
    mockGetAbstractFileByPath.mockReturnValue(null);
  });

  describe("executeSequentialToolCall", () => {
    it("should execute tools without isPlusOnly flag", async () => {
      const testTool = createLangChainTool({
        name: "testTool",
        description: "Test tool",
        schema: z.object({ input: z.string() }),
        func: async ({ input }) => `Result: ${input}`,
      });

      // Register tool without isPlusOnly
      ToolRegistry.getInstance().register({
        tool: testTool,
        metadata: {
          id: "testTool",
          displayName: "Test Tool",
          description: "Test tool",
          category: "custom",
        },
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
      const plusTool = createLangChainTool({
        name: "plusTool",
        description: "Plus-only tool",
        schema: z.object({}),
        func: async () => "Should not execute",
      });

      // Register tool with isPlusOnly metadata
      ToolRegistry.getInstance().register({
        tool: plusTool,
        metadata: {
          id: "plusTool",
          displayName: "Plus Tool",
          description: "Plus-only tool",
          category: "custom",
          isPlusOnly: true,
        },
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
      const plusTool = createLangChainTool({
        name: "plusTool",
        description: "Plus-only tool",
        schema: z.object({}),
        func: async () => "Plus tool executed",
      });

      // Register tool with isPlusOnly metadata
      ToolRegistry.getInstance().register({
        tool: plusTool,
        metadata: {
          id: "plusTool",
          displayName: "Plus Tool",
          description: "Plus-only tool",
          category: "custom",
          isPlusOnly: true,
        },
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
        result:
          "Error: Tool 'unknownTool' not found. Available tools: . Make sure you have the tool enabled in the Agent settings.",
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

    it("should redirect writeToFile targeting existing .base files when obsidianBases is available", async () => {
      const writeToFile = createLangChainTool({
        name: "writeToFile",
        description: "Write to file",
        schema: z.object({ path: z.string(), content: z.string() }),
        func: async () => "written",
      });
      const obsidianBases = createLangChainTool({
        name: "obsidianBases",
        description: "Bases CLI",
        schema: z.object({ command: z.string() }),
        func: async () => "queried",
      });

      ToolRegistry.getInstance().register({
        tool: writeToFile,
        metadata: { id: "writeToFile", displayName: "Write", description: "", category: "file" },
      });

      // File exists — should redirect
      mockGetAbstractFileByPath.mockReturnValueOnce({ path: "Library.base" });

      const result = await executeSequentialToolCall(
        { name: "writeToFile", args: { path: "Library.base", content: "yaml" } },
        [writeToFile, obsidianBases]
      );

      expect(result.success).toBe(false);
      expect(result.result).toContain("obsidianBases");
      expect(result.result).toContain(".base file");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("should allow writeToFile to create new .base files", async () => {
      const writeToFile = createLangChainTool({
        name: "writeToFile",
        description: "Write to file",
        schema: z.object({ path: z.string(), content: z.string() }),
        func: async () => "written",
      });
      const obsidianBases = createLangChainTool({
        name: "obsidianBases",
        description: "Bases CLI",
        schema: z.object({ command: z.string() }),
        func: async () => "queried",
      });

      ToolRegistry.getInstance().register({
        tool: writeToFile,
        metadata: { id: "writeToFile", displayName: "Write", description: "", category: "file" },
      });

      // File does NOT exist — should allow creation
      mockGetAbstractFileByPath.mockReturnValueOnce(null);
      mockCallTool.mockResolvedValueOnce("File created");

      const result = await executeSequentialToolCall(
        { name: "writeToFile", args: { path: "NewBase.base", content: "filters: ..." } },
        [writeToFile, obsidianBases]
      );

      expect(result.success).toBe(true);
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("should redirect replaceInFile targeting existing .base files when obsidianBases is available", async () => {
      const replaceInFile = createLangChainTool({
        name: "replaceInFile",
        description: "Replace in file",
        schema: z.object({ path: z.string(), diff: z.string() }),
        func: async () => "replaced",
      });
      const obsidianBases = createLangChainTool({
        name: "obsidianBases",
        description: "Bases CLI",
        schema: z.object({ command: z.string() }),
        func: async () => "queried",
      });

      ToolRegistry.getInstance().register({
        tool: replaceInFile,
        metadata: {
          id: "replaceInFile",
          displayName: "Replace",
          description: "",
          category: "file",
        },
      });

      // File exists — should redirect
      mockGetAbstractFileByPath.mockReturnValueOnce({ path: "Databases/Projects.base" });

      const result = await executeSequentialToolCall(
        { name: "replaceInFile", args: { path: "Databases/Projects.base", diff: "..." } },
        [replaceInFile, obsidianBases]
      );

      expect(result.success).toBe(false);
      expect(result.result).toContain("obsidianBases");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("should allow writeToFile for existing .base files when obsidianBases is NOT available", async () => {
      const writeToFile = createLangChainTool({
        name: "writeToFile",
        description: "Write to file",
        schema: z.object({ path: z.string(), content: z.string() }),
        func: async () => "written",
      });

      ToolRegistry.getInstance().register({
        tool: writeToFile,
        metadata: { id: "writeToFile", displayName: "Write", description: "", category: "file" },
      });

      // File exists but obsidianBases is NOT available — should allow
      mockGetAbstractFileByPath.mockReturnValueOnce({ path: "Library.base" });
      mockCallTool.mockResolvedValueOnce("File written");

      const result = await executeSequentialToolCall(
        { name: "writeToFile", args: { path: "Library.base", content: "yaml" } },
        [writeToFile] // no obsidianBases in available tools
      );

      expect(result.success).toBe(true);
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("should not redirect writeToFile for non-.base files", async () => {
      const writeToFile = createLangChainTool({
        name: "writeToFile",
        description: "Write to file",
        schema: z.object({ path: z.string(), content: z.string() }),
        func: async () => "written",
      });
      const obsidianBases = createLangChainTool({
        name: "obsidianBases",
        description: "Bases CLI",
        schema: z.object({ command: z.string() }),
        func: async () => "queried",
      });

      ToolRegistry.getInstance().register({
        tool: writeToFile,
        metadata: { id: "writeToFile", displayName: "Write", description: "", category: "file" },
      });

      mockCallTool.mockResolvedValueOnce("File written");

      const result = await executeSequentialToolCall(
        { name: "writeToFile", args: { path: "Notes/todo.md", content: "# Todo" } },
        [writeToFile, obsidianBases]
      );

      expect(result.success).toBe(true);
      expect(mockCallTool).toHaveBeenCalled();
    });
  });
});
