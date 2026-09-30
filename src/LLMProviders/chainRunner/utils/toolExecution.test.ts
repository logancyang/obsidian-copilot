import { createLangChainTool } from "@/tools/createLangChainTool";
import { ToolRegistry, type ToolMetadata } from "@/tools/ToolRegistry";
import { logInfo } from "@/logger";
import { checkIsPaidUser, isSelfHostModeValid } from "@/plusUtils";
import { z } from "zod";
import {
  deduplicateSources,
  executeSequentialToolCall,
  logToolCall,
  logToolResult,
  type ToolCall,
} from "./toolExecution";

jest.mock("@/logger");
jest.mock("@/plusUtils", () => ({
  checkIsPaidUser: jest.fn(),
  isSelfHostModeValid: jest.fn().mockReturnValue(false),
}));

const mockCheckIsPaidUser = checkIsPaidUser as jest.MockedFunction<typeof checkIsPaidUser>;
const mockIsSelfHostModeValid = isSelfHostModeValid as jest.MockedFunction<
  typeof isSelfHostModeValid
>;

function registerTool<T extends ReturnType<typeof createLangChainTool>>(
  tool: T,
  metadata: Partial<ToolMetadata> = {}
): T {
  ToolRegistry.getInstance().register({
    tool,
    metadata: {
      id: tool.name,
      displayName: tool.name,
      description: tool.description,
      category: "custom",
      ...metadata,
    },
  });
  return tool;
}

