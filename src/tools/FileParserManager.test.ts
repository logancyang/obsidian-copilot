const mockSnapshot = jest.fn(() => ({ documentProcessor: "available" }));
const mockRefresh = jest.fn(async () => ({}));
const mockShouldUseMiyo = jest.fn(() => true);
jest.mock("@/miyo/miyoRuntimePolicy", () => ({
  shouldUseMiyo: () => mockShouldUseMiyo(),
  getMiyoCustomUrl: () => "",
}));
jest.mock("@/miyo/miyoStatusStore", () => ({
  isMiyoAvailableForCapability: jest.fn(),
  getMiyoStatusSnapshot: () => mockSnapshot(),
  refreshMiyoStatus: () => mockRefresh(),
}));

const mockResolveBaseUrl = jest.fn();
const mockParseDoc = jest.fn();
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: jest.fn().mockImplementation(() => ({
    resolveBaseUrl: mockResolveBaseUrl,
    parseDoc: mockParseDoc,
  })),
}));

const mockPdfCacheGet = jest.fn();
const mockPdfCacheSet = jest.fn();
jest.mock("@/cache/pdfCache", () => ({
  PDFCache: {
    getInstance: () => ({ get: mockPdfCacheGet, set: mockPdfCacheSet }),
  },
}));

jest.mock("@/utils/convertedDocOutput", () => ({
  saveConvertedDocOutput: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const mockGetSettings = jest.fn<CopilotSettings, []>();
jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

import { isMiyoAvailableForCapability } from "@/miyo/miyoStatusStore";
import type { CopilotSettings } from "@/settings/model";
import * as obsidianModule from "obsidian";
import type { TFile, Vault } from "obsidian";
import {
  Docs4LLMParser,
  FileParserManager,
  PDF_NEEDS_MIYO_MESSAGE,
  PDFParser,
} from "./FileParserManager";

const mockAvailable = isMiyoAvailableForCapability as jest.MockedFunction<
  typeof isMiyoAvailableForCapability
>;

const settings = (over: Partial<CopilotSettings>): CopilotSettings =>
  ({ miyoServerUrl: "", convertedDocOutputFolder: "", ...over }) as CopilotSettings;

const pdf = (name: string): TFile =>
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fixture; not a real TFile
  ({ extension: "pdf", path: `docs/${name}.pdf`, basename: name }) as unknown as TFile;

const epub = (name: string): TFile =>
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fixture; not a real TFile
  ({ extension: "epub", path: `books/${name}.epub`, basename: name }) as unknown as TFile;

const docx = (name: string): TFile =>
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fixture; not a real TFile
  ({ extension: "docx", path: `docs/${name}.docx`, basename: name }) as unknown as TFile;

const vault = { getName: () => "MyVault", readBinary: jest.fn(async () => new ArrayBuffer(8)) };
const asVault = vault as unknown as Vault;

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

const mockRequestUrl = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  setRequestUrlImpl(mockRequestUrl);
  mockPdfCacheGet.mockResolvedValue(null);
  mockResolveBaseUrl.mockResolvedValue("http://localhost:8742");
  mockSnapshot.mockReturnValue({ documentProcessor: "available" });
  mockRefresh.mockResolvedValue({});
  mockShouldUseMiyo.mockReturnValue(true);
});

describe("FileParserManager", () => {
  describe("Docs4LLMParser", () => {
    describe("parseFile()", () => {
      it("parses an EPUB through Miyo with the vault name and vault-relative path when Miyo document processing is on and Miyo is available", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockResolvedValue({ text: "epub text" });

        const result = await new Docs4LLMParser().parseFile(epub("book"), asVault);

        expect(result).toBe("epub text");
        expect(mockParseDoc).toHaveBeenCalledWith(
          "http://localhost:8742",
          "MyVault",
          "books/book.epub"
        );
      });

      it("returns content for a parsable PDF and throws for a failing one in the same batch", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockAvailable.mockReturnValue(true);
        mockParseDoc
          .mockResolvedValueOnce({ text: "extracted one" })
          .mockRejectedValueOnce(new Error("connection reset"));
        const parser = new Docs4LLMParser();

        await expect(parser.parseFile(pdf("a"), asVault)).resolves.toBe("extracted one");
        await expect(parser.parseFile(pdf("b"), asVault)).rejects.toThrow(/Miyo failed to parse b/);
      });

      it.each([
        ["PDF", pdf],
        ["EPUB", epub],
      ])(
        "throws that no processor is available when Miyo document processing is on but Miyo is unavailable for %s files",
        async (_format, makeFile) => {
          mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
          mockAvailable.mockReturnValue(false);

          await expect(new Docs4LLMParser().parseFile(makeFile("a"), asVault)).rejects.toThrow(
            /No document processor available/
          );
          expect(mockParseDoc).not.toHaveBeenCalled();
        }
      );

      it("throws that no processor is available for a non-PDF/EPUB format even when Miyo is available", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockAvailable.mockReturnValue(true);

        await expect(new Docs4LLMParser().parseFile(docx("report"), asVault)).rejects.toThrow(
          /No document processor available/
        );
        expect(mockParseDoc).not.toHaveBeenCalled();
      });

      it("throws without probing Miyo for a PDF when Miyo document processing is off", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: false }));
        mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });

        await expect(new Docs4LLMParser().parseFile(pdf("a"), asVault)).rejects.toThrow(
          /No document processor available/
        );
        expect(mockRefresh).not.toHaveBeenCalled();
        expect(mockParseDoc).not.toHaveBeenCalled();
      });

      it("throws that no processor is available for a non-local format when Miyo document processing is off", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: false }));

        await expect(new Docs4LLMParser().parseFile(docx("report"), asVault)).rejects.toThrow(
          /No document processor available/
        );
      });
    });
  });

  describe("PDFParser", () => {
    describe("parseFile()", () => {
      it("returns the Miyo-extracted text without a network request when Miyo is available", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockResolvedValue({ text: "extracted via miyo" });

        const parser = new PDFParser();
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(result).toBe("extracted via miyo");
        expect(mockPdfCacheSet).toHaveBeenCalledWith(vault, pdf("solo"), {
          response: "extracted via miyo",
        });
        expect(mockRequestUrl).not.toHaveBeenCalled();
      });

      it("returns previously cached text without consulting Miyo even when Miyo document processing is off https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: false }));
        mockPdfCacheGet.mockResolvedValue({ response: "cached earlier", elapsed_time_ms: 1200 });

        const result = await new PDFParser().parseFile(pdf("solo"), asVault);

        expect(result).toBe("cached earlier");
        expect(mockRefresh).not.toHaveBeenCalled();
        expect(mockParseDoc).not.toHaveBeenCalled();
      });

      it("returns an error string without throwing or making a network request when Miyo parsing fails", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockRejectedValue(new Error("endpoint down"));

        const parser = new PDFParser();
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(result).toContain("[Error: Could not extract content from PDF solo");
        expect(mockRequestUrl).not.toHaveBeenCalled();
      });

      it("returns an unavailable error without a network request when Miyo document processing is on but Miyo is unreachable", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockAvailable.mockReturnValue(false);

        const parser = new PDFParser();
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(result).toContain(PDF_NEEDS_MIYO_MESSAGE);
        expect(mockParseDoc).not.toHaveBeenCalled();
        expect(mockRequestUrl).not.toHaveBeenCalled();
      });

      it("refreshes Miyo status once when it is 'unknown' and then routes to Miyo if it became available", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockResolvedValue({ text: "extracted via miyo" });

        const parser = new PDFParser();
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(result).toBe("extracted via miyo");
        expect(mockRequestUrl).not.toHaveBeenCalled();
      });

      it("refreshes once and still fails closed without a network request when a 'stale' status is confirmed unavailable", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockSnapshot.mockReturnValue({ documentProcessor: "stale" });
        mockAvailable.mockReturnValue(false);

        const parser = new PDFParser();
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(result).toContain(PDF_NEEDS_MIYO_MESSAGE);
        expect(mockRequestUrl).not.toHaveBeenCalled();
        expect(mockParseDoc).not.toHaveBeenCalled();
      });

      it("fails closed without refreshing or making a network request when Miyo document processing is on but Miyo is no longer in use", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockShouldUseMiyo.mockReturnValue(false);
        mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });

        const parser = new PDFParser();
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).not.toHaveBeenCalled();
        expect(result).toContain(PDF_NEEDS_MIYO_MESSAGE);
        expect(mockRequestUrl).not.toHaveBeenCalled();
        expect(mockParseDoc).not.toHaveBeenCalled();
      });

      it("does not re-read availability after resolving to Miyo, so a later status flip still returns the Miyo text without a network request", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockSnapshot.mockReturnValue({ documentProcessor: "available" });
        mockAvailable.mockReturnValueOnce(true).mockReturnValue(false);
        mockParseDoc.mockResolvedValue({ text: "extracted via miyo" });

        const parser = new PDFParser();
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockParseDoc).toHaveBeenCalledTimes(1);
        expect(result).toBe("extracted via miyo");
        expect(mockRequestUrl).not.toHaveBeenCalled();
      });

      it("does not refresh Miyo status when it is already conclusive", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockSnapshot.mockReturnValue({ documentProcessor: "available" });
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockResolvedValue({ text: "extracted" });

        const parser = new PDFParser();
        await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).not.toHaveBeenCalled();
      });

      it("returns the Miyo and Agent Chat message without probing Miyo or making a network request when Miyo document processing is off https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: false }));
        mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });

        const parser = new PDFParser();
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).not.toHaveBeenCalled();
        expect(mockRequestUrl).not.toHaveBeenCalled();
        expect(result).toBe(
          `[Error: Could not extract content from PDF solo. ${PDF_NEEDS_MIYO_MESSAGE}]`
        );
      });
    });
  });

  describe("FileParserManager", () => {
    describe("forOneSend()", () => {
      const note = (name: string): TFile =>
        // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fixture; not a real TFile
        ({ extension: "md", path: `${name}.md`, basename: name }) as unknown as TFile;

      beforeEach(() => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: false }));
      });

      it("explains the first unreadable PDF in full and shortens every later one in the same send https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        const send = new FileParserManager().forOneSend();

        const results = [
          await send.parseFile(pdf("a"), asVault),
          await send.parseFile(pdf("b"), asVault),
          await send.parseFile(pdf("c"), asVault),
        ];

        expect(results).toEqual([
          `[Error: Could not extract content from PDF a. ${PDF_NEEDS_MIYO_MESSAGE}]`,
          "[Error: Could not extract content from PDF b. Same reason as the other unreadable PDF in this message.]",
          "[Error: Could not extract content from PDF c. Same reason as the other unreadable PDF in this message.]",
        ]);
      });

      it("explains in full again in the next send https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        const manager = new FileParserManager();
        await manager.forOneSend().parseFile(pdf("a"), asVault);

        const next = await manager.forOneSend().parseFile(pdf("a"), asVault);

        expect(next).toContain(PDF_NEEDS_MIYO_MESSAGE);
      });

      it("returns note text that quotes the message unchanged after a PDF was explained https://github.com/Brevilabs/obsidian-copilot-private/issues/653", async () => {
        const quoted = `${PDF_NEEDS_MIYO_MESSAGE}\n${PDF_NEEDS_MIYO_MESSAGE}`;
        const noteVault = { ...vault, read: async () => quoted } as unknown as Vault;
        const send = new FileParserManager().forOneSend();
        await send.parseFile(pdf("a"), noteVault);

        expect(await send.parseFile(note("Saved chat"), noteVault)).toBe(quoted);
      });
    });
  });
});
