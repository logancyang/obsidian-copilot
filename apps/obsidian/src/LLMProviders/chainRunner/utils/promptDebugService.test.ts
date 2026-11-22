import type ChainManager from "@/LLMProviders/chainManager";
import { mockTFile } from "@/__tests__/mockObsidian";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ModelAdapterFactory } from "./modelAdapter";
import { generatePromptDebugReportForAgent, resolveBasePrompt } from "./promptDebugService";

jest.mock("@/logger");

function gptAdapter() {
  return ModelAdapterFactory.createAdapter({ modelName: "gpt-4" } as unknown as BaseChatModel);
}

function createChainContext(history: unknown[] = []): ChainManager {
  return {
    memoryManager: {
      getMemory: () => ({ loadMemoryVariables: jest.fn().mockResolvedValue({ history }) }),
    },
  } as unknown as ChainManager;
}

describe("promptDebugService", () => {
  describe("generatePromptDebugReportForAgent()", () => {
    it("reports the system prompt, restored history and original and adapter-enhanced user message in order", async () => {
      const report = await generatePromptDebugReportForAgent({
        chainManager: createChainContext([
          { type: "human", content: "hello" },
          { type: "ai", content: "hi" },
        ]),
        adapter: gptAdapter(),
        basePrompt: "BasePrompt",
        toolDescriptions: "<tool>localSearch</tool>",
        toolNames: ["localSearch"],
        toolMetadata: [],
        userMessage: {
          message: "search my notes",
          originalMessage: "search my notes",
          sender: "user",
          timestamp: null,
          isVisible: true,
        },
      });

      const sectionIds = report.sections.map((section) => section.id);
      expect(sectionIds[0]).toBe("base-system-prompt");
      expect(sectionIds.slice(-3)).toEqual([
        "chat-history",
        "user-original-message",
        "user-enhanced-message",
      ]);
      expect(report.systemPrompt).toContain("BasePrompt");
      expect(report.systemPrompt).toContain("<tool>localSearch</tool>");
      const enhanced = report.sections[report.sections.length - 1];
      expect(enhanced.content).toBe("search my notes\n\nREMINDER: Call the localSearch tool now.");
      expect(report.annotatedPrompt).toContain("1. USER\nhello\n\n2. ASSISTANT\nhi");
    });

    it("uses the original message, not the enhanced chat text, for the original-message section", async () => {
      const report = await generatePromptDebugReportForAgent({
        chainManager: createChainContext(),
        adapter: gptAdapter(),
        basePrompt: "BasePrompt",
        toolDescriptions: "",
        toolNames: [],
        toolMetadata: [],
        userMessage: {
          message: "fix the typo\n\n<note_context>...</note_context>",
          originalMessage: "fix the typo",
          sender: "user",
          timestamp: null,
          isVisible: true,
        },
      });

      const original = report.sections.find((section) => section.id === "user-original-message");
      expect(original?.content).toBe("fix the typo");
    });
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
