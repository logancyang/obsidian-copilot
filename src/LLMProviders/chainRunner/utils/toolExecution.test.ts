import {
  CoordinatorToolCall,
  ExecuteToolCallContext,
  ExecuteToolCallsContext,
  ToolResult,
  executeSequentialToolCall,
  executeToolCall,
  executeToolCallsInParallel,
} from "./toolExecution";
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

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    enableSemanticSearchV3: false,
  })),
}));

jest.mock("@/utils", () => ({
  err2String: (error: unknown) => (error instanceof Error ? error.message : String(error)),
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
    jest.useRealTimers();
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
  });

  describe("executeToolCall", () => {
    const baseTool = createTool({
      name: "testTool",
      description: "Test tool",
      schema: z.object({ input: z.string() }),
      handler: async ({ input }) => `Result: ${input}`,
    });

    const context: ExecuteToolCallContext = {
      availableTools: [baseTool],
    };

    it("returns ToolResult with status ok on success", async () => {
      mockCallTool.mockResolvedValueOnce("Tool executed successfully");

      const result = await executeToolCall(
        { name: "testTool", args: { input: "dev" }, index: 2 },
        context
      );

      const expected: ToolResult = {
        index: 2,
        name: "testTool",
        status: "ok",
        payload: "Tool executed successfully",
      };

      expect(result).toEqual(expected);
    });

    it("bubbles sequential errors with status error", async () => {
      const errorMessage = "Error: Something failed";
      mockCallTool.mockRejectedValueOnce(new Error("Something failed"));

      const result = await executeToolCall({ name: "testTool", args: {} }, context);

      expect(result.status).toBe("error");
      expect(result.error).toContain("Something failed");
    });

    it("marks timeout as timeout status", async () => {
      jest.useFakeTimers();
      mockCallTool.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve("slow"), 120000);
          })
      );

      const promise = executeToolCall({ name: "testTool", args: {} }, context);

      jest.advanceTimersByTime(60000);
      await flushMicrotasks();

      const result = await promise;
      expect(result.status).toBe("timeout");
      expect(result.error).toContain("timed out");
    });
  });

  describe("executeToolCallsInParallel", () => {
    const buildCall = (name: string, index: number): CoordinatorToolCall => ({
      name,
      index,
      args: { input: name },
    });

    const buildTool = (name: string) =>
      createTool({
        name,
        description: name,
        schema: z.object({ input: z.string() }),
        handler: async ({ input }) => input,
      });

    const defaultContext = (
      overrides: Partial<ExecuteToolCallsContext> = {}
    ): ExecuteToolCallsContext => ({
      availableTools: [buildTool("a"), buildTool("b"), buildTool("c")],
      originalUserMessage: "prompt",
      ...overrides,
    });

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("preserves input ordering with staggered resolution", async () => {
      const deferA = createDeferred<string>();
      const deferB = createDeferred<string>();
      const deferC = createDeferred<string>();

      mockCallTool.mockImplementation((tool) => {
        switch (tool.name) {
          case "a":
            return deferA.promise;
          case "b":
            return deferB.promise;
          case "c":
            return deferC.promise;
          default:
            return Promise.resolve("unknown");
        }
      });

      const hooks = { onStart: jest.fn(), onSettle: jest.fn() };

      const promise = executeToolCallsInParallel(
        [buildCall("a", 0), buildCall("b", 1), buildCall("c", 2)],
        defaultContext({ hooks, concurrency: 2 })
      );

      expect(hooks.onStart).toHaveBeenCalledTimes(2);

      deferB.resolve("B");
      await waitForCallCount(hooks.onStart, 3);

      deferA.resolve("A");
      await flushMicrotasks();
      deferC.resolve("C");
      await flushMicrotasks();

      const results = await promise;
      expect(results.map((r) => r.payload)).toEqual(["A", "B", "C"]);
      expect(hooks.onSettle).toHaveBeenCalledTimes(3);
    });

    it("clamps concurrency and handles abort", async () => {
      const controller = new AbortController();

      const slowDeferred = createDeferred<string>();
      const fastDeferred = createDeferred<string>();
      const settleSpy = jest.fn();

      mockCallTool.mockImplementation((tool) => {
        if (tool.name === "a") return slowDeferred.promise;
        return fastDeferred.promise;
      });

      const hooks = { onStart: jest.fn(), onSettle: settleSpy };

      const context = defaultContext({
        hooks,
        signal: controller.signal,
        concurrency: 0, // should clamp to MIN_CONCURRENCY
      });

      const calls = [buildCall("a", 0), buildCall("b", 1), buildCall("c", 2)];

      const promise = executeToolCallsInParallel(calls, context);

      expect(hooks.onStart).toHaveBeenCalledTimes(1);

      controller.abort();
      await flushMicrotasks();

      const results = await promise;
      expect(results[0].status).toBe("cancelled");
      expect(results[1].status).toBe("cancelled");
      expect(results[2].status).toBe("cancelled");
      expect(settleSpy).not.toHaveBeenCalled();
      expect(mockCallTool).toHaveBeenCalledTimes(1);

      // Resolve deferreds to avoid dangling promises.
      slowDeferred.resolve("slow");
      fastDeferred.resolve("fast");
      await flushMicrotasks();
      await flushMicrotasks();
    });

    it("rejects duplicate tool call indices", async () => {
      const context = defaultContext();
      const calls = [buildCall("a", 0), buildCall("b", 0)];

      await expect(executeToolCallsInParallel(calls, context)).rejects.toThrow(
        "Duplicate index 0 found in tool calls."
      );
    });
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  const { setImmediate } = jest.requireActual("timers");
  await new Promise(setImmediate);
}

async function waitForCallCount(mockFn: jest.Mock, expected: number): Promise<void> {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (mockFn.mock.calls.length >= expected) {
      expect(mockFn).toHaveBeenCalledTimes(expected);
      return;
    }
    await flushMicrotasks();
  }

  expect(mockFn).toHaveBeenCalledTimes(expected);
}
