import { generatePromptDebugReportForAgent, resolveBasePrompt } from "./promptDebugService";
import type ChainManager from "@/LLMProviders/chainManager";
import { ModelAdapter, PromptSection } from "./modelAdapter";
import { mockTFile } from "@/__tests__/mockObsidian";
import { PromptDebugReport } from "./toolPromptDebugger";

const createAdapter = () => ({
  buildSystemPromptSections: jest.fn(
    (
      basePrompt: string,
      toolDescriptions: string,
      toolNames?: string[],
      toolMetadata?: unknown[]
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

const createChainContext = (history: unknown[] = []): ChainManager => {
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
  } as unknown as ChainManager;
};

describe("promptDebugService", () => {
  it("builds prompt debug report with annotated sections", async () => {
    const adapter = createAdapter();
    const chainManager = createChainContext([{ type: "human", content: "hello" }]);

    const report: PromptDebugReport = await generatePromptDebugReportForAgent({
      chainManager,
      adapter: adapter as unknown as ModelAdapter,
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

  describe("resolveBasePrompt()", () => {
    it("resolves vault instructions with the provided user memory (https://github.com/logancyang/obsidian-copilot/issues/3210)", async () => {
      const memoryPrompt = "<memory>data</memory>";
      const file = mockTFile({ path: "AGENTS.md", basename: "AGENTS" });
      const chainManager = {
        app: {
          vault: { getAbstractFileByPath: () => file, read: async () => "Cite vault notes." },
        },
        userMemoryManager: {
          getUserMemoryPrompt: jest.fn().mockResolvedValue(memoryPrompt),
        },
      } as unknown as ChainManager;

      const prompt = await resolveBasePrompt(chainManager);
      expect(prompt).toContain(memoryPrompt);
      expect(prompt).toContain("Cite vault notes.");
    });
  });
});
