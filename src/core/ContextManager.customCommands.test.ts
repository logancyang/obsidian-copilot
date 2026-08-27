import type { App, Vault } from "obsidian";

import { ChainType } from "@/chainType";
import { processPrompt } from "@/commands/customCommandUtils";
import { getCachedCustomCommands } from "@/commands/state";
import type { PromptContextEnvelope } from "@/context/PromptContextTypes";
import type { ChatMessage } from "@/types/message";

jest.mock("@/aiParams", () => ({
  getSelectedTextContexts: jest.fn().mockReturnValue([]),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ autoCompactThreshold: 100_000 }),
}));

jest.mock("@/commands/customCommandUtils", () => ({
  processPrompt: jest.fn(async (_app, prompt: string) => ({
    processedPrompt: prompt,
    includedFiles: [],
  })),
}));

jest.mock("@/commands/state", () => ({
  getCachedCustomCommands: jest.fn().mockReturnValue([]),
}));

const mockProcessContextNotes = jest.fn().mockResolvedValue("");
const mockProcessSelectedTextContexts = jest.fn().mockReturnValue("");
const mockProcessContextWebTabs = jest.fn().mockResolvedValue("");

jest.mock("@/contextProcessor", () => ({
  ContextProcessor: {
    getInstance: jest.fn(() => ({
      processContextNotes: mockProcessContextNotes,
      processSelectedTextContexts: mockProcessSelectedTextContexts,
      processContextWebTabs: mockProcessContextWebTabs,
    })),
  },
}));

jest.mock("@/mentions/Mention", () => ({
  Mention: {
    getInstance: jest.fn(() => ({ processUrlList: jest.fn() })),
  },
}));

const mockContextEnvelope = { version: 1 } as PromptContextEnvelope;
jest.mock("@/context/PromptContextEngine", () => ({
  PromptContextEngine: {
    getInstance: jest.fn(() => ({ buildEnvelope: jest.fn(() => mockContextEnvelope) })),
  },
}));

jest.mock("./ContextCompactor", () => ({}));

import { ContextManager } from "@/core/ContextManager";
import type { FileParserManager } from "@/tools/FileParserManager";
import type { MessageRepository } from "@/core/MessageRepository";

describe("ContextManager", () => {
  describe("processMessageContext()", () => {
    it("processes the saved prompt behind a Quick Chat slash alias during send and reprocessing (https://github.com/logancyang/obsidian-copilot/issues/2960#issuecomment-5445353610)", async () => {
      const command = {
        title: "summarize",
        content: "Summarize the active note.",
        showInContextMenu: false,
        showInSlashMenu: true,
        order: 0,
        modelKey: "",
        lastUsedMs: 0,
      };
      const message: ChatMessage = {
        id: "msg-1",
        message: "/summarize focus on decisions",
        originalMessage: "/summarize focus on decisions",
        sender: "user",
        timestamp: null,
        isVisible: true,
        context: { notes: [], urls: [], selectedTextContexts: [] },
      };
      const messageRepo = {
        getDisplayMessages: jest.fn(() => [message]),
      } as unknown as MessageRepository;
      const app = {} as App;
      const vault = {} as Vault;

      (getCachedCustomCommands as jest.Mock).mockReturnValue([command]);

      const result = await ContextManager.getInstance().processMessageContext(
        app,
        message,
        {} as FileParserManager,
        vault,
        ChainType.LLM_CHAIN,
        false,
        null,
        messageRepo
      );

      expect(processPrompt).toHaveBeenCalledWith(
        app,
        "Summarize the active note.\n\nfocus on decisions",
        "",
        vault,
        null
      );
      expect(result.processedContent).toBe("Summarize the active note.\n\nfocus on decisions");
      expect(result.contextEnvelope).toBe(mockContextEnvelope);
    });
  });
});
