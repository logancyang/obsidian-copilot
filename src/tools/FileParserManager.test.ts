/**
 * Composition tests for the doc-processor backend flip in `FileParserManager`.
 *
 * The routing decision lives entirely in `getDocProcessorBackend`
 * (field === "miyo" AND Miyo available). These tests assert how the two PDF
 * parsers compose that decision with their (deliberately asymmetric) error
 * shapes:
 *   - Docs4LLMParser (project/batch mode) THROWS on a Miyo parse failure so the
 *     batch runner marks that file failed/retriable — and never falls back to
 *     cloud (privacy).
 *   - PDFParser (single-doc mode) RETURNS an error string on a Miyo parse
 *     failure — also never falling back to cloud.
 * The "field === miyo but Miyo unavailable" case is a connection-layer fallback
 * that resolves to cloud BEFORE any Miyo attempt (a stale field must not send a
 * PDF down a dead path).
 */

// getDocProcessorBackend hard-gates on isMiyoAvailableForCapability; the async
// parse-boundary resolver additionally reads the snapshot and, when it's
// unconclusive, triggers one refresh. All three are stubbed so tests drive the
// exact status the parser sees.
const mockSnapshot = jest.fn(() => ({ documentProcessor: "available" }));
const mockRefresh = jest.fn(async () => ({}));
// resolveDocProcessorBackend also gates on shouldUseMiyo (is Miyo actually in
// use, not just the persisted field). Default true so tests exercise the
// doc-processor routing; a dedicated test flips it to assert the stale-preference
// path returns plus.
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

