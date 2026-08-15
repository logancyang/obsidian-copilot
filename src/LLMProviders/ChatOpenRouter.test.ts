import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import OpenAI from "openai";
import { ChatOpenRouter } from "@/LLMProviders/ChatOpenRouter";

jest.mock("@/logger");

/** Access the private message converter without spinning up a real stream. */
function convertMessages(messages: unknown[]): OpenAI.ChatCompletionMessageParam[] {
  const model = new ChatOpenRouter({
    modelName: "test-model",
    apiKey: "test-key",
    // The jest environment has no global fetch; the stub keeps client construction inert.
    configuration: { fetch: jest.fn() as unknown as typeof fetch },
  });
  return (
    model as unknown as {
      toOpenRouterMessages: (msgs: BaseMessage[]) => OpenAI.ChatCompletionMessageParam[];
    }
  ).toOpenRouterMessages(messages as BaseMessage[]);
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

      it("serializes first-class AIMessage tool_calls to the OpenAI wire format", () => {
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

      it("passes through raw OpenAI-format tool_calls from additional_kwargs", () => {
        const rawToolCalls = [
          {
            id: "call_2",
            type: "function" as const,
            function: { name: "webSearch", arguments: '{"q":"x"}' },
          },
        ];
        const message = new AIMessage({
          content: "",
          additional_kwargs: { tool_calls: rawToolCalls },
        });

        const result = convertMessages([message]);

        expect(result).toEqual([{ role: "assistant", content: "", tool_calls: rawToolCalls }]);
      });

      it("emits a plain assistant message when an AIMessage has no tool calls", () => {
        const result = convertMessages([new AIMessage({ content: "done" })]);

        expect(result).toEqual([{ role: "assistant", content: "done" }]);
      });
    });
  });
});
