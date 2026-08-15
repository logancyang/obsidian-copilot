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

/**
 * Document formats Miyo processes locally via its parse-doc endpoint. Every
 * doc-processor backend gate reads from this one set, so PDF and EPUB stay in
 * sync and other formats fall through to Plus.
 */
const MIYO_LOCAL_EXTENSIONS = new Set(["pdf", "epub"]);

/** Whether Miyo can process this file locally (drives the fail-closed routing). */
function isMiyoLocalExtension(file: TFile): boolean {
  return MIYO_LOCAL_EXTENSIONS.has(file.extension.toLowerCase());
}

interface FileParser {
  supportedExtensions: string[];
  parseFile: (file: TFile, vault: Vault) => Promise<string>;
}

/**
 * Thin wrapper that reads the output folder from settings and delegates to the pure function.
 */
export async function saveConvertedDocOutput(
  file: TFile,
  content: string,
  vault: Vault
): Promise<void> {
  const outputFolder = getSettings().convertedDocOutputFolder ?? "";
  await saveConvertedDocOutputCore(file, content, vault, outputFolder);
}

/** Result from SelfHostDocParser: null = not applicable, { content } = success, { error } = tried and failed. */
type MiyoParseResult = { content: string } | { error: string } | null;

/**
 * Self-host document parser bridge using Miyo's parse-doc endpoint. Handles the
 * formats Miyo processes locally (see {@link MIYO_LOCAL_EXTENSIONS}).
 */
class SelfHostDocParser {
  private miyoClient: MiyoClient;

  /**
   * Create a new self-host document parser.
   */
  constructor() {
    this.miyoClient = new MiyoClient();
  }

  /**
   * Parse a document via Miyo when self-host mode is active.
   *
   * @param file - Document file to parse (PDF or EPUB).
   * @param vault - Obsidian vault instance.
   * @returns Content on success, error reason on failure, or null when not applicable.
   */
  public async parseDoc(file: TFile, vault: Vault): Promise<MiyoParseResult> {
    const settings = getSettings();
    // Callers own the backend decision: they resolve it once at the parse boundary
    // (resolveDocProcessorBackend, which probes) and only reach here when it's
    // "miyo". We must NOT re-read the backend with the synchronous accessor — the
    // status can cross the stale horizon between the two reads (it degrades by
    // wall-clock), so a second check could return "plus", hand back null, and let
    // the caller silently fall through to the cloud — the exact privacy leak the
    // fail-closed resolver exists to prevent. So parseDoc only guards the file type
    // and otherwise commits to Miyo, returning `{ error }` on any Miyo failure.
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

      // Try to get from cache first
      const cachedResponse = await this.pdfCache.get(vault, file);
      if (cachedResponse) {
        logInfo("Using cached PDF content for:", file.path);
        // Ensure output file exists even on cache hit (user may have just enabled the setting)
        await saveConvertedDocOutput(file, cachedResponse.response, vault);
        return cachedResponse.response;
      }

      const settings = getSettings();
      // Refresh Miyo status at the parse boundary (only when it's unconclusive)
      // so a persisted "miyo" preference isn't silently downgraded to Plus just
      // because the settings page was never opened to trigger a health check.
      const backend = isMiyoLocalExtension(file)
        ? await resolveDocProcessorBackend(settings)
        : "plus";

      // The user explicitly chose local Miyo processing but Miyo can't be
      // confirmed reachable: fail closed. Uploading to the cloud here would leak a
      // document the user asked to keep local — the same privacy guarantee applied
      // to a Miyo parse failure below.
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
          // Self-host mode: do NOT fall back to cloud API to preserve privacy.
          logWarn(`[PDFParser] Miyo parse failed for ${file.path}: ${miyoResult.error}`);
          return `[Error: Could not extract content from PDF ${file.basename}. ${miyoResult.error}]`;
        }
      }

      // If not in cache, read the file and call the API
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

      // Use the specialized buildPrompt method to create LLM-friendly format
      return canvasLoader.buildPrompt(canvasData);
    } catch (error) {
      logError(`Error parsing Canvas file ${file.path}:`, error);
      return `[Error: Could not parse Canvas file ${file.basename}]`;
    }
  }
}

/** All file extensions registered by Docs4LLMParser. */
const DOCS4LLM_SUPPORTED_EXTENSIONS: readonly string[] = [
  // Base types
  "pdf",

  // Documents and presentations
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

  // Images
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

  // Spreadsheets
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

  // Audio (limited to 20MB)
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "wav",
  "webm",
];

/**
 * Converts non-markdown documents to text for chat context. Only formats Miyo
 * handles locally ({@link MIYO_LOCAL_EXTENSIONS}) can be converted here; every
 * other registered extension reports that no document processor is available,
 * so the caller surfaces a real failure instead of silently attaching nothing.
 */
export class Docs4LLMParser implements FileParser {
  // Reason: keep the registration list on the shared constant so the extensions
  // this parser claims stay in one place.
  supportedExtensions = [...DOCS4LLM_SUPPORTED_EXTENSIONS];
  private selfHostDocParser: SelfHostDocParser;

  constructor() {
    this.selfHostDocParser = new SelfHostDocParser();
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo(`[Docs4LLMParser] Parsing ${file.extension} file: ${file.path}`);

      // For local formats (PDF/EPUB), resolve at the parse boundary so an
      // inconclusive (unknown/stale) status gets one health check before routing.
      const backend = isMiyoLocalExtension(file) ? await resolveDocProcessorBackend() : "plus";

      // Explicit local Miyo choice, but Miyo can't be confirmed: fail closed.
      // Throw so the batch runner marks this file failed/retriable — never upload
      // a document the user asked to keep local to the cloud.
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
          // Self-host mode: do NOT fall back to cloud API to preserve privacy.
          // Throw so executeWithProcessTracking marks this file as failed/retriable.
          throw new Error(`Miyo failed to parse ${file.basename}: ${miyoResult.error}`);
        }
      }

      throw new Error(
        `No document processor available for ${file.basename}. Enable Miyo to convert this file type locally.`
      );
    } catch (error) {
      logError(`[Docs4LLMParser] Error processing file ${file.path}:`, error);

      // Check if this is a rate limit error and show user-friendly notice
      if (isRateLimitError(error)) {
        this.showRateLimitNotice(error);
      }

      throw error; // Propagate the error up
    }
  }

  private showRateLimitNotice(error: unknown): void {
    const now = Date.now();

    // Only show one rate limit notice per minute to avoid spam
    if (now - Docs4LLMParser.lastRateLimitNoticeTime < 60000) {
      return;
    }

    Docs4LLMParser.lastRateLimitNoticeTime = now;

    const retryTime = extractRetryTime(error);

    new Notice(
      `⚠️ Rate limit exceeded for document processing. Please try again in ${retryTime}.`,
      10000 // Show notice for 10 seconds
    );
  }

  private static lastRateLimitNoticeTime: number = 0;
}

// Future parsers can be added like this:
/*
class DocxParser implements FileParser {
  supportedExtensions = ["docx", "doc"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    // Implementation for Word documents
  }
}
*/

export class FileParserManager {
  private parsers: Map<string, FileParser> = new Map();

  constructor(brevilabsClient: BrevilabsClient, _vault: Vault) {
    this.registerParser(new MarkdownParser());
    this.registerParser(new Docs4LLMParser());
    // Registered after Docs4LLMParser so PDFs route to the dedicated PDF parser,
    // which claims the same extension.
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
