import { logError, logInfo, logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { canProcessDocumentsWithMiyo, getMiyoCustomUrl } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import { saveConvertedDocOutput as saveConvertedDocOutputCore } from "@/utils/convertedDocOutput";
import { TFile, Vault } from "obsidian";
import { CanvasLoader } from "./CanvasLoader";

export const PDF_NEEDS_MIYO_MESSAGE =
  "Quick Chat reads PDFs through Miyo document processing, which is off or not connected. Turn it on and connect Miyo, or ask in Agent Chat, where your agent can read the PDF directly.";

const PDF_NEEDS_MIYO_REPEAT = "Same reason as the other unreadable PDF in this message.";

function pdfErrorText(file: TFile, reason: string): string {
  return `[Error: Could not extract content from PDF ${file.basename}. ${reason}]`;
}

interface FileParser {
  supportedExtensions: string[];
  parseFile: (file: TFile, vault: Vault) => Promise<string>;
}

async function saveConvertedDocOutput(file: TFile, content: string, vault: Vault): Promise<void> {
  const outputFolder = getSettings().convertedDocOutputFolder ?? "";
  await saveConvertedDocOutputCore(file, content, vault, outputFolder);
}

type MiyoParseResult = { content: string } | { error: string };

class SelfHostDocParser {
  private miyoClient: MiyoClient;

  constructor() {
    this.miyoClient = new MiyoClient();
  }

  public async parseDoc(file: TFile, vault: Vault): Promise<MiyoParseResult> {
    const settings = getSettings();

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
  private selfHostDocParser = new SelfHostDocParser();

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo("Parsing PDF file:", file.path);

      // Quick Chat no longer sends PDFs to a cloud parser. https://github.com/Brevilabs/obsidian-copilot-private/issues/653
      if (!(await canProcessDocumentsWithMiyo())) {
        logWarn(`[PDFParser] Miyo document processing unavailable for ${file.path}`);
        return pdfErrorText(file, PDF_NEEDS_MIYO_MESSAGE);
      }

      const miyoResult = await this.selfHostDocParser.parseDoc(file, vault);
      if ("content" in miyoResult) {
        await saveConvertedDocOutput(file, miyoResult.content, vault);
        return miyoResult.content;
      }

      logWarn(`[PDFParser] Miyo parse failed for ${file.path}: ${miyoResult.error}`);
      return `[Error: Could not extract content from PDF ${file.basename}. ${miyoResult.error}]`;
    } catch (error) {
      logError(`Error extracting content from PDF ${file.path}:`, error);
      return `[Error: Could not extract content from PDF ${file.basename}]`;
    }
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

export class MiyoEpubParser implements FileParser {
  supportedExtensions = ["epub"];
  private selfHostDocParser = new SelfHostDocParser();

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo(`[MiyoEpubParser] Parsing EPUB file: ${file.path}`);

      if (!(await canProcessDocumentsWithMiyo())) {
        throw new Error(
          `No document processor available for ${file.basename}. Enable Miyo to convert this file type locally.`
        );
      }

      const miyoResult = await this.selfHostDocParser.parseDoc(file, vault);
      if ("error" in miyoResult) {
        throw new Error(`Miyo failed to parse ${file.basename}: ${miyoResult.error}`);
      }
      await saveConvertedDocOutput(file, miyoResult.content, vault);
      return miyoResult.content;
    } catch (error) {
      logError(`[MiyoEpubParser] Error processing file ${file.path}:`, error);
      throw error;
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
