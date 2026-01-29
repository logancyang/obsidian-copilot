import { ThinkBlockStreamer } from "./ThinkBlockStreamer";

describe("ThinkBlockStreamer", () => {
  describe("OpenRouter delta.reasoning format", () => {
    it("should NOT treat empty reasoning_details array as thinking content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // This was the bug: empty reasoning_details array should not trigger thinking mode
      streamer.processChunk({
        content: "Regular content",
        additional_kwargs: {
          reasoning_details: [],
        },
      });

      // Should NOT have <think> tags since reasoning_details is empty
      expect(currentMessage).toBe("Regular content");
      expect(currentMessage).not.toContain("<think>");
    });

    it("should handle delta.reasoning for streaming", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // First chunk with delta.reasoning
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking step 1: ",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1: ");

      // Second chunk with more delta.reasoning
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking step 2.",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1: Thinking step 2.");

      // Regular content should close think block
      streamer.processChunk({
        content: "Here's the result.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe(
        "\n<think>Thinking step 1: Thinking step 2.</think>Here's the result."
      );
    });

    it("should NOT duplicate when both delta.reasoning and reasoning_details are present", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // First chunk: delta.reasoning with streaming token
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Analyzing the ",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Analyzing the ");

      // Second chunk: more delta.reasoning
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "question carefully.",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Analyzing the question carefully.");

      // Final chunk: reasoning_details with complete transcript (should be IGNORED)
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [
            {
              text: "Analyzing the question carefully.", // Same content as accumulated delta
            },
          ],
        },
      });

      // Should NOT duplicate - reasoning_details should be ignored since we've seen delta.reasoning
      expect(currentMessage).toBe("\n<think>Analyzing the question carefully.");
      expect(currentMessage).not.toContain(
        "Analyzing the question carefully.Analyzing the question carefully."
      );

      // Regular content
      streamer.processChunk({
        content: "Here's my answer.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe(
        "\n<think>Analyzing the question carefully.</think>Here's my answer."
      );
    });
  });

  describe("Claude array-based format", () => {
    it("should handle Claude's content array with thinking type", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Claude format with content array
      streamer.processChunk({
        content: [
          {
            type: "thinking",
            thinking: "Let me analyze this...",
          },
        ],
      });

      expect(currentMessage).toBe("\n<think>Let me analyze this...");

      // Text content in array
      streamer.processChunk({
        content: [
          {
            type: "text",
            text: "Based on my analysis, ",
          },
        ],
      });

      expect(currentMessage).toBe("\n<think>Let me analyze this...</think>Based on my analysis, ");
    });

    it("should guard against undefined thinking content in Claude format", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Malformed chunk with undefined thinking
      streamer.processChunk({
        content: [
          {
            type: "thinking",
            // thinking property is undefined
          },
        ],
      });

      // Should not crash, and should not add undefined to response
      expect(currentMessage).toBe("\n<think>");
      expect(currentMessage).not.toContain("undefined");
    });
  });

  describe("Deepseek format", () => {
    it("should handle Deepseek reasoning_content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: "Deepseek is thinking...",
        },
      });

      expect(currentMessage).toBe("\n<think>Deepseek is thinking...");

      streamer.processChunk({
        content: "The answer is here.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("\n<think>Deepseek is thinking...</think>The answer is here.");
    });

    it("should guard against undefined reasoning_content in Deepseek format", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Malformed chunk with undefined reasoning_content
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: undefined,
        },
      });

      // Should not crash, not open think block, and not add undefined
      expect(currentMessage).toBe("");
      expect(currentMessage).not.toContain("undefined");
      expect(currentMessage).not.toContain("<think>");
    });

    it("should handle streaming Deepseek reasoning_content without premature closure", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // First chunk with reasoning_content
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: "Thinking step 1...",
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1...");

      // Second chunk with MORE reasoning_content (streaming)
      // This should NOT close and reopen the think block
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: " Step 2...",
        },
      });

      // Should be continuous, NOT "</think>\n<think>"
      expect(currentMessage).toBe("\n<think>Thinking step 1... Step 2...");
      expect(currentMessage).not.toContain("</think>\n<think>");

      // Third chunk with regular content
      streamer.processChunk({
        content: "Final answer.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1... Step 2...</think>Final answer.");
    });
  });

  describe("excludeThinking option", () => {
    it("should skip OpenRouter thinking content when excludeThinking is true", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer(
        (msg) => {
          currentMessage = msg;
        },
        true // excludeThinking = true
      );

      // Thinking content should be skipped
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "This should be skipped",
          },
        },
      });

      expect(currentMessage).toBe("");

      // Regular content should still be processed
      streamer.processChunk({
        content: "This should be included",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("This should be included");
    });

    it("should skip Claude thinking content when excludeThinking is true", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer(
        (msg) => {
          currentMessage = msg;
        },
        true // excludeThinking = true
      );

      streamer.processChunk({
        content: [
          {
            type: "thinking",
            thinking: "Claude thinking",
          },
        ],
      });

      expect(currentMessage).toBe("");
      expect(currentMessage).not.toContain("<think>");
    });
  });

  describe("Ollama thinking content", () => {
    it("should handle Ollama thinking chunks", () => {
      let capturedMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        capturedMessage = msg;
      });

      // Simulate Ollama thinking chunks
      streamer.processChunk({
        message: {
          role: "assistant",
          content: "",
          thinking: "Let me think about this. ",
        },
        done: false,
      });

      expect(capturedMessage).toBe("\n<think>Let me think about this. ");

      streamer.processChunk({
        message: {
          role: "assistant",
          content: "",
          thinking: "The answer is 42.",
        },
        done: false,
      });

      expect(capturedMessage).toBe("\n<think>Let me think about this. The answer is 42.");

      // Simulate content chunk (thinking ends)
      streamer.processChunk({
        message: {
          role: "assistant",
          content: "42",
          thinking: null,
        },
        done: false,
      });

      const result = streamer.close();
      expect(result.content).toContain("<think>");
      expect(result.content).toContain("Let me think about this. The answer is 42.");
      expect(result.content).toContain("</think>");
      expect(result.content).toContain("42");
    });

    it("should skip Ollama thinking content when excludeThinking is true", () => {
      const streamer = new ThinkBlockStreamer(() => {}, true); // excludeThinking = true

      streamer.processChunk({
        message: {
          role: "assistant",
          content: "",
          thinking: "Internal reasoning here",
        },
        done: false,
      });

      streamer.processChunk({
        message: {
          role: "assistant",
          content: "Final answer",
          thinking: null,
        },
        done: false,
      });

      const result = streamer.close();
      expect(result.content).not.toContain("<think>");
      expect(result.content).not.toContain("Internal reasoning");
      expect(result.content).toBe("Final answer");
    });

    it("should handle mixed Ollama thinking and content", () => {
      const streamer = new ThinkBlockStreamer((msg) => {});

      // Thinking phase
      streamer.processChunk({
        message: { role: "assistant", content: "", thinking: "Step 1: " },
      });
      streamer.processChunk({
        message: { role: "assistant", content: "", thinking: "analyze the problem." },
      });

      // Transition to content
      streamer.processChunk({
        message: { role: "assistant", content: "The ", thinking: null },
      });
      streamer.processChunk({
        message: { role: "assistant", content: "solution is X.", thinking: null },
      });

      const result = streamer.close();
      expect(result.content).toMatch(
        /<think>Step 1: analyze the problem\.<\/think>The solution is X\./
      );
    });

    it("should not create empty think tags for empty thinking strings", () => {
      let capturedMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        capturedMessage = msg;
      });

      // Empty thinking should be ignored
      streamer.processChunk({
        message: {
          role: "assistant",
          content: "",
          thinking: "",
        },
        done: false,
      });

      expect(capturedMessage).toBe("");
      expect(capturedMessage).not.toContain("<think>");

      // Regular content should work normally
      streamer.processChunk({
        message: {
          role: "assistant",
          content: "Answer",
          thinking: null,
        },
        done: false,
      });

      const result = streamer.close();
      expect(result.content).toBe("Answer");
      expect(result.content).not.toContain("<think>");
    });
  });

  describe("close() method", () => {
    it("should close any open think block at the end", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking...",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking...");

      const result = streamer.close();
      expect(result.content).toBe("\n<think>Thinking...</think>");
    });

    it("should not add extra closing tag if already closed", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking...",
          },
        },
      });

      streamer.processChunk({
        content: "Done",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("\n<think>Thinking...</think>Done");

      const result = streamer.close();
      expect(result.content).toBe("\n<think>Thinking...</think>Done");
      // Should not have double closing tags
      expect(result.content.match(/<\/think>/g)?.length).toBe(1);
    });
  });

  describe("mixed content scenarios", () => {
    it("should handle rapid alternation between thinking and regular content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      const chunks = [
        { thinking: "Think 1", content: "" },
        { thinking: "", content: "Text 1" },
        { thinking: "Think 2", content: "" },
        { thinking: "", content: "Text 2" },
        { thinking: "Think 3", content: "" },
        { thinking: "", content: "Text 3" },
      ];

      chunks.forEach((chunk) => {
        if (chunk.thinking) {
          streamer.processChunk({
            content: "",
            additional_kwargs: {
              delta: {
                reasoning: chunk.thinking,
              },
            },
          });
        } else {
          streamer.processChunk({
            content: chunk.content,
            additional_kwargs: {},
          });
        }
      });

      // Should have three separate think blocks
      const thinkMatches = currentMessage.match(/<think>/g);
      const thinkCloseMatches = currentMessage.match(/<\/think>/g);
      expect(thinkMatches?.length).toBe(3);
      expect(thinkCloseMatches?.length).toBe(3);

      // Each text should be outside think blocks
      expect(currentMessage).toContain("</think>Text 1");
      expect(currentMessage).toContain("</think>Text 2");
      expect(currentMessage).toContain("</think>Text 3");
    });
  });
});
