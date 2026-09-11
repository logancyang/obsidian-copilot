// This suite keeps the real envelope engine and selected-text formatter; the L2 and
// parsing suites mock those collaborators to isolate their separate contracts.
import { PromptContextEnvelope } from "@/context/PromptContextTypes";
import { App } from "obsidian";
import { ChainType } from "@/chainType";
import { ContextManager } from "@/core/ContextManager";
import { MessageRepository } from "@/core/MessageRepository";
import { FileParserManager } from "@/tools/FileParserManager";
import { ChatMessage, SelectedTextContext } from "@/types/message";

const mockComposerSelection: SelectedTextContext[] = [
  {
    id: "composer",
    sourceType: "web",
    title: "Unsent",
    url: "https://example.com/unsent",
    content: "Unsent selection B",
  },
];
jest.mock("@/aiParams", () => ({ getSelectedTextContexts: () => mockComposerSelection }));
jest.mock("@/settings/model", () => ({ getSettings: () => ({ autoCompactThreshold: Infinity }) }));
jest.mock("@/logger");
jest.mock("@/commands/customCommandUtils", () => ({
  processPrompt: async (_app: App, text: string) => ({ processedPrompt: text, includedFiles: [] }),
}));
jest.mock("@/mentions/Mention", () => ({ Mention: { getInstance: () => ({}) } }));
jest.mock("@/contextProcessor", () => {
  const actual = jest.requireActual<typeof import("@/contextProcessor")>("@/contextProcessor");
  return {
    ContextProcessor: {
      getInstance: () => ({
        processContextNotes: async () => "",
        processContextWebTabs: async () => "",
        processSelectedTextContexts: actual.ContextProcessor.prototype.processSelectedTextContexts,
      }),
    },
  };
});

describe("ContextManager", () => {
  describe("ContextManager", () => {
    describe("reprocessMessageContext()", () => {
      it("preserves the message selection instead of substituting unsent composer text on retry (https://github.com/logancyang/obsidian-copilot/issues/3210)", async () => {
        const message: ChatMessage = {
          id: "user-1",
          sender: "user",
          message: "Explain this",
          timestamp: null,
          isVisible: true,
          context: {
            notes: [],
            urls: [],
            selectedTextContexts: [
              {
                id: "original",
                sourceType: "web",
                title: "Original",
                url: "https://example.com/original",
                content: "Original selection A",
              },
            ],
          },
        };
        const updateProcessedText = jest.fn();
        const repo = {
          getMessage: () => message,
          getDisplayMessages: () => [message],
          updateProcessedText,
        } as unknown as MessageRepository;
        const app = { vault: {} } as App;
        await ContextManager.getInstance().reprocessMessageContext(
          app,
          "user-1",
          repo,
          {} as FileParserManager,
          app.vault,
          ChainType.LLM_CHAIN,
          false,
          null,
          "Updated vault instructions"
        );
        const envelope = updateProcessedText.mock.calls[0][2] as PromptContextEnvelope;
        expect(envelope.serializedText).toContain("Original selection A");
        expect(envelope.serializedText).not.toContain("Unsent selection B");
        expect(envelope.layers.find((layer) => layer.id === "L1_SYSTEM")?.text).toBe(
          "Updated vault instructions"
        );
      });
    });
  });
});
