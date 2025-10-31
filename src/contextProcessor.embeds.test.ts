jest.mock("@/chainFactory", () => ({
  ChainType: {
    LLM_CHAIN: "llm_chain",
    COPILOT_PLUS_CHAIN: "copilot_plus",
    PROJECT_CHAIN: "project_chain",
  },
}));

import { ContextProcessor } from "@/contextProcessor";
import { EMBEDDED_NOTE_TAG } from "@/constants";
import { ChainType } from "@/chainFactory";
import { TFile, Vault } from "obsidian";

type FileCacheMap = Record<string, any>;
type FileContentMap = Record<string, string>;

const createMockFile = (path: string): TFile => new (TFile as any)(path);

describe("ContextProcessor - Embedded Notes", () => {
  let contextProcessor: ContextProcessor;
  let vault: Vault;
  let fileParserManager: any;
  let fileCaches: FileCacheMap;
  let fileContents: FileContentMap;
  let fileIndex: Map<string, TFile>;

  beforeEach(() => {
    contextProcessor = ContextProcessor.getInstance();

    fileCaches = {};
    fileContents = {};
    fileIndex = new Map<string, TFile>();

    const metadataCacheMock = {
      getFirstLinkpathDest: jest.fn((link: string, _sourcePath: string) => {
        const normalized = link.endsWith(".md") ? link : `${link}.md`;
        return fileIndex.get(normalized) ?? null;
      }),
      getFileCache: jest.fn((file: TFile) => fileCaches[file.path] ?? {}),
    };

    (global as any).app = {
      metadataCache: metadataCacheMock,
    };

    vault = {
      adapter: {
        stat: jest.fn().mockResolvedValue({ ctime: 0, mtime: 0 }),
      },
    } as unknown as Vault;

    (vault as any).getAbstractFileByPath = jest.fn();

    fileParserManager = {
      supportsExtension: jest.fn(
        (extension: string) => extension === "md" || extension === "canvas"
      ),
      parseFile: jest.fn(async (file: TFile) => {
        const content = fileContents[file.path];
        if (content === undefined) {
          throw new Error(`Missing mock content for ${file.path}`);
        }
        return content;
      }),
    };
  });

  const registerFile = (file: TFile, content: string, cache: any = {}): void => {
    fileIndex.set(file.path, file);
    fileContents[file.path] = content;
    fileCaches[file.path] = cache;
  };

  it("should include embedded note content in the context payload", async () => {
    const source = createMockFile("Source.md");
    const embedded = createMockFile("Embedded.md");

    registerFile(source, "Introduction\n![[Embedded]]\nConclusion");
    registerFile(embedded, "Embedded note body");

    const result = await contextProcessor.processContextNotes(
      new Set(),
      fileParserManager,
      vault,
      [source],
      false,
      null,
      ChainType.LLM_CHAIN
    );

    expect(result).toContain(`<${EMBEDDED_NOTE_TAG}>`);
    expect(result).toContain("Embedded note body");
  });

  it("should extract a heading section when the embedded note targets a heading", async () => {
    const source = createMockFile("Source.md");
    const embedded = createMockFile("Embedded.md");
    const embeddedContent = "## Section\nImportant details\n\n## Other\nOther details";

    registerFile(source, "Root\n![[Embedded#Section]]\nTail");
    registerFile(embedded, embeddedContent, {
      headings: [
        {
          heading: "Section",
          level: 2,
          position: { start: { offset: 0 } },
        },
        {
          heading: "Other",
          level: 2,
          position: { start: { offset: embeddedContent.indexOf("## Other") } },
        },
      ],
    });

    const result = await contextProcessor.processContextNotes(
      new Set(),
      fileParserManager,
      vault,
      [source],
      false,
      null,
      ChainType.LLM_CHAIN
    );

    expect(result).toContain("<heading>Section</heading>");
    expect(result).toContain("Important details");
    expect(result).not.toContain("Other details");
  });

  it("should extract block reference content when embedding a block", async () => {
    const source = createMockFile("Source.md");
    const embedded = createMockFile("Embedded.md");
    const embeddedContent = "Paragraph 1\nParagraph 2 ^block-ref\nParagraph 3\n";
    const blockStart = embeddedContent.indexOf("Paragraph 2");
    const blockEnd = embeddedContent.indexOf("Paragraph 3");

    registerFile(source, "![[Embedded#^block-ref]]");
    registerFile(embedded, embeddedContent, {
      blocks: {
        "block-ref": {
          position: {
            start: { offset: blockStart },
            end: { offset: blockEnd },
          },
        },
      },
    });

    const result = await contextProcessor.processContextNotes(
      new Set(),
      fileParserManager,
      vault,
      [source],
      false,
      null,
      ChainType.LLM_CHAIN
    );

    expect(result).toContain("<block_id>block-ref</block_id>");
    expect(result).toContain("Paragraph 2 ^block-ref");
    expect(result).not.toContain("Paragraph 3");
  });

  it("should leave nested embeds untouched for recursive references", async () => {
    const source = createMockFile("Source.md");
    const embedded = createMockFile("Embedded.md");

    registerFile(source, "Parent\n![[Embedded]]", {});
    registerFile(embedded, "Child\n![[Source]]", {});

    const result = await contextProcessor.processContextNotes(
      new Set(),
      fileParserManager,
      vault,
      [source],
      false,
      null,
      ChainType.LLM_CHAIN
    );

    expect(result).toContain("<content>");
    expect(result).toContain("![[Source]]");
  });

  it("should surface an error when the embedded note cannot be resolved", async () => {
    const source = createMockFile("Source.md");

    registerFile(source, "Missing\n![[Absent]]", {});

    const result = await contextProcessor.processContextNotes(
      new Set(),
      fileParserManager,
      vault,
      [source],
      false,
      null,
      ChainType.LLM_CHAIN
    );

    expect(result).toContain("<error>Embedded note not found</error>");
  });
});
