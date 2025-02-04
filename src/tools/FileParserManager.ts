import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { PDFCache } from "@/cache/pdfCache";
import { logError, logInfo } from "@/logger";
import { TFile, Vault } from "obsidian";

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

  constructor(brevilabsClient: BrevilabsClient) {
    // Register more parsers here
    this.registerParser(new MarkdownParser());
    this.registerParser(new PDFParser(brevilabsClient));
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
}