describe("toolExecution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSelfHostModeValid.mockReturnValue(false);
    ToolRegistry.getInstance().clear();
  });

  describe("executeSequentialToolCall()", () => {
    it("runs the named tool with the call's arguments and returns its result", async () => {
      const echo = registerTool(
        createLangChainTool({
          name: "echo",
          description: "Echo",
          schema: z.object({ input: z.string() }),
          func: async ({ input }) => `Result: ${input}`,
        })
      );

      const result = await executeSequentialToolCall({ name: "echo", args: { input: "test" } }, [
        echo,
      ]);

      expect(result).toEqual({ toolName: "echo", result: "Result: test", success: true });
      expect(mockCheckIsPaidUser).not.toHaveBeenCalled();
    });

    it("hands the original user message to a tool that requires it", async () => {
      const summarize = registerTool(
        createLangChainTool({
          name: "summarize",
          description: "Summarize",
          schema: z.object({ _userMessageContent: z.string().optional() }),
          func: async ({ _userMessageContent }) => `saw: ${_userMessageContent}`,
        }),
        { requiresUserMessageContent: true }
      );

      const result = await executeSequentialToolCall(
        { name: "summarize", args: {} },
        [summarize],
        "original question"
      );

      expect(result.result).toBe("saw: original question");
    });

    it("fails a tool that outlasts its timeoutMs", async () => {
      const slow = registerTool(
        createLangChainTool({
          name: "slow",
          description: "Never finishes",
          schema: z.object({}),
          func: () => new Promise<string>(() => {}),
        }),
        { timeoutMs: 20 }
      );

      const result = await executeSequentialToolCall({ name: "slow", args: {} }, [slow]);

      expect(result).toEqual({
        toolName: "slow",
        result: "Error: Tool execution timed out after 20ms",
        success: false,
      });
    });

    it("reports the thrown message as a failed result when the tool throws", async () => {
      const broken = registerTool(
        createLangChainTool({
          name: "broken",
          description: "Throws",
          schema: z.object({}),
          func: async () => {
            throw new Error("disk full");
          },
        })
      );

      const result = await executeSequentialToolCall({ name: "broken", args: {} }, [broken]);

      expect(result).toEqual({
        toolName: "broken",
        result: "Error: disk full",
        success: false,
      });
    });

    it("reports a failed result when the arguments do not match the tool's schema", async () => {
      const strict = registerTool(
        createLangChainTool({
          name: "strict",
          description: "Needs a path",
          schema: z.object({ path: z.string() }),
          func: async ({ path }) => path,
        })
      );

      const result = await executeSequentialToolCall({ name: "strict", args: {} }, [strict]);

      expect(result.success).toBe(false);
      expect(result.result).toMatch(/^Error: /);
    });

    it("blocks a plus-only tool for a non-plus user without running it", async () => {
      const func = jest.fn().mockResolvedValue("Should not execute");
      const plusTool = registerTool(
        createLangChainTool({
          name: "plusTool",
          description: "Plus-only tool",
          schema: z.object({}),
          func,
        }),
        { isPlusOnly: true }
      );
      mockCheckIsPaidUser.mockResolvedValueOnce(false);

      const result = await executeSequentialToolCall({ name: "plusTool", args: {} }, [plusTool]);

      expect(result).toEqual({
        toolName: "plusTool",
        result: "Error: plusTool requires a Copilot Plus subscription",
        success: false,
      });
      expect(mockCheckIsPaidUser).toHaveBeenCalledWith(undefined, { trigger: "tool_call" });
      expect(func).not.toHaveBeenCalled();
    });

    it("runs a plus-only tool for a plus user", async () => {
      const plusTool = registerTool(
        createLangChainTool({
          name: "plusTool",
          description: "Plus-only tool",
          schema: z.object({}),
          func: async () => "Plus tool executed",
        }),
        { isPlusOnly: true }
      );
      mockCheckIsPaidUser.mockResolvedValueOnce(true);

      const result = await executeSequentialToolCall({ name: "plusTool", args: {} }, [plusTool]);

      expect(result).toEqual({
        toolName: "plusTool",
        result: "Plus tool executed",
        success: true,
      });
    });

    it("runs a plus-only tool for a non-plus user in a valid self-host setup", async () => {
      const plusTool = registerTool(
        createLangChainTool({
          name: "plusTool",
          description: "Plus-only tool",
          schema: z.object({}),
          func: async () => "Plus tool executed",
        }),
        { isPlusOnly: true }
      );
      mockCheckIsPaidUser.mockResolvedValueOnce(false);
      mockIsSelfHostModeValid.mockReturnValue(true);

      const result = await executeSequentialToolCall({ name: "plusTool", args: {} }, [plusTool]);

      expect(result.success).toBe(true);
    });

    it("lists the available tools when the named tool is not found", async () => {
      const known = createLangChainTool({
        name: "knownTool",
        description: "Known",
        schema: z.object({}),
        func: async () => "ok",
      });

      const result = await executeSequentialToolCall({ name: "unknownTool", args: {} }, [known]);

      expect(result).toEqual({
        toolName: "unknownTool",
        result:
          "Error: Tool 'unknownTool' not found. Available tools: knownTool. Make sure you have the tool enabled in the Agent settings.",
        success: false,
      });
    });

    it("rejects a tool call that has no tool name", async () => {
      const result = await executeSequentialToolCall(null as unknown as ToolCall, []);

      expect(result).toEqual({
        toolName: "unknown",
        result: "Error: Invalid tool call - missing tool name",
        success: false,
      });
    });
  });

  describe("logToolCall()", () => {
    it("logs the iteration, the tool's display name and its parameters", () => {
      logToolCall({ name: "webSearch", args: { query: "notes" } }, 2);

      expect(logInfo).toHaveBeenCalledWith("🌐 [Iteration 2] WEB SEARCH");
      expect(logInfo).toHaveBeenCalledWith(
        "Parameters:",
        JSON.stringify({ query: "notes" }, null, 2)
      );
    });

    it("logs (no parameters) for a call without arguments", () => {
      logToolCall({ name: "webSearch", args: {} }, 1);

      expect(logInfo).toHaveBeenCalledWith("Parameters:", "(no parameters)");
    });
  });

  describe("logToolResult()", () => {
    it("logs the status and the result text", () => {
      logToolResult("webSearch", { toolName: "webSearch", result: "found it", success: true });

      expect(logInfo).toHaveBeenCalledWith("🌐 WEB SEARCH RESULT: ✅ SUCCESS");
      expect(logInfo).toHaveBeenCalledWith("Result:", "found it");
    });

    it("truncates a result longer than 300 characters in the log", () => {
      logToolResult("webSearch", {
        toolName: "webSearch",
        result: "a".repeat(400),
        success: false,
      });

      expect(logInfo).toHaveBeenCalledWith("🌐 WEB SEARCH RESULT: ❌ FAILED");
      expect(logInfo).toHaveBeenCalledWith(
        `Result: ${"a".repeat(300)}... (truncated, 400 chars total)`
      );
    });

    it("logs nothing for localSearch results", () => {
      logToolResult("localSearch", { toolName: "localSearch", result: "docs", success: true });

      expect(logInfo).not.toHaveBeenCalled();
    });
  });

  describe("deduplicateSources()", () => {
    it("keeps the highest-scoring entry for each path and orders sources by score descending", () => {
      const result = deduplicateSources([
        { title: "A", path: "a.md", score: 0.4 },
        { title: "B", path: "b.md", score: 0.9 },
        { title: "A again", path: "a.md", score: 0.6 },
      ]);

      expect(result).toEqual([
        { title: "B", path: "b.md", score: 0.9 },
        { title: "A again", path: "a.md", score: 0.6 },
      ]);
    });

    it("identifies a source without a path by its title", () => {
      const result = deduplicateSources([
        { title: "Untitled note", path: "", score: 0.3 },
        { title: "Untitled note", path: "", score: 0.5 },
      ]);

      expect(result).toEqual([{ title: "Untitled note", path: "", score: 0.5 }]);
    });
  });
});
