import { buildPromptDebugReport } from "./toolPromptDebugger";
import { PromptSection } from "./modelAdapter";

describe("toolPromptDebugger", () => {
  it("builds annotated prompt output with provenance markers", () => {
    const systemSections: PromptSection[] = [
      {
        id: "base",
        label: "Base System Prompt",
        source: "base-source",
        content: "base content",
      },
      {
        id: "intro",
        label: "Intro",
        source: "intro-source",
        content: "intro content",
      },
    ];

    const rawHistory = [
      {
        _getType: () => "human",
        content: "Previous user question",
      },
      {
        _getType: () => "ai",
        content: "Assistant reply",
      },
    ];

    const report = buildPromptDebugReport({
      systemSections,
      rawHistory,
      adapterName: "BaseModelAdapter",
      originalUserMessage: "What is the plan?",
      enhancedUserMessage: "What is the plan?",
    });

    const sectionIds = report.sections.map((section) => section.id);
    expect(sectionIds).toEqual([
      "base",
      "intro",
      "chat-history",
      "user-original-message",
      "user-enhanced-message",
    ]);

    const enhancedSection = report.sections[report.sections.length - 1];
    expect(enhancedSection.label).toContain("unchanged");

    expect(report.annotatedPrompt).toContain("[Section: Base System Prompt | Source: base-source]");
    expect(report.annotatedPrompt).toContain("1. USER");
    expect(report.annotatedPrompt).toContain("2. ASSISTANT");

    expect(report.systemPrompt).toBe("base content\n\nintro content");
  });
});
