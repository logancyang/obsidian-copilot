import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { PDFCache } from "@/cache/pdfCache";
import { logError, logInfo, logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl, resolveDocProcessorBackend } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import { saveConvertedDocOutput as saveConvertedDocOutputCore } from "@/utils/convertedDocOutput";
import { extractRetryTime, isRateLimitError } from "@/utils/rateLimitUtils";
import { Notice, TFile, Vault } from "obsidian";
import { CanvasLoader } from "./CanvasLoader";

const MIYO_LOCAL_EXTENSIONS = new Set(["pdf", "epub"]);

function isMiyoLocalExtension(file: TFile): boolean {
  return MIYO_LOCAL_EXTENSIONS.has(file.extension.toLowerCase());
}

interface FileParser {
  supportedExtensions: string[];
  parseFile: (file: TFile, vault: Vault) => Promise<string>;
}

export async function saveConvertedDocOutput(
  file: TFile,
  content: string,
  vault: Vault
): Promise<void> {
  const outputFolder = getSettings().convertedDocOutputFolder ?? "";
  await saveConvertedDocOutputCore(file, content, vault, outputFolder);
}

type MiyoParseResult = { content: string } | { error: string } | null;

class SelfHostDocParser {
  private miyoClient: MiyoClient;

  constructor() {
    this.miyoClient = new MiyoClient();
  }

  public async parseDoc(file: TFile, vault: Vault): Promise<MiyoParseResult> {
    const settings = getSettings();
    if (!isMiyoLocalExtension(file)) {
      return null;
    }

    try {
      const baseUrl = await this.miyoClient.resolveBaseUrl(getMiyoCustomUrl(settings));
      const folderName = vault.getName();
      const response = await this.miyoClient.parseDoc(baseUrl, folderName, file.path);
      if (typeof response.text !== "string" || response.text.trim().length === 0) {
        return { error: "Miyo parse-doc returned empty text" };
      }

      logInfo(`[SelfHostDocParser] Parsed document via Miyo: ${file.path}`);
      return { content: response.text };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logWarn(`[SelfHostDocParser] Failed to parse ${file.path} via Miyo parse-doc: ${reason}`);
      return { error: reason };
    }
  }
}

class MarkdownParser implements FileParser {
  supportedExtensions = ["md", "base"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    return await vault.read(file);
  }
}

export class PDFParser implements FileParser {
  supportedExtensions = ["pdf"];
  private brevilabsClient: BrevilabsClient;
  private pdfCache: PDFCache;
  private selfHostDocParser: SelfHostDocParser;

  constructor(brevilabsClient: BrevilabsClient) {
    this.brevilabsClient = brevilabsClient;
    this.pdfCache = PDFCache.getInstance();
    this.selfHostDocParser = new SelfHostDocParser();
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo("Parsing PDF file:", file.path);

      const cachedResponse = await this.pdfCache.get(vault, file);
      if (cachedResponse) {
        logInfo("Using cached PDF content for:", file.path);
        await saveConvertedDocOutput(file, cachedResponse.response, vault);
        return cachedResponse.response;
      }

      const settings = getSettings();
      const backend = isMiyoLocalExtension(file)
        ? await resolveDocProcessorBackend(settings)
        : "plus";

      if (backend === "miyo-unavailable") {
        logWarn(`[PDFParser] Miyo unavailable for ${file.path}; not falling back to cloud`);
        return `[Error: Could not extract content from PDF ${file.basename}. Miyo (local document processor) is unavailable — reconnect it or switch the Document Processor to Plus in settings.]`;
      }

      if (backend === "miyo") {
        const miyoResult = await this.selfHostDocParser.parseDoc(file, vault);
        if (miyoResult && "content" in miyoResult) {
          await this.pdfCache.set(vault, file, {
            response: miyoResult.content,
            elapsed_time_ms: 0,
          });
          await saveConvertedDocOutput(file, miyoResult.content, vault);
          return miyoResult.content;
        }

        if (miyoResult && "error" in miyoResult) {
          logWarn(`[PDFParser] Miyo parse failed for ${file.path}: ${miyoResult.error}`);
          return `[Error: Could not extract content from PDF ${file.basename}. ${miyoResult.error}]`;
        }
      }

      const binaryContent = await vault.readBinary(file);
      logInfo("Calling pdf4llm API for:", file.path);
      const pdf4llmResponse = await this.brevilabsClient.pdf4llm(binaryContent);
      await this.pdfCache.set(vault, file, pdf4llmResponse);
      await saveConvertedDocOutput(file, pdf4llmResponse.response, vault);
      return pdf4llmResponse.response;
    } catch (error) {
      logError(`Error extracting content from PDF ${file.path}:`, error);
      return `[Error: Could not extract content from PDF ${file.basename}]`;
    }
  }

  async clearCache(vault: Vault): Promise<void> {
    logInfo("Clearing PDF cache");
    await this.pdfCache.clear(vault);
  }
}