const mockGetOrReuseFileContext = jest.fn();
const mockSetFileContext = jest.fn();
jest.mock("@/cache/projectContextCache", () => ({
  ProjectContextCache: {
    getInstance: () => ({
      getOrReuseFileContext: mockGetOrReuseFileContext,
      setFileContext: mockSetFileContext,
    }),
  },
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

import type { ProjectConfig } from "@/aiParams";
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

const vault = { getName: () => "MyVault", readBinary: jest.fn(async () => new ArrayBuffer(8)) };
const asVault = vault as unknown as Vault;

const project = { id: "p1", name: "Proj" } as ProjectConfig;

/** docs4llm cloud client stub; returns a plain markdown string. */
const cloudClient = (docs4llm: jest.Mock): BrevilabsClient =>
  ({ docs4llm }) as unknown as BrevilabsClient;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOrReuseFileContext.mockResolvedValue(null); // cache miss by default
  mockPdfCacheGet.mockResolvedValue(null);
  mockResolveBaseUrl.mockResolvedValue("http://localhost:8742");
  mockSnapshot.mockReturnValue({ documentProcessor: "available" }); // conclusive by default
  mockRefresh.mockResolvedValue({});
  mockShouldUseMiyo.mockReturnValue(true); // Miyo in use by default
});

describe("Docs4LLMParser — batch × partial failure (Miyo available)", () => {
  it("returns content for parsable PDFs and throws for the failing one, never touching cloud", async () => {
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    mockAvailable.mockReturnValue(true);
    // First file parses; second file fails at the Miyo endpoint.
    mockParseDoc
      .mockResolvedValueOnce({ text: "extracted one" })
      .mockRejectedValueOnce(new Error("connection reset"));

    const docs4llm = jest.fn();
    const parser = new Docs4LLMParser(cloudClient(docs4llm), project);

    await expect(parser.parseFile(pdf("a"), asVault)).resolves.toBe("extracted one");
    // Privacy: the failing file throws instead of falling back to cloud.
    await expect(parser.parseFile(pdf("b"), asVault)).rejects.toThrow(/Miyo failed to parse b/);

    expect(docs4llm).not.toHaveBeenCalled();
    expect(mockSetFileContext).toHaveBeenCalledWith(project, "docs/a.pdf", "extracted one");
  });
});

describe("Docs4LLMParser — fail closed (field miyo in use, Miyo unavailable)", () => {
  it("throws and never uploads to cloud when explicitly-chosen Miyo is unreachable", async () => {
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    mockAvailable.mockReturnValue(false); // Miyo not reachable
    const docs4llm = jest.fn().mockResolvedValue({ response: "cloud markdown" });

    const parser = new Docs4LLMParser(cloudClient(docs4llm), project);

    await expect(parser.parseFile(pdf("a"), asVault)).rejects.toThrow(/Miyo.*is unavailable/);
    expect(mockParseDoc).not.toHaveBeenCalled();
    expect(docs4llm).not.toHaveBeenCalled(); // privacy: no cloud fallback
  });
});

describe("PDFParser — error shape preserved (Miyo available, parse fails)", () => {
  it("returns an error string rather than throwing or falling back to cloud", async () => {
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    mockAvailable.mockReturnValue(true);
    mockParseDoc.mockRejectedValue(new Error("endpoint down"));
    const pdf4llm = jest.fn();

    const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
    const result = await parser.parseFile(pdf("solo"), asVault);

    expect(result).toContain("[Error: Could not extract content from PDF solo");
    expect(pdf4llm).not.toHaveBeenCalled();
  });
});

describe("PDFParser — fail closed (field miyo in use, Miyo unavailable)", () => {
  it("returns an error and never uploads to cloud when explicitly-chosen Miyo is unreachable", async () => {
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    mockAvailable.mockReturnValue(false);
    const pdf4llm = jest.fn().mockResolvedValue({ response: "cloud pdf" });

    const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
    const result = await parser.parseFile(pdf("solo"), asVault);

    expect(result).toContain("Miyo (local document processor) is unavailable");
    expect(mockParseDoc).not.toHaveBeenCalled();
    expect(pdf4llm).not.toHaveBeenCalled(); // privacy: no cloud fallback
  });
});

describe("parse-boundary status refresh (field miyo, status unconclusive)", () => {
  it("refreshes once when status is 'unknown', then routes to Miyo if it became available", async () => {
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    // Status starts unconclusive (never probed). The refresh confirms available,
    // so the subsequent sync read routes to Miyo instead of silently going cloud.
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

  it("FAILS CLOSED (no cloud) when 'stale' probe confirms Miyo still unavailable", async () => {
    // Privacy: an EXPLICIT docProcessorBackend="miyo" that can't be confirmed must
    // NOT silently upload to the cloud. The user chose local — surface an error.
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    mockSnapshot.mockReturnValue({ documentProcessor: "stale" });
    mockAvailable.mockReturnValue(false); // refresh didn't bring Miyo back
    const pdf4llm = jest.fn().mockResolvedValue({ response: "cloud pdf" });

    const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
    const result = await parser.parseFile(pdf("solo"), asVault);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(result).toContain("Miyo (local document processor) is unavailable");
    expect(pdf4llm).not.toHaveBeenCalled(); // never reached the cloud
    expect(mockParseDoc).not.toHaveBeenCalled();
  });

  it("Docs4LLMParser THROWS (no cloud) when Miyo is explicitly chosen but unavailable", async () => {
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });
    mockAvailable.mockReturnValue(false);
    const docs4llm = jest.fn();

    const parser = new Docs4LLMParser(cloudClient(docs4llm), project);

    await expect(parser.parseFile(pdf("solo"), asVault)).rejects.toThrow(/Miyo.*is unavailable/);
    expect(docs4llm).not.toHaveBeenCalled(); // never uploaded to cloud
  });

  it("routes to cloud (not fail-closed) when the field is 'miyo' but Miyo is no longer in use", async () => {
    // A stale preference left after Disconnect: docProcessorBackend still "miyo"
    // but shouldUseMiyo is false. The user isn't on Miyo, so cloud is correct —
    // no probe, no fail-closed.
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    mockShouldUseMiyo.mockReturnValue(false);
    mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });
    const pdf4llm = jest.fn().mockResolvedValue({ response: "cloud pdf" });

    const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
    const result = await parser.parseFile(pdf("solo"), asVault);

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(result).toBe("cloud pdf");
  });

  it("does NOT re-read health after resolving to Miyo, so a stale-horizon flip can't leak to cloud", async () => {
    // Regression: parsePdf used to re-check getDocProcessorBackend synchronously.
    // Because status degrades by wall-clock, the resolver could return "miyo" and
    // an immediately-following sync check return "plus" → parsePdf null → cloud.
    // Simulate that flip with a sequential availability mock; the parser must
    // commit to Miyo (call parseDoc) and NEVER touch the cloud API.
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    mockSnapshot.mockReturnValue({ documentProcessor: "available" });
    mockAvailable
      .mockReturnValueOnce(true) // resolver's check: route to Miyo
      .mockReturnValue(false); // any later check would say unavailable
    mockParseDoc.mockResolvedValue({ text: "extracted via miyo" });
    const pdf4llm = jest.fn();

    const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
    const result = await parser.parseFile(pdf("solo"), asVault);

    expect(mockParseDoc).toHaveBeenCalledTimes(1);
    expect(result).toBe("extracted via miyo");
    expect(pdf4llm).not.toHaveBeenCalled(); // no cloud fallback on the flip
  });

  it("does NOT refresh when status is already conclusive (no hot-path probe)", async () => {
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "miyo" }));
    mockSnapshot.mockReturnValue({ documentProcessor: "available" });
    mockAvailable.mockReturnValue(true);
    mockParseDoc.mockResolvedValue({ text: "extracted" });

    const parser = new PDFParser({ pdf4llm: jest.fn() } as unknown as BrevilabsClient);
    await parser.parseFile(pdf("solo"), asVault);

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("does NOT refresh when the field is 'plus' (never probes on the cloud path)", async () => {
    mockGetSettings.mockReturnValue(settings({ docProcessorBackend: "plus" }));
    mockSnapshot.mockReturnValue({ documentProcessor: "unknown" });
    const pdf4llm = jest.fn().mockResolvedValue({ response: "cloud pdf" });

    const parser = new PDFParser({ pdf4llm } as unknown as BrevilabsClient);
    await parser.parseFile(pdf("solo"), asVault);

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(pdf4llm).toHaveBeenCalledTimes(1);
  });
});
