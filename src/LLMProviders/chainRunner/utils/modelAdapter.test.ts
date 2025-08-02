import { ModelAdapterFactory } from "./modelAdapter";
import { ToolMetadata } from "@/tools/ToolRegistry";

describe("ModelAdapter", () => {
  describe("enhanceSystemPrompt", () => {
    const basePrompt = "You are a helpful assistant.";
    const toolDescriptions = "Tool descriptions here";

    const createToolMetadata = (id: string, instructions: string): ToolMetadata => ({
      id,
      displayName: `${id} Display`,
      description: `${id} description`,
      category: "custom",
      customPromptInstructions: instructions,
    });

    it("should include tool instructions when tools are enabled", () => {
      const mockModel = { modelName: "gpt-4" } as any;
      const adapter = ModelAdapterFactory.createAdapter(mockModel);

      const toolMetadata: ToolMetadata[] = [
        createToolMetadata("localSearch", "LocalSearch specific instructions"),
        createToolMetadata("webSearch", "WebSearch specific instructions"),
        createToolMetadata("writeToFile", "WriteToFile specific instructions"),
      ];

      const enhancedPrompt = adapter.enhanceSystemPrompt(
        basePrompt,
        toolDescriptions,
        ["localSearch", "webSearch", "writeToFile"],
        toolMetadata
      );

      // Check that tool instructions are included
      expect(enhancedPrompt).toContain("LocalSearch specific instructions");
      expect(enhancedPrompt).toContain("WebSearch specific instructions");
      expect(enhancedPrompt).toContain("WriteToFile specific instructions");
    });

    it("should only include instructions for enabled tools", () => {
      const mockModel = { modelName: "gpt-4" } as any;
      const adapter = ModelAdapterFactory.createAdapter(mockModel);

      const toolMetadata: ToolMetadata[] = [
        createToolMetadata("localSearch", "LocalSearch specific instructions"),
        createToolMetadata("webSearch", "WebSearch specific instructions"),
        createToolMetadata("writeToFile", "WriteToFile specific instructions"),
      ];

      // Only pass localSearch as enabled
      const enhancedPrompt = adapter.enhanceSystemPrompt(
        basePrompt,
        toolDescriptions,
        ["localSearch"],
        [toolMetadata[0]] // Only localSearch metadata
      );

      // Should include localSearch instructions
      expect(enhancedPrompt).toContain("LocalSearch specific instructions");

      // Should NOT include other tool instructions
      expect(enhancedPrompt).not.toContain("WebSearch specific instructions");
      expect(enhancedPrompt).not.toContain("WriteToFile specific instructions");
    });

    it("should include base structure elements", () => {
      const mockModel = { modelName: "gpt-4" } as any;
      const adapter = ModelAdapterFactory.createAdapter(mockModel);

      const enhancedPrompt = adapter.enhanceSystemPrompt(basePrompt, toolDescriptions, [], []);

      // Check base sections exist
      expect(enhancedPrompt).toContain("# Autonomous Agent Mode");
      expect(enhancedPrompt).toContain("## Time-based Queries");
      expect(enhancedPrompt).toContain("## General Guidelines");
    });

    it("should handle GPT-specific enhancements", () => {
      const mockModel = { modelName: "gpt-4" } as any;
      const adapter = ModelAdapterFactory.createAdapter(mockModel);

      const enhancedPrompt = adapter.enhanceSystemPrompt(basePrompt, toolDescriptions, [], []);

      // Check GPT-specific sections
      expect(enhancedPrompt).toContain("CRITICAL FOR GPT MODELS");
    });

    it("should handle Claude-specific enhancements", () => {
      const mockModel = { modelName: "claude-3-7-sonnet" } as any;
      const adapter = ModelAdapterFactory.createAdapter(mockModel);

      const enhancedPrompt = adapter.enhanceSystemPrompt(basePrompt, toolDescriptions, [], []);

      // Check Claude-specific sections
      expect(enhancedPrompt).toContain("IMPORTANT FOR CLAUDE THINKING MODELS");
    });

    it("should handle Gemini-specific enhancements", () => {
      const mockModel = { modelName: "gemini-pro" } as any;
      const adapter = ModelAdapterFactory.createAdapter(mockModel);

      const enhancedPrompt = adapter.enhanceSystemPrompt(basePrompt, toolDescriptions, [], []);

      // Check Gemini-specific sections
      expect(enhancedPrompt).toContain("CRITICAL INSTRUCTIONS FOR GEMINI");
    });

    it("should exclude instructions when no metadata provided", () => {
      const mockModel = { modelName: "gpt-4" } as any;
      const adapter = ModelAdapterFactory.createAdapter(mockModel);

      const enhancedPrompt = adapter.enhanceSystemPrompt(
        basePrompt,
        toolDescriptions,
        ["localSearch", "webSearch"],
        [] // No metadata
      );

      // Should not include any tool-specific instructions
      expect(enhancedPrompt).not.toContain("LocalSearch specific instructions");
      expect(enhancedPrompt).not.toContain("WebSearch specific instructions");
    });
  });
});
