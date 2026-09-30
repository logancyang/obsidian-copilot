import { buildPromptDebugReport } from "./toolPromptDebugger";
import { PromptSection } from "./modelAdapter";

const systemSections: PromptSection[] = [
  { id: "base", label: "Base System Prompt", source: "base-source", content: "base content" },
  { id: "intro", label: "Intro", source: "intro-source", content: "intro content" },
];

describe("toolPromptDebugger", () => {
  describe("buildPromptDebugReport()", () => {
    it("lists system sections, restored history and both user messages, annotating each section with its source", () => {
      const report = buildPromptDebugReport({
        systemSections,
        rawHistory: [
          { type: "human", content: "Previous user question" },
          { type: "ai", content: "Assistant reply" },
        ],
        adapterName: "BaseModelAdapter",
        originalUserMessage: "What is the plan?",
        enhancedUserMessage: "What is the plan?",
      });

      expect(report.sections.map((section) => section.id)).toEqual([
        "base",
        "intro",
        "chat-history",
        "user-original-message",
        "user-enhanced-message",
      ]);
      expect(report.annotatedPrompt).toContain(
        "[Section: Base System Prompt | Source: base-source]"
      );
      expect(report.annotatedPrompt).toContain("1. USER\nPrevious user question");
      expect(report.annotatedPrompt).toContain("2. ASSISTANT\nAssistant reply");
      expect(report.systemPrompt).toBe("base content\n\nintro content");
    });

    it("labels the enhanced message section unchanged when the adapter left the message as typed", () => {
      const report = buildPromptDebugReport({
        systemSections,
        adapterName: "BaseModelAdapter",
        originalUserMessage: "What is the plan?",
        enhancedUserMessage: "What is the plan?",
      });

      const enhanced = report.sections[report.sections.length - 1];
      expect(enhanced.label).toBe(
        "User message after BaseModelAdapter.enhanceUserMessage (unchanged)"
      );
    });

    it("omits the unchanged marker and shows the adapter's rewrite when the message was enhanced", () => {
      const report = buildPromptDebugReport({
        systemSections,
        adapterName: "GPTModelAdapter",
        originalUserMessage: "find my notes",
        enhancedUserMessage: "find my notes\n\nREMINDER",
      });

      const enhanced = report.sections[report.sections.length - 1];
      expect(enhanced.label).toBe("User message after GPTModelAdapter.enhanceUserMessage");
      expect(enhanced.content).toBe("find my notes\n\nREMINDER");
    });

    it("adds no chat-history section when the history holds no user or assistant turns", () => {
      const report = buildPromptDebugReport({
        systemSections,
        rawHistory: [{ type: "system", content: "ignored" }],
        adapterName: "BaseModelAdapter",
        originalUserMessage: "Hi",
        enhancedUserMessage: "Hi",
      });

      expect(report.sections.map((section) => section.id)).not.toContain("chat-history");
    });
  });
});
