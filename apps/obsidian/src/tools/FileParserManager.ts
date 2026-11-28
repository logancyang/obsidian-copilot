import { logError, logInfo } from "@/logger";
import {
  MiyoEpubParser,
  PDF_NEEDS_MIYO_MESSAGE,
  PDF_NEEDS_MIYO_REPEAT,
  PDFParser,
  pdfErrorText,
} from "@/miyo/miyoDocParsers";
import { TFile, Vault } from "obsidian";
import { CanvasLoader } from "./CanvasLoader";

export interface FileParser {
  supportedExtensions: string[];
  parseFile: (file: TFile, vault: Vault) => Promise<string>;
}

class MarkdownParser implements FileParser {
  supportedExtensions = ["md", "base"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    return await vault.read(file);
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

export class FileParserManager {
  private parsers: Map<string, FileParser> = new Map();

  constructor() {
    this.registerParser(new MarkdownParser());
    this.registerParser(new MiyoEpubParser());
    this.registerParser(new PDFParser());
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

  // One explanation per send keeps several unreadable PDFs from repeating it, and only parser output is shortened so quoted note text stays intact. https://github.com/Brevilabs/obsidian-copilot-private/issues/653
  forOneSend(): FileParserManager {
    const scoped = Object.create(this) as FileParserManager;
    let explained = false;
    scoped.parseFile = async (file, vault) => {
      const content = await this.parseFile(file, vault);
      if (content !== pdfErrorText(file, PDF_NEEDS_MIYO_MESSAGE)) return content;
      if (!explained) {
        explained = true;
        return content;
      }
      return pdfErrorText(file, PDF_NEEDS_MIYO_REPEAT);
    };
    return scoped;
  }
}
