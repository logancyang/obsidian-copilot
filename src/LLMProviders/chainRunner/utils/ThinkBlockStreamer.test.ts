import { ThinkBlockStreamer } from "./ThinkBlockStreamer";

describe("ThinkBlockStreamer", () => {
  describe("OpenRouter reasoning_details format", () => {
    it("should handle reasoning_details with text content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // First chunk with reasoning_details containing text
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [
            {
              text: "Let me think about this problem...",
            },
          ],
        },
      });

      expect(currentMessage).toBe("\n<think>Let me think about this problem...");

      // Second chunk with more reasoning
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [
            {
              text: " I need to consider several factors.",
            },
          ],
        },
      });

      expect(currentMessage).toBe(
        "\n<think>Let me think about this problem... I need to consider several factors."
      );

      // Third chunk with regular content (should close think block)
      streamer.processChunk({
        content: "Here is my answer.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe(
        "\n<think>Let me think about this problem... I need to consider several factors.</think>Here is my answer."
      );

      const result = streamer.close();
      expect(result.content).toBe(
        "\n<think>Let me think about this problem... I need to consider several factors.</think>Here is my answer."
      );
    });

    it("should handle reasoning_details with summary content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [
            {
              summary: "Analyzed the problem systematically",
            },
          ],
        },
      });

      expect(currentMessage).toBe("\n<think>Analyzed the problem systematically");

      streamer.processChunk({
        content: "Based on my analysis, the answer is 42.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe(
        "\n<think>Analyzed the problem systematically</think>Based on my analysis, the answer is 42."
      );
    });

    it("should handle encrypted reasoning_details", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [
            {
              encrypted: true,
            },
          ],
        },
      });

      expect(currentMessage).toBe("\n<think>[Encrypted reasoning]");

      streamer.processChunk({
        content: "The answer is available.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("\n<think>[Encrypted reasoning]</think>The answer is available.");
    });

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
  });

  describe("Proper <think> tag placement", () => {
    it("should close <think> tag BEFORE regular content, not after", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Thinking content
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [{ text: "Analyzing..." }],
        },
      });

      expect(currentMessage).toBe("\n<think>Analyzing...");

      // Regular content with empty reasoning_details
      // This should close </think> BEFORE adding "20 minutes"
      streamer.processChunk({
        content: "20 minutes",
        additional_kwargs: {
          reasoning_details: [],
        },
      });

      // Bug was: "(</think>20 minutes)"
      // Correct: "</think>20 minutes" or "20 minutes" (if properly closed)
      expect(currentMessage).toBe("\n<think>Analyzing...</think>20 minutes");
      expect(currentMessage).not.toMatch(/\(.*<\/think>.*\)/);
    });

    it("should handle multiple transitions between thinking and regular content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // First thinking block
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [{ text: "First thought" }],
        },
      });

      // Regular content
      streamer.processChunk({
        content: "First answer. ",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("\n<think>First thought</think>First answer. ");

      // Second thinking block
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [{ text: "Second thought" }],
        },
      });

      // More regular content
      streamer.processChunk({
        content: "Second answer.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe(
        "\n<think>First thought</think>First answer. \n<think>Second thought</think>Second answer."
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
    it("should skip thinking content when excludeThinking is true", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer(
        (msg) => {
          currentMessage = msg;
        },
        undefined,
        true // excludeThinking = true
      );

      // Thinking content should be skipped
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [{ text: "This should be skipped" }],
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
        undefined,
        true
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

  describe("close() method", () => {
    it("should close any open think block at the end", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [{ text: "Thinking..." }],
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
          reasoning_details: [{ text: "Thinking..." }],
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
    it("should handle chunks with both reasoning_details and regular content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Chunk with both reasoning and content
      streamer.processChunk({
        content: "Some text here",
        additional_kwargs: {
          reasoning_details: [{ text: "Thinking first" }],
        },
      });

      // Reasoning should be wrapped, content should be outside
      expect(currentMessage).toBe("\n<think>Thinking first</think>Some text here");
    });

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
              reasoning_details: [{ text: chunk.thinking }],
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
