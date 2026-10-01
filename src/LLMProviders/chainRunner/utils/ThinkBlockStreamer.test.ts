import { ThinkBlockStreamer } from "./ThinkBlockStreamer";

jest.mock("@/logger");

function createStreamer(excludeThinking = false): {
  streamer: ThinkBlockStreamer;
  message: () => string;
} {
  let currentMessage = "";
  const streamer = new ThinkBlockStreamer((msg) => {
    currentMessage = msg;
  }, excludeThinking);
  return { streamer, message: () => currentMessage };
}

const reasoningDelta = (reasoning: string) => ({
  content: "",
  additional_kwargs: { delta: { reasoning } },
});

const answer = (content: string) => ({ content, additional_kwargs: {} });

describe("ThinkBlockStreamer", () => {
  describe("ThinkBlockStreamer", () => {
    describe("processChunk()", () => {
      it("wraps streamed OpenRouter delta.reasoning in one think block that closes when the answer starts", () => {
        const { streamer, message } = createStreamer();

        streamer.processChunk(reasoningDelta("Thinking step 1: "));
        expect(message()).toBe("\n<think>Thinking step 1: ");

        streamer.processChunk(reasoningDelta("Thinking step 2."));
        expect(message()).toBe("\n<think>Thinking step 1: Thinking step 2.");

        streamer.processChunk(answer("Here's the result."));
        expect(message()).toBe(
          "\n<think>Thinking step 1: Thinking step 2.</think>Here's the result."
        );
      });

      it("does not treat an empty reasoning_details array as thinking content", () => {
        const { streamer, message } = createStreamer();

        streamer.processChunk({
          content: "Regular content",
          additional_kwargs: { reasoning_details: [] },
        });

        expect(message()).toBe("Regular content");
      });

      it("does not repeat reasoning that arrives in reasoning_details after the same text streamed as delta.reasoning", () => {
        const { streamer, message } = createStreamer();

        streamer.processChunk(reasoningDelta("Analyzing the "));
        streamer.processChunk(reasoningDelta("question carefully."));
        streamer.processChunk({
          content: "",
          additional_kwargs: {
            reasoning_details: [{ text: "Analyzing the question carefully." }],
          },
        });
        expect(message()).toBe("\n<think>Analyzing the question carefully.");

        streamer.processChunk(answer("Here's my answer."));
        expect(message()).toBe(
          "\n<think>Analyzing the question carefully.</think>Here's my answer."
        );
      });

      it("wraps Claude thinking blocks in a think block that closes when a text block arrives", () => {
        const { streamer, message } = createStreamer();

        streamer.processChunk({
          content: [{ type: "thinking", thinking: "Let me analyze this..." }],
        });
        expect(message()).toBe("\n<think>Let me analyze this...");

        streamer.processChunk({ content: [{ type: "text", text: "Based on my analysis, " }] });
        expect(message()).toBe("\n<think>Let me analyze this...</think>Based on my analysis, ");
      });

      it("opens an empty think block without writing undefined when a Claude thinking block has no thinking text", () => {
        const { streamer, message } = createStreamer();

        streamer.processChunk({ content: [{ type: "thinking" }] });

        expect(message()).toBe("\n<think>");
      });

      it("keeps streamed Deepseek reasoning_content in one think block until the answer starts", () => {
        const { streamer, message } = createStreamer();

        streamer.processChunk({
          content: "",
          additional_kwargs: { reasoning_content: "Thinking step 1..." },
        });
        expect(message()).toBe("\n<think>Thinking step 1...");

        streamer.processChunk({
          content: "",
          additional_kwargs: { reasoning_content: " Step 2..." },
        });
        expect(message()).toBe("\n<think>Thinking step 1... Step 2...");

        streamer.processChunk(answer("Final answer."));
        expect(message()).toBe("\n<think>Thinking step 1... Step 2...</think>Final answer.");
      });

      it("writes nothing when Deepseek reasoning_content is undefined", () => {
        const { streamer, message } = createStreamer();

        streamer.processChunk({
          content: "",
          additional_kwargs: { reasoning_content: undefined },
        });

        expect(message()).toBe("");
      });

      it("opens a separate think block for each reasoning burst between answer text", () => {
        const { streamer, message } = createStreamer();

        for (const n of [1, 2, 3]) {
          streamer.processChunk(reasoningDelta(`Think ${n}`));
          streamer.processChunk(answer(`Text ${n}`));
        }

        expect(message()).toBe(
          "\n<think>Think 1</think>Text 1\n<think>Think 2</think>Text 2\n<think>Think 3</think>Text 3"
        );
      });

      it("drops OpenRouter reasoning when excludeThinking is on and keeps the answer", () => {
        const { streamer, message } = createStreamer(true);

        streamer.processChunk(reasoningDelta("This should be skipped"));
        expect(message()).toBe("");

        streamer.processChunk(answer("This should be included"));
        expect(message()).toBe("This should be included");
      });

      it("drops Claude thinking blocks when excludeThinking is on", () => {
        const { streamer, message } = createStreamer(true);

        streamer.processChunk({ content: [{ type: "thinking", thinking: "Claude thinking" }] });

        expect(message()).toBe("");
      });
    });

    describe("close()", () => {
      it("closes a think block that is still open at the end of the stream", () => {
        const { streamer, message } = createStreamer();
        streamer.processChunk(reasoningDelta("Thinking..."));
        expect(message()).toBe("\n<think>Thinking...");

        expect(streamer.close().content).toBe("\n<think>Thinking...</think>");
      });

      it("adds no second closing tag when the think block already closed", () => {
        const { streamer } = createStreamer();
        streamer.processChunk(reasoningDelta("Thinking..."));
        streamer.processChunk(answer("Done"));

        const { content } = streamer.close();

        expect(content).toBe("\n<think>Thinking...</think>Done");
      });

      it("appends the formatted error after the streamed content when an error chunk was recorded", () => {
        const { streamer } = createStreamer();
        streamer.processChunk(answer("Partial answer"));
        streamer.processErrorChunk("rate limited");

        const { content } = streamer.close();

        expect(content.startsWith("Partial answer\n")).toBe(true);
        expect(content).toContain("rate limited");
      });
    });
  });
});
