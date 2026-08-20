import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import OpenAI from "openai";
import { ChatOpenRouter } from "@/LLMProviders/ChatOpenRouter";

jest.mock("@/logger");

function createModel(): ChatOpenRouter {
  return new ChatOpenRouter({
    modelName: "test-model",
    apiKey: "test-key",
    // The jest environment has no global fetch; the stub keeps client construction inert.
    configuration: { fetch: jest.fn() as unknown as typeof fetch },
  });
}

/** Access the private message converter without spinning up a real stream. */
function convertMessages(messages: unknown[]): OpenAI.ChatCompletionMessageParam[] {
  return (
    createModel() as unknown as {
      toOpenRouterMessages: (msgs: BaseMessage[]) => OpenAI.ChatCompletionMessageParam[];
    }
  ).toOpenRouterMessages(messages as BaseMessage[]);
}

/**
 * Reproduce a streamed assistant turn: run each raw OpenRouter delta through the
 * private chunk builder and aggregate the chunks the way callers of `stream()` do.
 */
function aggregateStreamedDeltas(deltas: Array<Record<string, unknown>>): AIMessageChunk {
  const model = createModel() as unknown as {
    buildMessageChunk: (config: {
      rawChunk: { id: string };
      delta: Record<string, unknown>;
      content: string;
      finishReason: null;
    }) => AIMessageChunk;
  };

  return deltas
    .map((delta) =>
      model.buildMessageChunk({
        rawChunk: { id: "chatcmpl-test" },
        delta,
        content: "",
        finishReason: null,
      })
    )
    .reduce((aggregated, chunk) => aggregated.concat(chunk));
}

describe("ChatOpenRouter", () => {
  describe("ChatOpenRouter", () => {
    describe("toOpenRouterMessages()", () => {
      it("maps LangChain message types to OpenAI chat roles", () => {
        const result = convertMessages([
          new SystemMessage("be helpful"),
          new HumanMessage("hi"),
          new AIMessage("hello"),
        ]);

        expect(result).toEqual([
          { role: "system", content: "be helpful" },
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ]);
      });

      it("infers roles for plain-object messages that are not BaseMessages", () => {
        const result = convertMessages([
          { role: "assistant", content: "prior answer" },
          { content: "no role provided" },
        ]);

        expect(result).toEqual([
          { role: "assistant", content: "prior answer" },
          { role: "user", content: "no role provided" },
        ]);
      });

      it("emits tool role messages for entries carrying tool_call_id", () => {
        const result = convertMessages([{ role: "tool", content: "42", tool_call_id: "call_abc" }]);

        expect(result).toEqual([{ role: "tool", content: "42", tool_call_id: "call_abc" }]);
      });

      it("serializes first-class AIMessage tool_calls to the OpenAI wire format so a rebuilt assistant turn stays paired with its tool results (https://github.com/logancyang/obsidian-copilot-preview/issues/300)", () => {
        const message = new AIMessage({
          content: "",
          tool_calls: [
            { id: "call_1", name: "localSearch", args: { query: "notes" }, type: "tool_call" },
          ],
        });

        const result = convertMessages([message]);

        expect(result).toEqual([
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "localSearch", arguments: JSON.stringify({ query: "notes" }) },
              },
            ],
          },
        ]);
      });

      it("serializes an AIMessageChunk aggregated from streamed tool call fragments", () => {
        const aggregated = aggregateStreamedDeltas([
          {
            tool_calls: [
              { index: 0, id: "call_2", function: { name: "webSearch", arguments: '{"q":' } },
            ],
          },
          { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] },
        ]);

        const result = convertMessages([aggregated]);

        expect(result).toEqual([
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_2",
                type: "function",
                function: { name: "webSearch", arguments: JSON.stringify({ q: "x" }) },
              },
            ],
          },
        ]);
      });

      it("emits a plain assistant message when an AIMessage has no tool calls", () => {
        const result = convertMessages([new AIMessage({ content: "done" })]);

        expect(result).toEqual([{ role: "assistant", content: "done" }]);
      });
    });

    describe("invocationParams()", () => {
      function paramsFor(fields: Record<string, unknown>): Record<string, unknown> {
        const model = new ChatOpenRouter({
          modelName: "test-model",
          apiKey: "test-key",
          configuration: { fetch: jest.fn() as unknown as typeof fetch },
          ...fields,
        });
        return (
          model as unknown as { invocationParams: () => Record<string, unknown> }
        ).invocationParams();
      }

      it("sets a reasoning budget without inventing an output limit to go with it (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", () => {
        // The gateway takes a reasoning budget on its own, checked live in
        // `src/integration_tests/outputLength.test.ts`. Adding a top-level
        // figure here would cap every reasoning model.
        const params = paramsFor({ enableReasoning: true });

        expect(params.reasoning).toEqual({ max_tokens: 1024 });
        expect(params.max_tokens).toBeUndefined();
      });

      it("passes an explicit output limit through when it sets a reasoning budget", () => {
        const params = paramsFor({ enableReasoning: true, maxTokens: 8192 });

        expect(params.max_tokens).toBe(8192);
      });

      it("sets an effort rather than a budget when an effort is configured", () => {
        const params = paramsFor({ enableReasoning: true, reasoningEffort: "high" });

        expect(params.reasoning).toEqual({ effort: "high" });
      });
    });
  });
});
