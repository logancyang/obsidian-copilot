import { AutonomousAgentChainRunner } from "@/LLMProviders/chainRunner/AutonomousAgentChainRunner";
import { executeSequentialToolCall } from "@/LLMProviders/chainRunner/utils/toolExecution";
import { getSettings } from "@/settings/model";
import { AIMessage } from "@langchain/core/messages";

jest.mock("@/LLMProviders/chainRunner/CopilotPlusChainRunner", () => ({
  CopilotPlusChainRunner: class {},
}));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn() }));
jest.mock("@/LLMProviders/chainRunner/utils/toolExecution", () => ({
  executeSequentialToolCall: jest.fn(),
  logToolCall: jest.fn(),
  logToolResult: jest.fn(),
}));

// Isolate the loop from provider/session setup so an endlessly tool-calling model is deterministic.
interface LoopHarness {
  runReActLoop(params: object): Promise<{ finalResponse: string }>;
  streamModelResponse: jest.Mock;
  stopReasoningTimer: jest.Mock;
  buildReasoningBlockMarkup: jest.Mock;
  addReasoningStep: jest.Mock;
  reasoningState: { status: string };
}

describe("AutonomousAgentChainRunner", () => {
  describe("AutonomousAgentChainRunner", () => {
    describe("runReActLoop()", () => {
      it.each([undefined, 4, 128])(
        "stops after 32 iterations regardless of obsolete saved limit %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/428)",
        async (savedLimit) => {
          jest.mocked(getSettings).mockReturnValue({
            autonomousAgentMaxIterations: savedLimit,
          } as unknown as ReturnType<typeof getSettings>);
          jest.mocked(executeSequentialToolCall).mockClear().mockResolvedValue({
            toolName: "readNote",
            success: true,
            result: "Note content",
          });
          const runner = Object.assign(Object.create(AutonomousAgentChainRunner.prototype), {
            streamModelResponse: jest.fn().mockResolvedValue({
              content: "",
              aiMessage: new AIMessage({
                content: "",
                tool_calls: [{ id: "read", name: "readNote", args: { path: "Source.md" } }],
              }),
              streamingResult: {},
            }),
            stopReasoningTimer: jest.fn(),
            buildReasoningBlockMarkup: jest.fn(() => ""),
            addReasoningStep: jest.fn(),
            reasoningState: { status: "reasoning" },
          }) as LoopHarness;

          const result = await runner.runReActLoop({
            boundModel: {},
            tools: [],
            messages: [],
            originalPrompt: "Keep reading",
            abortController: new AbortController(),
            updateCurrentAiMessage: jest.fn(),
          });

          expect(executeSequentialToolCall).toHaveBeenCalledTimes(32);
          expect(runner.streamModelResponse).toHaveBeenCalledTimes(32);
          expect(result.finalResponse).toContain("maximum number of tool calls");
        }
      );
    });
  });
});
