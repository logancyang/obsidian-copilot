import { ThinkBlockStreamer } from "./ThinkBlockStreamer";

describe("ThinkBlockStreamer", () => {
  describe("OpenRouter delta.reasoning format", () => {
    it("should NOT treat empty reasoning_details array as thinking content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "Regular content",
        additional_kwargs: {
          reasoning_details: [],
        },
      });

      expect(currentMessage).toBe("Regular content");
      expect(currentMessage).not.toContain("<think>");
    });

    it("should handle delta.reasoning for streaming", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking step 1: ",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1: ");

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking step 2.",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1: Thinking step 2.");

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

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Analyzing the ",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Analyzing the ");

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "question carefully.",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Analyzing the question carefully.");

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [
            {
              text: "Analyzing the question carefully.",
            },
          ],
        },
      });

      expect(currentMessage).toBe("\n<think>Analyzing the question carefully.");
      expect(currentMessage).not.toContain(
        "Analyzing the question carefully.Analyzing the question carefully."
      );

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

      streamer.processChunk({
        content: [
          {
            type: "thinking",
            thinking: "Let me analyze this...",
          },
        ],
      });

      expect(currentMessage).toBe("\n<think>Let me analyze this...");

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

      streamer.processChunk({
        content: [
          {
            type: "thinking",
          },
        ],
      });

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

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: undefined,
        },
      });

      expect(currentMessage).toBe("");
      expect(currentMessage).not.toContain("undefined");
      expect(currentMessage).not.toContain("<think>");
    });

    it("should handle streaming Deepseek reasoning_content without premature closure", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: "Thinking step 1...",
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1...");

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: " Step 2...",
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1... Step 2...");
      expect(currentMessage).not.toContain("</think>\n<think>");

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
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      }, true);

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "This should be skipped",
          },
        },
      });

      expect(currentMessage).toBe("");

      streamer.processChunk({
        content: "This should be included",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("This should be included");
    });

    it("should skip Claude thinking content when excludeThinking is true", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      }, true);

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

      const thinkMatches = currentMessage.match(/<think>/g);
      const thinkCloseMatches = currentMessage.match(/<\/think>/g);
      expect(thinkMatches?.length).toBe(3);
      expect(thinkCloseMatches?.length).toBe(3);

      expect(currentMessage).toContain("</think>Text 1");
      expect(currentMessage).toContain("</think>Text 2");
      expect(currentMessage).toContain("</think>Text 3");
    });
  });
});
