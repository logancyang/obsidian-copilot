import { FileSystemAdapter, TFolder, type App } from "obsidian";

jest.mock("@/projects/state", () => ({
  getCachedProjectRecordById: jest.fn(),
}));
jest.mock(
  "@/search/searchUtils",
  (): Record<string, unknown> => ({
    ...jest.requireActual("@/search/searchUtils"),
    shouldIndexFile: jest.fn(() => true),
  })
);

import { getCachedProjectRecordById } from "@/projects/state";
import { shouldIndexFile } from "@/search/searchUtils";
import {
  buildProjectContext,
  buildProjectContextBlock,
  MAX_MANIFEST_ENTRIES,
  type ManifestPathEntry,
  type ManifestSources,
} from "./manifestBuilder";

const getRecord = getCachedProjectRecordById as jest.Mock;
const indexFile = shouldIndexFile as jest.Mock;

const CWD = "/vault/Proj";

function abs(vaultPath: string, absPath?: string): ManifestPathEntry {
  return absPath ? { vaultPath, absPath } : { vaultPath };
}

function sources(over: Partial<ManifestSources> = {}): ManifestSources {
  return {
    folders: [],
    notes: [],
    extensions: [],
    tags: [],
    properties: [],
    propertyNotes: [],
    documents: [],
    webUrls: [],
    youtubeUrls: [],
    ...over,
  };
}

function record(contextSource: Record<string, string | undefined>, id = "p1") {
  return { project: { id, contextSource }, filePath: "Proj/AGENTS.md", folderName: "Proj" };
}

function fakeApp(files: Array<{ path: string; ext: string }> = [], folders: string[] = []): App {
  const tfiles = files.map((f) => ({
    path: f.path,
    extension: f.ext,
    basename: f.path
      .split("/")
      .pop()!
      .replace(/\.[^.]+$/, ""),
    stat: { mtime: 1000, size: 10 },
  }));
  const folderSet = new Set(folders);
  const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;
  const Folder = TFolder as unknown as new (path: string) => TFolder;
  return {
    vault: {
      adapter: new FsAdapter("/vault"),
      getFiles: () => tfiles,
      getMarkdownFiles: () => tfiles.filter((f) => f.extension === "md"),
      getAbstractFileByPath: (p: string) => (folderSet.has(p) ? new Folder(p) : null),
    },
  } as unknown as App;
}

beforeEach(() => {
  jest.clearAllMocks();
  indexFile.mockReturnValue(true);
});

