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
  MiyoEpubParser,
  PDF_NEEDS_MIYO_MESSAGE,
  PDFParser,
  pdfErrorText,
} from "@/miyo/miyoDocParsers";

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

const vault = { getName: () => "MyVault", readBinary: jest.fn(async () => new ArrayBuffer(8)) };
const asVault = vault as unknown as Vault;

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

const mockRequestUrl = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  setRequestUrlImpl(mockRequestUrl);
  mockResolveBaseUrl.mockResolvedValue("http://localhost:8742");
  mockSnapshot.mockReturnValue({ documentProcessor: "available" });
  mockRefresh.mockResolvedValue({});
  mockShouldUseMiyo.mockReturnValue(true);
});

describe("miyoDocParsers", () => {
  describe("pdfErrorText()", () => {
    it("names the PDF and appends the reason", () => {
      expect(pdfErrorText(pdf("Report"), "It is encrypted.")).toBe(
        "[Error: Could not extract content from PDF Report. It is encrypted.]"
      );
    });
  });

  describe("MiyoEpubParser", () => {
    describe("parseFile()", () => {
      it("parses an EPUB through Miyo with the vault name and vault-relative path when Miyo document processing is on and Miyo is available", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockResolvedValue({ text: "epub text" });

        const result = await new MiyoEpubParser().parseFile(epub("book"), asVault);

        expect(result).toBe("epub text");
        expect(mockParseDoc).toHaveBeenCalledWith(
          "http://localhost:8742",
          "MyVault",
          "books/book.epub"
        );
      });

      it("throws that Miyo failed to parse the book when Miyo returns an error", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockAvailable.mockReturnValue(true);
        mockParseDoc.mockRejectedValue(new Error("connection reset"));

        await expect(new MiyoEpubParser().parseFile(epub("book"), asVault)).rejects.toThrow(
          /Miyo failed to parse book: connection reset/
        );
      });

      it("throws that no processor is available when Miyo document processing is on but Miyo is unavailable", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: true }));
        mockAvailable.mockReturnValue(false);

        await expect(new MiyoEpubParser().parseFile(epub("book"), asVault)).rejects.toThrow(
          /No document processor available/
        );
        expect(mockParseDoc).not.toHaveBeenCalled();
      });

      it("throws without probing Miyo when Miyo document processing is off", async () => {
        mockGetSettings.mockReturnValue(settings({ enableMiyoDocumentProcessing: false }));
        mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });

        await expect(new MiyoEpubParser().parseFile(epub("book"), asVault)).rejects.toThrow(
          /No document processor available/
        );
        expect(mockRefresh).not.toHaveBeenCalled();
        expect(mockParseDoc).not.toHaveBeenCalled();
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
        expect(mockRequestUrl).not.toHaveBeenCalled();
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
});
