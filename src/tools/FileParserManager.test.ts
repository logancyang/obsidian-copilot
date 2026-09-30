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

import type { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { isMiyoAvailableForCapability } from "@/miyo/miyoStatusStore";
import type { CopilotSettings } from "@/settings/model";
import type { TFile, Vault } from "obsidian";
import { Docs4LLMParser, PDFParser } from "./FileParserManager";

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

beforeEach(() => {
  jest.clearAllMocks();
  mockPdfCacheGet.mockResolvedValue(null);
  mockResolveBaseUrl.mockResolvedValue("http://localhost:8742");
  mockSnapshot.mockReturnValue({ documentProcessor: "available" });
  mockRefresh.mockResolvedValue({});
  mockShouldUseMiyo.mockReturnValue(true);
});

describe("FileParserManager", () => {
  describe("Docs4LLMParser", () => {
    describe("parseFile()", () => {
      it("parses an EPUB through Miyo with the vault name and vault-relative path when Miyo is the chosen backend and is available", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
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
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
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
        "throws instead of falling back to cloud when the chosen Miyo backend is unavailable for %s files",
        async (_format, makeFile) => {
          mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
          mockAvailable.mockReturnValue(false);

          await expect(new Docs4LLMParser().parseFile(makeFile("a"), asVault)).rejects.toThrow(
            /Miyo.*is unavailable/
          );
          expect(mockParseDoc).not.toHaveBeenCalled();
        }
      );

      it("throws that no processor is available for a non-PDF/EPUB format even when Miyo is available", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
        mockAvailable.mockReturnValue(true);

        await expect(new Docs4LLMParser().parseFile(docx("report"), asVault)).rejects.toThrow(
          /No document processor available/
        );
        expect(mockParseDoc).not.toHaveBeenCalled();
      });

      it("throws that no processor is available for a non-local format when the backend is Plus", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "plus" }));

        await expect(new Docs4LLMParser().parseFile(docx("report"), asVault)).rejects.toThrow(
          /No document processor available/
        );
      });
    });
  });

  describe("PDFParser", () => {
    describe("parseFile()", () => {
      it("returns the Miyo-extracted text without calling the cloud when Miyo is available", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockResolvedValue({ text: "extracted via miyo" });
        const pdf4llm = jest.fn();

        const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(result).toBe("extracted via miyo");
        expect(pdf4llm).not.toHaveBeenCalled();
      });

      it("returns an error string rather than throwing or falling back to cloud when Miyo parsing fails", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockRejectedValue(new Error("endpoint down"));
        const pdf4llm = jest.fn();

        const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(result).toContain("[Error: Could not extract content from PDF solo");
        expect(pdf4llm).not.toHaveBeenCalled();
      });

      it("returns an unavailable error and never uploads to cloud when the chosen Miyo backend is unreachable", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
        mockAvailable.mockReturnValue(false);
        const pdf4llm = jest.fn().mockResolvedValue({ response: "cloud pdf" });

        const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(result).toContain("Miyo (local document processor) is unavailable");
        expect(mockParseDoc).not.toHaveBeenCalled();
        expect(pdf4llm).not.toHaveBeenCalled();
      });

      it("refreshes Miyo status once when it is 'unknown' and then routes to Miyo if it became available", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
        mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockResolvedValue({ text: "extracted via miyo" });
        const pdf4llm = jest.fn();

        const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(result).toBe("extracted via miyo");
        expect(pdf4llm).not.toHaveBeenCalled();
      });

      it("refreshes once and still fails closed without cloud when a 'stale' status is confirmed unavailable", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
        mockSnapshot.mockReturnValue({ documentProcessor: "stale" });
        mockAvailable.mockReturnValue(false);
        const pdf4llm = jest.fn().mockResolvedValue({ response: "cloud pdf" });

        const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(result).toContain("Miyo (local document processor) is unavailable");
        expect(pdf4llm).not.toHaveBeenCalled();
        expect(mockParseDoc).not.toHaveBeenCalled();
      });

      it("fails closed without refreshing or calling cloud when the backend is 'miyo' but Miyo is no longer in use", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
        mockShouldUseMiyo.mockReturnValue(false);
        mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });
        const pdf4llm = jest.fn().mockResolvedValue({ response: "cloud pdf" });

        const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).not.toHaveBeenCalled();
        expect(result).toContain("Miyo (local document processor) is unavailable");
        expect(pdf4llm).not.toHaveBeenCalled();
        expect(mockParseDoc).not.toHaveBeenCalled();
      });

      it("does not re-read availability after resolving to Miyo, so a later status flip cannot leak to cloud", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
        mockSnapshot.mockReturnValue({ documentProcessor: "available" });
        mockAvailable.mockReturnValueOnce(true).mockReturnValue(false);
        mockParseDoc.mockResolvedValue({ text: "extracted via miyo" });
        const pdf4llm = jest.fn();

        const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockParseDoc).toHaveBeenCalledTimes(1);
        expect(result).toBe("extracted via miyo");
        expect(pdf4llm).not.toHaveBeenCalled();
      });

      it("does not refresh Miyo status when it is already conclusive", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
        mockSnapshot.mockReturnValue({ documentProcessor: "available" });
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockResolvedValue({ text: "extracted" });

        const parser = new PDFParser({ pdf4llm: jest.fn() } as unknown as BrevilabsClient);
        await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).not.toHaveBeenCalled();
      });

      it("sends the PDF to the cloud without probing Miyo when the backend is 'plus'", async () => {
        mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "plus" }));
        mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });
        const pdf4llm = jest.fn().mockResolvedValue({ response: "cloud pdf" });

        const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
        const result = await parser.parseFile(pdf("solo"), asVault);

        expect(mockRefresh).not.toHaveBeenCalled();
        expect(result).toBe("cloud pdf");
      });
    });
  });
});
