import { generatePromptDebugReportForAgent, resolveBasePrompt } from "./promptDebugService";
import { PromptSection } from "./modelAdapter";
import { PromptDebugReport } from "./toolPromptDebugger";

const createAdapter = () => ({
  buildSystemPromptSections: jest.fn(
    (
      basePrompt: string,
      toolDescriptions: string,
      toolNames?: string[],
      toolMetadata?: any[]
    ): PromptSection[] => [
      {
        id: "system",
        label: "System",
        source: "test",
        content: `${basePrompt}::${toolDescriptions}::${toolNames?.join(",") || ""}::${
          toolMetadata?.length ?? 0
        }`,
      },
    ]
  ),
  enhanceUserMessage: jest.fn((message: string) => `${message} (enhanced)`),
  constructor: { name: "TestAdapter" },
});

const createChainContext = (history: any[] = []) => {
  const memory = {
    loadMemoryVariables: jest.fn().mockResolvedValue({ history }),
  };

  return {
    memoryManager: {
      getMemory: () => memory,
    },
    userMemoryManager: {
      getUserMemoryPrompt: jest.fn().mockResolvedValue(null),
    },
  } as any;
};

describe("promptDebugService", () => {
  it("builds prompt debug report with annotated sections", async () => {
    const adapter = createAdapter();
    const chainManager = createChainContext([{ _getType: () => "human", content: "hello" }]);

    const report: PromptDebugReport = await generatePromptDebugReportForAgent({
      chainManager,
      adapter: adapter as any,
      basePrompt: "BasePrompt",
      toolDescriptions: "<tool></tool>",
      toolNames: ["localSearch"],
      toolMetadata: [
        {
          id: "localSearch",
          displayName: "Vault Search",
          description: "Search",
          category: "search",
        },
      ],
      userMessage: {
        message: "search my notes",
        originalMessage: "search my notes",
        sender: "user",
        timestamp: null,
        isVisible: true,
      },
    });

    expect(adapter.buildSystemPromptSections).toHaveBeenCalledWith(
      "BasePrompt",
      "<tool></tool>",
      ["localSearch"],
      expect.any(Array)
    );
    expect(adapter.enhanceUserMessage).toHaveBeenCalledWith("search my notes", true);
    expect(report.sections.map((section) => section.id)).toEqual([
      "system",
      "chat-history",
      "user-original-message",
      "user-enhanced-message",
    ]);
    expect(report.annotatedPrompt).toContain("[Section: System | Source: test]");
    expect(report.systemPrompt).toBeDefined();
  });

  it("resolves base prompt using provided user memory manager", async () => {
    const memoryPrompt = "<memory>data</memory>";
    const chainManager = {
      userMemoryManager: {
        getUserMemoryPrompt: jest.fn().mockResolvedValue(memoryPrompt),
      },
    } as any;

    const prompt = await resolveBasePrompt(chainManager);
    expect(prompt).toContain(memoryPrompt);
  });
});
