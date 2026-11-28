import { ModelAdapterFactory, joinPromptSections, messageRequiresTools } from "./modelAdapter";
import { ToolMetadata } from "@/tools/ToolRegistry";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

jest.mock("@/logger");

const BASE_PROMPT = "You are a helpful assistant.";
const TOOL_DESCRIPTIONS = "Tool descriptions here";

function adapterFor(modelName: string) {
  return ModelAdapterFactory.createAdapter({ modelName } as unknown as BaseChatModel);
}

function createToolMetadata(id: string, instructions: string): ToolMetadata {
  return {
    id,
    displayName: `${id} Display`,
    description: `${id} description`,
    category: "custom",
    customPromptInstructions: instructions,
  };
}

describe("modelAdapter", () => {
  describe("ModelAdapterFactory", () => {
    describe("createAdapter()", () => {
      it("gives gpt models the GPT-specific prompt guidance", () => {
        const prompt = adapterFor("gpt-4").enhanceSystemPrompt(
          BASE_PROMPT,
          TOOL_DESCRIPTIONS,
          [],
          []
        );

        expect(prompt).toContain("CRITICAL FOR GPT MODELS");
        expect(prompt).toContain("FINAL REMINDER FOR GPT MODELS");
      });

      it("gives claude models the Claude thinking-model prompt guidance", () => {
        const prompt = adapterFor("claude-3-7-sonnet").enhanceSystemPrompt(
          BASE_PROMPT,
          TOOL_DESCRIPTIONS,
          [],
          []
        );

        expect(prompt).toContain("IMPORTANT FOR CLAUDE THINKING MODELS");
      });

      it("gives gemini models the Gemini prompt guidance", () => {
        const prompt = adapterFor("gemini-pro").enhanceSystemPrompt(
          BASE_PROMPT,
          TOOL_DESCRIPTIONS,
          [],
          []
        );

        expect(prompt).toContain("CRITICAL INSTRUCTIONS FOR GEMINI");
      });
    });
  });

  describe("ModelAdapter", () => {
    describe("enhanceSystemPrompt()", () => {
      it("builds the agent-mode prompt structure around the base prompt", () => {
        const prompt = adapterFor("gpt-4").enhanceSystemPrompt(
          BASE_PROMPT,
          TOOL_DESCRIPTIONS,
          [],
          []
        );

        expect(prompt).toContain("# Autonomous Agent Mode");
        expect(prompt).toContain("## Time-based Queries");
        expect(prompt).toContain("## General Guidelines");
      });

      it("includes the custom instructions of every enabled tool", () => {
        const toolMetadata = [
          createToolMetadata("localSearch", "LocalSearch specific instructions"),
          createToolMetadata("webSearch", "WebSearch specific instructions"),
          createToolMetadata("writeFile", "WriteToFile specific instructions"),
        ];

        const prompt = adapterFor("gpt-4").enhanceSystemPrompt(
          BASE_PROMPT,
          TOOL_DESCRIPTIONS,
          ["localSearch", "webSearch", "writeFile"],
          toolMetadata
        );

        expect(prompt).toContain("LocalSearch specific instructions");
        expect(prompt).toContain("WebSearch specific instructions");
        expect(prompt).toContain("WriteToFile specific instructions");
      });

      it("leaves out the instructions of tools that are not enabled", () => {
        const prompt = adapterFor("gpt-4").enhanceSystemPrompt(
          BASE_PROMPT,
          TOOL_DESCRIPTIONS,
          ["localSearch"],
          [createToolMetadata("localSearch", "LocalSearch specific instructions")]
        );

        expect(prompt).toContain("LocalSearch specific instructions");
        expect(prompt).not.toContain("WebSearch specific instructions");
        expect(prompt).not.toContain("WriteToFile specific instructions");
      });

      it("adds no tool instructions when no tool metadata is supplied", () => {
        const prompt = adapterFor("gpt-4").enhanceSystemPrompt(
          BASE_PROMPT,
          TOOL_DESCRIPTIONS,
          ["localSearch", "webSearch"],
          []
        );

        expect(prompt).not.toContain("LocalSearch specific instructions");
        expect(prompt).not.toContain("WebSearch specific instructions");
      });

      it("adds composer editing examples for GPT when the file tools are enabled", () => {
        const prompt = adapterFor("gpt-4").enhanceSystemPrompt(
          BASE_PROMPT,
          TOOL_DESCRIPTIONS,
          ["editFile", "writeFile"],
          []
        );

        expect(prompt).toContain("FILE EDITING WITH COMPOSER TOOLS");
        expect(prompt).toContain("oldText");
      });
    });

    describe("buildSystemPromptSections()", () => {
      it("returns sections that join into exactly the enhanceSystemPrompt output, starting with the base prompt", () => {
        const adapter = adapterFor("gpt-4");

        const sections = adapter.buildSystemPromptSections(BASE_PROMPT, TOOL_DESCRIPTIONS, [], []);
        const prompt = adapter.enhanceSystemPrompt(BASE_PROMPT, TOOL_DESCRIPTIONS, [], []);

        expect(sections[0].id).toBe("base-system-prompt");
        expect(joinPromptSections(sections)).toEqual(prompt);
        expect(prompt).toContain("Available tools:\nTool descriptions here");
        expect(prompt).not.toContain("Available tools:\n\nTool descriptions here");
      });
    });

    describe("enhanceUserMessage()", () => {
      it("appends the GPT file-editing reminder to an edit request when tools are required", () => {
        const enhanced = adapterFor("gpt-4").enhanceUserMessage("fix the typo in my note", true);

        expect(enhanced).toContain("GPT REMINDER");
        expect(enhanced).toContain("oldText/newText parameters");
      });

      it("returns the message unchanged when no tools are required", () => {
        expect(adapterFor("gpt-4").enhanceUserMessage("fix the typo", false)).toBe("fix the typo");
      });
    });
  });

  describe("joinPromptSections()", () => {
    it("joins section contents with a blank line and skips sections with blank content", () => {
      const section = (id: string, content: string) => ({
        id,
        label: id,
        source: "test",
        content,
      });

      expect(
        joinPromptSections([section("a", "First"), section("b", "  \n"), section("c", "Third")])
      ).toBe("First\n\nThird");
    });
  });

  describe("messageRequiresTools()", () => {
    it.each(["Find my meeting notes", "what time is it", "summarize this youtube video"])(
      "returns true for %j",
      (message) => {
        expect(messageRequiresTools(message)).toBe(true);
      }
    );

    it("returns false for a message that needs no tool", () => {
      expect(messageRequiresTools("Explain recursion briefly")).toBe(false);
    });
  });
});