describe("manifestBuilder", () => {
  describe("buildProjectContext()", () => {
    it("lists included notes by absolute path in the context block", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
      const app = fakeApp([{ path: "Notes/Spec.md", ext: "md" }]);

      const result = buildProjectContext(app, "p1", CWD);

      expect(result.projectContextBlock).toContain("## Included notes");
      expect(result.projectContextBlock).toContain("`/vault/Notes/Spec.md`");
    });

    it("reports only out-of-cwd folder inclusions as additional directories", () => {
      getRecord.mockReturnValue(record({ inclusions: "External,Proj/Sub" }));
      const app = fakeApp([], ["External", "Proj/Sub"]);

      const result = buildProjectContext(app, "p1", CWD);

      expect(result.additionalDirectories).toEqual(["/vault/External"]);
      expect(result.projectContextBlock).toContain("`/vault/External`");
      expect(result.projectContextBlock).toContain("`/vault/Proj/Sub`");
    });

    it("lists web and YouTube sources as links for the agent to fetch on demand", () => {
      getRecord.mockReturnValue(
        record({ webUrls: "https://example.com\n", youtubeUrls: "https://youtu.be/abc" })
      );

      const result = buildProjectContext(fakeApp(), "p1", CWD);

      expect(result.projectContextBlock).toContain("## Included URLs\n- https://example.com");
      expect(result.projectContextBlock).toContain("## Included YouTube\n- https://youtu.be/abc");
      expect(result.projectContextBlock).toContain("not fetched in advance");
    });

    it("returns the project's context signature with the block", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));

      const result = buildProjectContext(fakeApp(), "p1", CWD);

      expect(result.contextSignature).toEqual(expect.any(String));
    });

    it("lists every note that shares an inclusion title (basename collision)", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
      const app = fakeApp([
        { path: "A/Spec.md", ext: "md" },
        { path: "B/Spec.md", ext: "md" },
      ]);

      const result = buildProjectContext(app, "p1", CWD);

      expect(result.projectContextBlock).toContain("`/vault/A/Spec.md`");
      expect(result.projectContextBlock).toContain("`/vault/B/Spec.md`");
    });

    it("counts a property-only inclusion as a source and enumerates matching notes by absolute path", () => {
      getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
      const app = fakeApp([
        { path: "Notes/Relativity.md", ext: "md" },
        { path: "Notes/Cooking.md", ext: "md" },
      ]);
      indexFile.mockImplementation((_app: unknown, file: { path: string }) => file.path === "Notes/Relativity.md"); // prettier-ignore

      const result = buildProjectContext(app, "p1", CWD);

      expect(result.projectContextBlock).toContain("## Notes matching an included property");
      expect(result.projectContextBlock).toContain("`/vault/Notes/Relativity.md`");
      expect(result.projectContextBlock).not.toContain("Cooking");
    });

    it("lists a note reached by both a title and a property once, as a declaration", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Relativity]],[Topics:Physics]" }));
      const app = fakeApp([{ path: "Notes/Relativity.md", ext: "md" }]);

      const block = buildProjectContext(app, "p1", CWD).projectContextBlock;

      expect(block.match(/\/vault\/Notes\/Relativity\.md/g)).toHaveLength(1);
      expect(block).toContain("## Included notes");
      expect(block).not.toContain("## Notes matching an included property");
    });

    it("lists in-vault document files by their original absolute path", () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([
        { path: "Proj/a.pdf", ext: "pdf" },
        { path: "Notes/brief.DOCX", ext: "DOCX" },
        { path: "Proj/note.md", ext: "md" },
      ]);

      const block = buildProjectContext(app, "p1", CWD).projectContextBlock;

      expect(block).toContain("## Document files");
      expect(block).toContain("- `/vault/Proj/a.pdf`");
      expect(block).toContain("- `/vault/Notes/brief.DOCX`");
      expect(block).not.toContain("note.md");
      expect(block).toContain("not converted");
    });

    it("lists only PDF, Office, EPUB and image files under Document files, sorted by path", () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([
        { path: "Proj/z.png", ext: "png" },
        { path: "Proj/data.csv", ext: "csv" },
        { path: "Proj/b.DOCX", ext: "DOCX" },
        { path: "Proj/a.pdf", ext: "pdf" },
        { path: "Proj/book.epub", ext: "epub" },
      ]);

      const block = buildProjectContext(app, "p1", CWD).projectContextBlock;

      expect(block).toContain(
        "## Document files\n- `/vault/Proj/a.pdf`\n- `/vault/Proj/b.DOCX`\n- `/vault/Proj/book.epub`\n- `/vault/Proj/z.png`"
      );
      expect(block).not.toContain("data.csv");
    });

    it("leaves out document files the project's exclusions match", () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj", exclusions: "Proj/secret.pdf" }));
      indexFile.mockImplementation((_app: unknown, file: { path: string }) => file.path !== "Proj/secret.pdf"); // prettier-ignore
      const app = fakeApp([
        { path: "Proj/a.pdf", ext: "pdf" },
        { path: "Proj/secret.pdf", ext: "pdf" },
      ]);

      const block = buildProjectContext(app, "p1", CWD).projectContextBlock;

      expect(block).toContain("`/vault/Proj/a.pdf`");
      expect(block).not.toContain("secret.pdf");
    });

    it("lists a document picked as a file once, under Included notes, so it does not spend a second manifest entry https://github.com/Brevilabs/obsidian-copilot-private/issues/657", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[report]]" }));
      const app = fakeApp([{ path: "Docs/report.pdf", ext: "pdf" }]);

      const block = buildProjectContext(app, "p1", CWD).projectContextBlock;

      expect(block.match(/\/vault\/Docs\/report\.pdf/g)).toHaveLength(1);
      expect(block).toContain("## Included notes");
      expect(block).not.toContain("## Document files");
    });

    it("keeps a project with only document files out of the empty-context block", () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([{ path: "Proj/scan.png", ext: "png" }]);

      const block = buildProjectContext(app, "p1", CWD).projectContextBlock;

      expect(block).not.toContain("No context sources are configured");
      expect(block).toContain("`/vault/Proj/scan.png`");
    });

    it("still emits <project_context> for a property-only project when no note currently matches", () => {
      getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
      indexFile.mockReturnValue(false);

      const block = buildProjectContext(fakeApp([{ path: "Notes/Cooking.md", ext: "md" }]), "p1", CWD).projectContextBlock; // prettier-ignore

      expect(block).toContain("<project_context>");
      expect(block).toContain("## Included properties");
      expect(block).not.toContain("## Included notes");
    });

    it("emits the no-sources block when the project has no context sources", () => {
      getRecord.mockReturnValue(record({}));

      const result = buildProjectContext(fakeApp(), "p1", CWD);

      expect(result.additionalDirectories).toEqual([]);
      expect(result.projectContextBlock).toContain("No context sources are configured");
    });

    it("returns the unavailable-context block with no additional directories when the project is unknown", () => {
      getRecord.mockReturnValue(undefined);

      const result = buildProjectContext(fakeApp(), "missing", CWD);

      expect(result.additionalDirectories).toEqual([]);
      expect(result.projectContextBlock).toContain("could not be loaded");
      expect(result.contextSignature).toBeUndefined();
    });
  });

  describe("buildProjectContextBlock()", () => {
    it("wraps the listing in a <project_context> block", () => {
      const md = buildProjectContextBlock(sources({ tags: ["#research"] }));
      expect(md.startsWith("<project_context>")).toBe(true);
      expect(md.endsWith("</project_context>")).toBe(true);
    });

    it("lists folders and notes by absolute path without expanding members", () => {
      const md = buildProjectContextBlock(
        sources({
          folders: [abs("Papers", "/vault/Papers")],
          tags: ["#research"],
          extensions: ["*.pdf"],
          notes: [abs("Notes/Spec.md", "/vault/Notes/Spec.md")],
        })
      );

      expect(md).toContain("## Included folders");
      expect(md).toContain("`/vault/Papers`");
      expect(md).toContain("## Included notes");
      expect(md).toContain("`/vault/Notes/Spec.md`");
      expect(md).toContain("## Included tags");
      expect(md).toContain("#research");
      expect(md).toContain("`*.pdf`");
      expect(md).not.toMatch(/Papers\/\S+\.md/);
    });

    it("lists web and YouTube sources as plain links under their own sections", () => {
      const url = "https://youtu.be/abc";
      const md = buildProjectContextBlock(sources({ webUrls: [url], youtubeUrls: [url] }));

      expect(md).toContain(`## Included URLs\n- ${url}`);
      expect(md).toContain(`## Included YouTube\n- ${url}`);
      expect(md).not.toContain("→");
    });

    it("falls back to the vault path when a source has no absolute path", () => {
      const md = buildProjectContextBlock(
        sources({ folders: [abs("Missing/")], notes: [abs("[[Ghost]]")] })
      );
      expect(md).toContain("`Missing/`");
      expect(md).toContain("`[[Ghost]]`");
    });

    it("lists a property inclusion as a source label", () => {
      const md = buildProjectContextBlock(sources({ properties: ["[Topics:Physics]"] }));
      expect(md).toContain("Included properties");
      expect(md).toContain("[Topics:Physics]");
    });

    it("lists property-matched notes under their own heading", () => {
      const md = buildProjectContextBlock(
        sources({ properties: ["[Topics:Physics]"], propertyNotes: [abs("p.md", "/vault/p.md")] })
      );
      expect(md).toContain("## Notes matching an included property");
      expect(md).toContain("`/vault/p.md`");
    });

    it("lists document files by the absolute path of the original file under their own section", () => {
      const md = buildProjectContextBlock(
        sources({
          documents: [
            abs("Papers/a.pdf", "/vault/Papers/a.pdf"),
            abs("Slides/deck.pptx", "/vault/Slides/deck.pptx"),
          ],
        })
      );

      expect(md).toContain(
        "## Document files\n- `/vault/Papers/a.pdf`\n- `/vault/Slides/deck.pptx`"
      );
      expect(md).toContain("not converted");
    });

    it("omits the truncation note when under the cap", () => {
      const md = buildProjectContextBlock(sources({ folders: [abs("A"), abs("B")] }));
      expect(md).not.toContain("omitted");
    });

    it("reports the listed and omitted counts when sources exceed the entry cap", () => {
      const folders = Array.from({ length: MAX_MANIFEST_ENTRIES + 25 }, (_, i) =>
        abs(`Folder${i}`)
      );
      const md = buildProjectContextBlock(sources({ folders }));

      expect(md).toContain(`Only the first ${MAX_MANIFEST_ENTRIES} of ${folders.length} sources`);
      expect(md).toContain("25 more are omitted");
      expect(md).toContain("Use the declared context sources above");
    });

    it("keeps every declared source when property-matched notes overflow the entry cap", () => {
      const many = Array.from({ length: MAX_MANIFEST_ENTRIES + 20 }, (_, i) => abs(`n${i}.md`));
      const md = buildProjectContextBlock(
        sources({
          propertyNotes: many,
          properties: ["[Subject:]"],
          folders: [abs("Papers", "/vault/Papers")],
          notes: [abs("Spec.md", "/vault/Spec.md")],
          extensions: ["*.pdf"],
          tags: ["#physics"],
          webUrls: ["https://a.com"],
          youtubeUrls: ["https://youtu.be/abc"],
        })
      );

      expect(md).toContain("[Subject:]");
      expect(md).toContain("`/vault/Papers`");
      expect(md).toContain("`/vault/Spec.md`");
      expect(md).toContain("`*.pdf`");
      expect(md).toContain("#physics");
      expect(md).toContain("https://a.com");
      expect(md).toContain("https://youtu.be/abc");
    });

    it("keeps a declared note when document file rows overflow the entry cap", () => {
      const documents = Array.from({ length: MAX_MANIFEST_ENTRIES + 20 }, (_, i) =>
        abs(`Papers/p${i}.pdf`, `/vault/Papers/p${i}.pdf`)
      );
      const md = buildProjectContextBlock(
        sources({
          documents,
          folders: [abs("Papers", "/vault/Papers")],
          notes: [abs("Outside/Spec.md", "/elsewhere/Outside/Spec.md")],
          tags: ["#physics"],
        })
      );

      expect(md).toContain("`/elsewhere/Outside/Spec.md`");
      expect(md).toContain("#physics");
      expect(md).toContain("`/vault/Papers`");
    });

    it("spends the leftover budget on expansions and counts the trimmed ones as omitted", () => {
      const many = Array.from({ length: 120 }, (_, i) => abs(`n${i}.md`));
      const md = buildProjectContextBlock(
        sources({
          propertyNotes: many,
          properties: ["[Subject:]"],
          folders: [abs("Papers", "/vault/Papers")],
          extensions: ["*.pdf"],
          tags: ["#physics"],
          webUrls: ["https://a.com"],
        })
      );

      const listed = many.filter((note) => md.includes(`\`${note.vaultPath}\``));
      expect(listed).toHaveLength(MAX_MANIFEST_ENTRIES - 5);
      expect(md).toContain(`Only the first ${MAX_MANIFEST_ENTRIES} of 125 sources`);
      expect(md).toContain("25 more are omitted");
    });
  });
});