class CanvasParser implements FileParser {
  supportedExtensions = ["canvas"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo("Parsing Canvas file:", file.path);
      const canvasLoader = new CanvasLoader(vault);
      const canvasData = await canvasLoader.load(file);

      return canvasLoader.buildPrompt(canvasData);
    } catch (error) {
      logError(`Error parsing Canvas file ${file.path}:`, error);
      return `[Error: Could not parse Canvas file ${file.basename}]`;
    }
  }
}

const DOCS4LLM_SUPPORTED_EXTENSIONS: readonly string[] = [
  "pdf",

  "602",
  "abw",
  "cgm",
  "cwk",
  "doc",
  "docx",
  "docm",
  "dot",
  "dotm",
  "hwp",
  "key",
  "lwp",
  "mw",
  "mcw",
  "pages",
  "pbd",
  "ppt",
  "pptm",
  "pptx",
  "pot",
  "potm",
  "potx",
  "rtf",
  "sda",
  "sdd",
  "sdp",
  "sdw",
  "sgl",
  "sti",
  "sxi",
  "sxw",
  "stw",
  "sxg",
  "txt",
  "uof",
  "uop",
  "uot",
  "vor",
  "wpd",
  "wps",
  "xml",
  "zabw",
  "epub",

  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "svg",
  "tiff",
  "webp",
  "web",
  "htm",
  "html",

  "xlsx",
  "xls",
  "xlsm",
  "xlsb",
  "xlw",
  "csv",
  "dif",
  "sylk",
  "slk",
  "prn",
  "numbers",
  "et",
  "ods",
  "fods",
  "uos1",
  "uos2",
  "dbf",
  "wk1",
  "wk2",
  "wk3",
  "wk4",
  "wks",
  "123",
  "wq1",
  "wq2",
  "wb1",
  "wb2",
  "wb3",
  "qpw",
  "xlr",
  "eth",
  "tsv",

  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "wav",
  "webm",
];

export class Docs4LLMParser implements FileParser {
  supportedExtensions = [...DOCS4LLM_SUPPORTED_EXTENSIONS];
  private selfHostDocParser: SelfHostDocParser;

  constructor() {
    this.selfHostDocParser = new SelfHostDocParser();
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo(`[Docs4LLMParser] Parsing ${file.extension} file: ${file.path}`);

      const backend = isMiyoLocalExtension(file) ? await resolveDocProcessorBackend() : "plus";

      if (backend === "miyo-unavailable") {
        throw new Error(
          `Miyo (local document processor) is unavailable for ${file.basename}; not falling back to cloud. Reconnect Miyo or switch the Document Processor to Plus.`
        );
      }

      if (backend === "miyo") {
        const miyoResult = await this.selfHostDocParser.parseDoc(file, vault);
        if (miyoResult && "content" in miyoResult) {
          await saveConvertedDocOutput(file, miyoResult.content, vault);
          logInfo(`[Docs4LLMParser] Parsed document via Miyo: ${file.path}`);
          return miyoResult.content;
        }
        if (miyoResult && "error" in miyoResult) {
          throw new Error(`Miyo failed to parse ${file.basename}: ${miyoResult.error}`);
        }
      }

      throw new Error(
        `No document processor available for ${file.basename}. Enable Miyo to convert this file type locally.`
      );
    } catch (error) {
      logError(`[Docs4LLMParser] Error processing file ${file.path}:`, error);

      if (isRateLimitError(error)) {
        this.showRateLimitNotice(error);
      }

      throw error;
    }
  }

  private showRateLimitNotice(error: unknown): void {
    const now = Date.now();

    if (now - Docs4LLMParser.lastRateLimitNoticeTime < 60000) {
      return;
    }

    Docs4LLMParser.lastRateLimitNoticeTime = now;

    const retryTime = extractRetryTime(error);

    new Notice(
      `⚠️ Rate limit exceeded for document processing. Please try again in ${retryTime}.`,
      10000
    );
  }

  private static lastRateLimitNoticeTime: number = 0;
}

export class FileParserManager {
  private parsers: Map<string, FileParser> = new Map();

  constructor(brevilabsClient: BrevilabsClient, _vault: Vault) {
    this.registerParser(new MarkdownParser());
    this.registerParser(new Docs4LLMParser());
    this.registerParser(new PDFParser(brevilabsClient));
    this.registerParser(new CanvasParser());
  }

  registerParser(parser: FileParser) {
    for (const ext of parser.supportedExtensions) {
      this.parsers.set(ext, parser);
    }
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    const parser = this.parsers.get(file.extension);
    if (!parser) {
      throw new Error(`No parser found for file type: ${file.extension}`);
    }
    return await parser.parseFile(file, vault);
  }

  supportsExtension(extension: string): boolean {
    return this.parsers.has(extension);
  }

  async clearPDFCache(vault: Vault): Promise<void> {
    const pdfParser = this.parsers.get("pdf");
    if (pdfParser instanceof PDFParser) {
      await pdfParser.clearCache(vault);
    }
  }
}
