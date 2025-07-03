import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { ProjectConfig } from "@/aiParams";
import { PDFCache } from "@/cache/pdfCache";
import { ProjectContextCache } from "@/cache/projectContextCache";
import { logError, logInfo } from "@/logger";
import { extractRetryTime, isRateLimitError } from "@/utils/rateLimitUtils";
import { Notice, TFile, Vault } from "obsidian";
import { CanvasLoader } from "./CanvasLoader";

interface FileParser {
  supportedExtensions: string[];
  parseFile: (file: TFile, vault: Vault) => Promise<string>;
}

export class MarkdownParser implements FileParser {
  supportedExtensions = ["md"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    return await vault.read(file);
  }
}

export class PDFParser implements FileParser {
  supportedExtensions = ["pdf"];
  private brevilabsClient: BrevilabsClient;
  private pdfCache: PDFCache;

  constructor(brevilabsClient: BrevilabsClient) {
    this.brevilabsClient = brevilabsClient;
    this.pdfCache = PDFCache.getInstance();
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo("Parsing PDF file:", file.path);

      // Try to get from cache first
      const cachedResponse = await this.pdfCache.get(file);
      if (cachedResponse) {
        logInfo("Using cached PDF content for:", file.path);
        return cachedResponse.response;
      }

      // If not in cache, read the file and call the API
      const binaryContent = await vault.readBinary(file);
      logInfo("Calling pdf4llm API for:", file.path);
      const pdf4llmResponse = await this.brevilabsClient.pdf4llm(binaryContent);
      await this.pdfCache.set(file, pdf4llmResponse);
      return pdf4llmResponse.response;
    } catch (error) {
      logError(`Error extracting content from PDF ${file.path}:`, error);
      return `[Error: Could not extract content from PDF ${file.basename}]`;
    }
  }

  async clearCache(): Promise<void> {
    logInfo("Clearing PDF cache");
    await this.pdfCache.clear();
  }
}

export class CanvasParser implements FileParser {
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

export class Docs4LLMParser implements FileParser {
  // Support various document and media file types
  supportedExtensions = [
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
  private brevilabsClient: BrevilabsClient;
  private projectContextCache: ProjectContextCache;
  private currentProject: ProjectConfig | null;
  private static lastRateLimitNoticeTime: number = 0;

  public static resetRateLimitNoticeTimer(): void {
    Docs4LLMParser.lastRateLimitNoticeTime = 0;
  }

  constructor(brevilabsClient: BrevilabsClient, project: ProjectConfig | null = null) {
    this.brevilabsClient = brevilabsClient;
    this.projectContextCache = ProjectContextCache.getInstance();
    this.currentProject = project;
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo(
        `[Docs4LLMParser] Project ${this.currentProject?.name}: Parsing ${file.extension} file: ${file.path}`
      );

      if (!this.currentProject) {
        logError("[Docs4LLMParser] No project context for parsing file: ", file.path);
        throw new Error("No project context provided for file parsing");
      }

      const cachedContent = await this.projectContextCache.getFileContext(
        this.currentProject,
        file.path
      );
      if (cachedContent) {
        logInfo(
          `[Docs4LLMParser] Project ${this.currentProject.name}: Using cached content for: ${file.path}`
        );
        return cachedContent;
      }
      logInfo(
        `[Docs4LLMParser] Project ${this.currentProject.name}: Cache miss for: ${file.path}. Proceeding to API call.`
      );

      const binaryContent = await vault.readBinary(file);

      logInfo(
        `[Docs4LLMParser] Project ${this.currentProject.name}: Calling docs4llm API for: ${file.path}`
      );
      const docs4llmResponse = await this.brevilabsClient.docs4llm(binaryContent, file.extension);

      if (!docs4llmResponse || !docs4llmResponse.response) {
        throw new Error("Empty response from docs4llm API");
      }

      // Extract markdown content from response
      let content = "";
      if (typeof docs4llmResponse.response === "string") {
        content = docs4llmResponse.response;
      } else if (Array.isArray(docs4llmResponse.response)) {
        // Handle array of documents from docs4llm
        const markdownParts: string[] = [];
        for (const doc of docs4llmResponse.response) {
          if (doc.content) {
            // Prioritize markdown content, then fallback to text content
            if (doc.content.md) {
              markdownParts.push(doc.content.md);
            } else if (doc.content.text) {
              markdownParts.push(doc.content.text);
            }
          }
        }
        content = markdownParts.join("\n\n");
      } else if (typeof docs4llmResponse.response === "object") {
        // Handle single object response (backward compatibility)
        if (docs4llmResponse.response.md) {
          content = docs4llmResponse.response.md;
        } else if (docs4llmResponse.response.text) {
          content = docs4llmResponse.response.text;
        } else if (docs4llmResponse.response.content) {
          content = docs4llmResponse.response.content;
        } else {
          // If no markdown/text/content field, stringify the entire response
          content = JSON.stringify(docs4llmResponse.response, null, 2);
        }
      } else {
        content = String(docs4llmResponse.response);
      }

      // Cache the converted content
      await this.projectContextCache.setFileContext(this.currentProject, file.path, content);

      logInfo(
        `[Docs4LLMParser] Project ${this.currentProject.name}: Successfully processed and cached: ${file.path}`
      );
      return content;
    } catch (error) {
      logError(
        `[Docs4LLMParser] Project ${this.currentProject?.name}: Error processing file ${file.path}:`,
        error
      );

      // Check if this is a rate limit error and show user-friendly notice
      if (isRateLimitError(error)) {
        this.showRateLimitNotice(error);
      }

      throw error; // Propagate the error up
    }
  }

  private showRateLimitNotice(error: any): void {
    const now = Date.now();

    // Only show one rate limit notice per minute to avoid spam
    if (now - Docs4LLMParser.lastRateLimitNoticeTime < 60000) {
      return;
    }

    Docs4LLMParser.lastRateLimitNoticeTime = now;

    const retryTime = extractRetryTime(error);

    new Notice(
      `⚠️ Rate limit exceeded for document processing. Please try again in ${retryTime}. Having fewer non-markdown files in the project will help.`,
      10000 // Show notice for 10 seconds
    );
  }

  async clearCache(): Promise<void> {
    // This method is no longer needed as cache clearing is handled at the project level
    logInfo("Cache clearing is now handled at the project level");
  }
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
  private isProjectMode: boolean;
  private currentProject: ProjectConfig | null;

  constructor(
    brevilabsClient: BrevilabsClient,
    vault: Vault,
    isProjectMode: boolean = false,
    project: ProjectConfig | null = null
  ) {
    this.isProjectMode = isProjectMode;
    this.currentProject = project;

    // Register parsers
    this.registerParser(new MarkdownParser());

    // In project mode, use Docs4LLMParser for all supported files including PDFs
    this.registerParser(new Docs4LLMParser(brevilabsClient, project));

    // Only register PDFParser when not in project mode
    if (!isProjectMode) {
      this.registerParser(new PDFParser(brevilabsClient));
    }

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

  async clearPDFCache(): Promise<void> {
    const pdfParser = this.parsers.get("pdf");
    if (pdfParser instanceof PDFParser) {
      await pdfParser.clearCache();
    }
  }
}
