import { ChainType } from "@/chainType";
import { ContextManager } from "@/core/ContextManager";
import { MessageRepository } from "@/core/MessageRepository";
import { ContextProcessor } from "@/contextProcessor";
import { PDF_NEEDS_MIYO_MESSAGE } from "@/miyo/miyoDocParsers";
import { FileParserManager } from "@/tools/FileParserManager";
import { ChatMessage } from "@/types/message";
import * as obsidianModule from "obsidian";
import { App, TFile, Vault } from "obsidian";

jest.mock("@/selection/selectionStore", () => ({ getSelectedTextContexts: () => [] }));
jest.mock("@/settings/model", () => ({
  getSettings: () => ({
    autoCompactThreshold: Infinity,
    enableMiyoDocumentProcessing: false,
    convertedDocOutputFolder: "",
  }),
}));
jest.mock("@/logger");
jest.mock("@/commands/customCommandUtils", () => ({
  processPrompt: async (_app: App, text: string) => ({ processedPrompt: text, includedFiles: [] }),
}));
jest.mock("@/mentions/Mention", () => ({
  Mention: { getInstance: () => ({ processUrlList: async () => ({ urlContext: "" }) }) },
}));

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

const TFileConstructor = TFile as unknown as new (path: string) => TFile;

describe("ContextManager", () => {
  describe("ContextManager", () => {
    describe("processMessageContext()", () => {
      const requestUrl = jest.fn();
      const notes = new Map<string, TFile>();
      const noteBodies = new Map<string, string>();

      const addFile = (path: string, body = ""): TFile => {
        const file = new TFileConstructor(path);
        notes.set(path, file);
        noteBodies.set(path, body);
        return file;
      };

      const process = async (
        context: { notes: TFile[] },
        activeNote: TFile | null = null
      ): Promise<string> => {
        const app = {
          metadataCache: { getFirstLinkpathDest: (link: string) => notes.get(link) ?? null },
        } as unknown as App;
        const vault = {
          read: async (file: TFile) => noteBodies.get(file.path) ?? "",
          getAbstractFileByPath: (path: string) => notes.get(path) ?? null,
          adapter: { stat: async () => ({ ctime: 0, mtime: 0 }) },
        } as unknown as Vault;
        ContextProcessor.getInstance(app);
        const message: ChatMessage = {
          id: "user-1",
          sender: "user",
          message: "Summarize these",
          timestamp: null,
          isVisible: true,
          context: { notes: context.notes, urls: [] },
        };
        const repo = {
          getDisplayMessages: () => [message],
        } as unknown as MessageRepository;

        const { processedContent } = await ContextManager.getInstance().processMessageContext(
          app,
          message,
          new FileParserManager(),
          vault,
          ChainType.COPILOT_PLUS_CHAIN,
          activeNote !== null,
          activeNote,
          repo
        );
        return processedContent;
      };

      const countOf = (text: string, fragment: string): number => text.split(fragment).length - 1;

      beforeEach(() => {
        notes.clear();
        noteBodies.clear();
        requestUrl.mockReset();
        setRequestUrlImpl(requestUrl);
      });

      it("explains the Miyo and Agent Chat route for an active-note PDF without a cloud request when Miyo document processing is off https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        const paper = addFile("paper.pdf");

        const content = await process({ notes: [] }, paper);

        expect(content).toContain("<active_note>");
        expect(content).toContain(PDF_NEEDS_MIYO_MESSAGE);
        expect(content).toContain("Miyo");
        expect(content).toContain("Agent Chat");
        expect(requestUrl).not.toHaveBeenCalled();
      });

      it("explains the route for a mentioned or dropped PDF without a cloud request when Miyo document processing is off https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        const report = addFile("report.pdf");

        const content = await process({ notes: [report] });

        expect(countOf(content, PDF_NEEDS_MIYO_MESSAGE)).toBe(1);
        expect(content).toContain("<title>report</title>");
        expect(requestUrl).not.toHaveBeenCalled();
      });

      it("explains the route for a PDF embedded in a note as ![[x.pdf]] without a cloud request https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        const source = addFile("Source.md", "Intro\n![[slides.pdf]]\nOutro");
        addFile("slides.pdf");

        const content = await process({ notes: [source] });

        expect(content).toContain("<name>slides.pdf</name>");
        expect(countOf(content, PDF_NEEDS_MIYO_MESSAGE)).toBe(1);
        expect(requestUrl).not.toHaveBeenCalled();
      });

      it("explains the route once per send when the active note, a mentioned PDF and two embeds are all unreadable https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        const active = addFile("active.pdf");
        const mentioned = addFile("mentioned.pdf");
        const source = addFile("Source.md", "![[one.pdf]]\n![[two.pdf]]");
        addFile("one.pdf");
        addFile("two.pdf");

        const content = await process({ notes: [mentioned, source] }, active);

        expect(countOf(content, PDF_NEEDS_MIYO_MESSAGE)).toBe(1);
        expect(countOf(content, "Same reason as the other unreadable PDF in this message.")).toBe(
          3
        );
        expect(requestUrl).not.toHaveBeenCalled();
      });

      it("keeps a note that quotes the message intact when no PDF is in the send https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        const savedChat = addFile(
          "Saved chat.md",
          `First error: ${PDF_NEEDS_MIYO_MESSAGE}\nSecond error: ${PDF_NEEDS_MIYO_MESSAGE}`
        );

        const content = await process({ notes: [savedChat] });

        expect(countOf(content, PDF_NEEDS_MIYO_MESSAGE)).toBe(2);
        expect(content).not.toContain("Same reason as the other unreadable PDF in this message.");
      });

      it("explains the route again on the next send https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        const report = addFile("report.pdf");

        await process({ notes: [report] });
        const second = await process({ notes: [report] });

        expect(countOf(second, PDF_NEEDS_MIYO_MESSAGE)).toBe(1);
      });
    });
  });
});
