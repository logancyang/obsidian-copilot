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
  PROJECT_WORKSPACE_POLICY,
  type ManifestPathEntry,
  type ManifestSources,
} from "./manifestBuilder";

const getRecord = getCachedProjectRecordById as jest.Mock;
const indexFile = shouldIndexFile as jest.Mock;

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

      const block = buildProjectContext(app, "p1");

      expect(block).toContain("## Included notes");
      expect(block).toContain("`/vault/Notes/Spec.md`");
    });

    it("splits the saved web and YouTube URL settings into one link per line", () => {
      getRecord.mockReturnValue(
        record({ webUrls: "https://example.com\n", youtubeUrls: "https://youtu.be/abc" })
      );

      const block = buildProjectContext(fakeApp(), "p1");

      expect(block).toContain("## Included URLs\n- https://example.com");
      expect(block).toContain("## Included YouTube\n- https://youtu.be/abc");
    });

    it("lists every note that shares an inclusion title (basename collision)", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
      const app = fakeApp([
        { path: "A/Spec.md", ext: "md" },
        { path: "B/Spec.md", ext: "md" },
      ]);

      const block = buildProjectContext(app, "p1");

      expect(block).toContain("`/vault/A/Spec.md`");
      expect(block).toContain("`/vault/B/Spec.md`");
    });

    it("counts a property-only inclusion as a source and enumerates matching notes by absolute path", () => {
      getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
      const app = fakeApp([
        { path: "Notes/Relativity.md", ext: "md" },
        { path: "Notes/Cooking.md", ext: "md" },
      ]);
      indexFile.mockImplementation((_app: unknown, file: { path: string }) => file.path === "Notes/Relativity.md"); // prettier-ignore

      const block = buildProjectContext(app, "p1");

      expect(block).toContain("## Notes matching an included property");
      expect(block).toContain("`/vault/Notes/Relativity.md`");
      expect(block).not.toContain("Cooking");
    });

    it("lists a note reached by both a title and a property once, as a declaration", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Relativity]],[Topics:Physics]" }));
      const app = fakeApp([{ path: "Notes/Relativity.md", ext: "md" }]);

      const block = buildProjectContext(app, "p1");

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

      const block = buildProjectContext(app, "p1");

      expect(block).toContain("## Document files");
      expect(block).toContain("- `/vault/Proj/a.pdf`");
      expect(block).toContain("- `/vault/Notes/brief.DOCX`");
      expect(block).not.toContain("note.md");
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

      const block = buildProjectContext(app, "p1");

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

      const block = buildProjectContext(app, "p1");

      expect(block).toContain("`/vault/Proj/a.pdf`");
      expect(block).not.toContain("secret.pdf");
    });

    it("lists a document picked as a file once, under Included notes, so it does not spend a second manifest entry https://github.com/Brevilabs/obsidian-copilot-private/issues/657", () => {
      getRecord.mockReturnValue(record({ inclusions: "[[report]]" }));
      const app = fakeApp([{ path: "Docs/report.pdf", ext: "pdf" }]);

      const block = buildProjectContext(app, "p1");

      expect(block.match(/\/vault\/Docs\/report\.pdf/g)).toHaveLength(1);
      expect(block).toContain("## Included notes");
      expect(block).not.toContain("## Document files");
    });

    it("keeps a project with only document files out of the empty-context block", () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([{ path: "Proj/scan.png", ext: "png" }]);

      const block = buildProjectContext(app, "p1");

      expect(block).not.toContain("No context sources are configured");
      expect(block).toContain("`/vault/Proj/scan.png`");
    });

    it("still emits <project_context> for a property-only project when no note currently matches", () => {
      getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
      indexFile.mockReturnValue(false);

      const block = buildProjectContext(fakeApp([{ path: "Notes/Cooking.md", ext: "md" }]), "p1"); // prettier-ignore

      expect(block).toContain("<project_context>");
      expect(block).toContain("## Included properties");
      expect(block).not.toContain("## Included notes");
    });

    it("lists folder inclusions by absolute path, inside or outside the working directory", () => {
      getRecord.mockReturnValue(record({ inclusions: "External,Proj/Sub" }));
      const app = fakeApp([], ["External", "Proj/Sub"]);

      const block = buildProjectContext(app, "p1");

      expect(block).toContain("`/vault/External`");
      expect(block).toContain("`/vault/Proj/Sub`");
    });

    it("emits the no-sources block when the project has no context sources", () => {
      getRecord.mockReturnValue(record({}));

      expect(buildProjectContext(fakeApp(), "p1")).toContain("No context sources are configured");
    });

    it("returns the unavailable-context block when the project is unknown", () => {
      getRecord.mockReturnValue(undefined);

      expect(buildProjectContext(fakeApp(), "missing")).toContain("could not be loaded");
    });

    it("tells a project chat to save generated files to outputs/ even when the project has no sources or cannot be loaded https://github.com/logancyang/obsidian-copilot/issues/3801", () => {
      getRecord.mockReturnValue(record({}));
      const noSources = buildProjectContext(fakeApp(), "p1");
      getRecord.mockReturnValue(undefined);
      const unavailable = buildProjectContext(fakeApp(), "missing");

      expect(noSources).toContain(PROJECT_WORKSPACE_POLICY);
      expect(unavailable).toContain(PROJECT_WORKSPACE_POLICY);
    });
  });

  describe("buildProjectContextBlock()", () => {
    it("wraps the listing in a <project_context> block", () => {
      const md = buildProjectContextBlock(sources({ tags: ["#research"] }));
      expect(md.startsWith("<project_context>")).toBe(true);
      expect(md.endsWith("</project_context>")).toBe(true);
    });

    it("states the outputs/ workspace policy ahead of the source listing, so the entry cap never drops it https://github.com/logancyang/obsidian-copilot/issues/3801", () => {
      const md = buildProjectContextBlock(sources({ tags: ["#research"] }));

      expect(md.startsWith(`<project_context>\n${PROJECT_WORKSPACE_POLICY}\n`)).toBe(true);
      expect(md.indexOf(PROJECT_WORKSPACE_POLICY)).toBeLessThan(md.indexOf("## Included tags"));
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
    });

    it("omits the truncation note when under the cap", () => {
      const md = buildProjectContextBlock(sources({ folders: [abs("A"), abs("B")] }));
      expect(md).not.toContain("not listed");
    });

    it("reports how many sources are left out and points the agent at the listed sources when sources exceed the entry cap", () => {
      const folders = Array.from({ length: MAX_MANIFEST_ENTRIES + 25 }, (_, i) =>
        abs(`Folder${i}`)
      );
      const md = buildProjectContextBlock(sources({ folders }));

      expect(md).toContain("> 25 more sources are not listed; search the sources above for them.");
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
      expect(md).toContain("25 more sources are not listed");
    });
  });
});
