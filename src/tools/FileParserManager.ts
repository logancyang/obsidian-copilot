import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { Vault } from "obsidian";

import { TFile } from "obsidian";

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

  constructor(brevilabsClient: BrevilabsClient) {
    this.brevilabsClient = brevilabsClient;
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      const binaryContent = await vault.readBinary(file);
      const pdf4llmResponse = await this.brevilabsClient.pdf4llm(binaryContent);
      return pdf4llmResponse.response;
    } catch (error) {
      console.error(`Error extracting content from PDF ${file.path}:`, error);
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
