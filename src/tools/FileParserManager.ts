import { ProjectConfig } from "@/aiParams";
import { PDFCache } from "@/cache/pdfCache";
// BrevilabsClient import fully removed as it's no longer needed by any parser in this file after stubbing Docs4LLMParser
import { ProjectContextCache } from "@/cache/projectContextCache";
import { logError, logInfo } from "@/logger";
import { TFile, Vault, App } from "obsidian"; // Added App for vault.adapter.getBasePath()
import { CanvasLoader } from "./CanvasLoader";
import * as pdfjsLib from 'pdfjs-dist';

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
  // private brevilabsClient: BrevilabsClient; // BrevilabsClient removed
  private pdfCache: PDFCache;
  private app: App; // Added App reference

  constructor(app: App /*brevilabsClient: BrevilabsClient*/) { // BrevilabsClient removed from constructor
    // this.brevilabsClient = brevilabsClient; // BrevilabsClient removed
    this.app = app; // Store app reference
    this.pdfCache = PDFCache.getInstance();
  }

  async parseFile(file: TFile): Promise<string> {
    console.log(`PDFParser: Attempting to parse file ${file.path} locally.`);
    try {
      const arrayBuffer = await this.app.vault.readBinary(file);

      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        // This path needs to be resolvable by the Obsidian plugin's environment.
        // It's often tricky. Using a CDN as a fallback for now.
        // A robust solution would involve copying the worker file during the build process
        // and constructing a path relative to the plugin's main.js or using a blob URL.
        try {
          // Attempt to construct a path relative to the plugin's base path
          // This assumes the worker file is copied to a 'workers' subfolder in the plugin directory
          const pluginId = this.app.manifest.id;
          const basePath = this.app.vault.adapter.getBasePath(); // This might not be reliable in all Obsidian versions or platforms for web workers
          // A more reliable way in newer Obsidian might be to use plugin.app.vault.adapter.getResourcePath('pdf.worker.mjs')
          // For now, let's try a common relative path structure if possible, or fallback.
          // THIS IS HIGHLY EXPERIMENTAL for Obsidian plugins:
          // const localWorkerPath = `${basePath}/${pluginId}/pdf.worker.mjs`;
          // pdfjsLib.GlobalWorkerOptions.workerSrc = localWorkerPath;
          // console.log(`PDFParser: Attempting to set local workerSrc: ${localWorkerPath}`);

          // Fallback to CDN if local setup is complex or fails
          pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;
          console.warn("PDFParser: pdfjs-dist workerSrc not explicitly set by plugin build process, falling back to CDN. For true local/offline processing, ensure 'pdf.worker.mjs' is correctly bundled and its path is configured.");

        } catch (e) {
          console.error("PDFParser: Error trying to set workerSrc, defaulting to CDN.", e);
          pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;
        }
      }

      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => (item as any).str).join(" "); // item as any to access str
        fullText += pageText + "\n\n"; // Add double newline between pages
      }

      if (fullText.trim().length === 0) {
        console.warn(`PDFParser: Extracted empty text from ${file.name}`);
        return `Content of ${file.name} (PDF) could not be extracted or is empty.`;
      }

      return `Extracted text from ${file.name} (PDF):\n${fullText.trim()}`;

    } catch (error) {
      console.error(`PDFParser: Error parsing PDF ${file.name}:`, error);
      return `Error processing PDF ${file.name} locally: ${error.message}`;
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
  // private brevilabsClient: any; // BrevilabsClient removed
  private projectContextCache: ProjectContextCache;
  private currentProject: ProjectConfig | null;

  constructor(project: ProjectConfig | null = null) { // BrevilabsClient parameter removed
    // this.brevilabsClient = brevilabsClient; // BrevilabsClient removed
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
        `[Docs4LLMParser] Project ${this.currentProject.name}: Attempting to parse ${file.extension} file: ${file.path}`
      );
      console.warn(`Docs4LLMParser.parseFile: Processing for .doc/.docx and other non-PDF/text document types (${file.extension}) is disabled due to removal of intermediary services.`);
      // const docs4llmResponse = await this.brevilabsClient.docs4llm(binaryContent, file.extension); // BrevilabsClient call removed

      // if (!docs4llmResponse || !docs4llmResponse.response) {
      //   throw new Error("Empty response from docs4llm API");
      // }

      // // Ensure response is a string
      // let content = "";
      // if (typeof docs4llmResponse.response === "string") {
      //   content = docs4llmResponse.response;
      // } else if (typeof docs4llmResponse.response === "object") {
      //   // If response is an object, try to get the text content
      //   if (docs4llmResponse.response.text) {
      //     content = docs4llmResponse.response.text;
      //   } else if (docs4llmResponse.response.content) {
      //     content = docs4llmResponse.response.content;
      //   } else {
      //     // If no text/content field, stringify the entire response
      //     content = JSON.stringify(docs4llmResponse.response, null, 2);
      //   }
      // } else {
      //   content = String(docs4llmResponse.response);
      // }

      // // Cache the converted content
      // await this.projectContextCache.setFileContext(this.currentProject, file.path, content);

      // logInfo(
      //   `[Docs4LLMParser] Project ${this.currentProject.name}: Successfully processed and cached: ${file.path}`
      // );
      // return content;
      return Promise.resolve(`Processing for document type of '${file.name}' (${file.extension}) is currently not supported. Only PDF (local processing) and plain text files can be processed.`);
    } catch (error) {
      logError(
        `[Docs4LLMParser] Project ${this.currentProject?.name}: Error processing file ${file.path}:`,
        error
      );
      // throw error; // Propagate the error up - instead return a user-friendly message
      return `Error attempting to process document ${file.name}: ${error.message}`;
    }
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
    // brevilabsClient: BrevilabsClient, // BrevilabsClient parameter removed
    vault: Vault,
    isProjectMode: boolean = false,
    project: ProjectConfig | null = null
  ) {
    this.isProjectMode = isProjectMode;
    this.currentProject = project;

    // Register parsers
    this.registerParser(new MarkdownParser());

    // In project mode, use Docs4LLMParser for all supported files including PDFs
    this.registerParser(new Docs4LLMParser(project)); // BrevilabsClient argument removed

    // Only register PDFParser when not in project mode
    if (!isProjectMode) {
      // Pass app to PDFParser constructor
      this.registerParser(new PDFParser(vault.adapter.app as App));
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
