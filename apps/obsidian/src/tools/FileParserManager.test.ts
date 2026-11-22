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

import type { CopilotSettings } from "@/settings/model";
import * as obsidianModule from "obsidian";
import type { TFile, Vault } from "obsidian";
import { PDF_NEEDS_MIYO_MESSAGE } from "@/miyo/miyoDocParsers";
import { FileParserManager } from "./FileParserManager";

const settings = (over: Partial<CopilotSettings>): CopilotSettings =>
  ({ miyoServerUrl: "", convertedDocOutputFolder: "", ...over }) as CopilotSettings;

const pdf = (name: string): TFile =>
  // eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test fixture; not a real TFile
  ({ extension: "pdf", path: `docs/${name}.pdf`, basename: name }) as unknown as TFile;

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

describe("FileParserManager", () => {
  describe("FileParserManager", () => {
    describe("supportsExtension()", () => {
      it.each(["md", "base", "canvas", "pdf", "epub"])("accepts .%s", (extension) => {
        expect(new FileParserManager().supportsExtension(extension)).toBe(true);
      });

      it.each(["docx", "xlsx", "png", "txt"])(
        "rejects .%s because no document processor reads it in Quick Chat",
        (extension) => {
          expect(new FileParserManager().supportsExtension(extension)).toBe(false);
        }
      );
    });

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
