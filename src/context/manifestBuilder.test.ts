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
  LINKED_QUERY_INSTRUCTION,
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
    tags: [],
    properties: [],
    documents: [],
    webUrls: [],
    youtubeUrls: [],
    ...over,
  };
}

function record(contextSource: Record<string, string | undefined>, id = "p1") {
  return { project: { id, contextSource }, filePath: "Proj/AGENTS.md", folderName: "Proj" };
}

function fakeApp(
  files: Array<{ path: string; ext: string }> = [],
  folders: string[] = [],
  caches: Record<string, unknown> = {}
): App {
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
    metadataCache: { getFileCache: (file: { path: string }) => caches[file.path] ?? null },
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

    it("lists exactly the linked folder, note, tag, property and URL plus the instruction to resolve tags and properties, without the notes they match — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
      getRecord.mockReturnValue(
        record({
          inclusions: "Plans,[[brief]],%23launch,[status:active]",
          webUrls: "https://example.com",
        })
      );
      const app = fakeApp(
        [
          { path: "Plans/brief.md", ext: "md" },
          { path: "Work/standup.md", ext: "md" },
          { path: "Work/roadmap.md", ext: "md" },
        ],
        ["Plans"],
        {
          "Plans/brief.md": { frontmatter: { tags: ["launch"], status: "active" } },
          "Work/standup.md": { tags: [{ tag: "#launch" }] },
          "Work/roadmap.md": { frontmatter: { status: "active" } },
        }
      );

      const block = buildProjectContext(app, "p1");

      expect(block).toBe(
        [
          "<project_context>",
          PROJECT_WORKSPACE_POLICY,
          "Context sources for this project.",
          "",
          "## Included folders",
          "- `/vault/Plans`",
          "",
          "## Included properties",
          "- [status:active]",
          "",
          "## Included notes",
          "- `/vault/Plans/brief.md`",
          "",
          "## Included tags",
          "- #launch",
          "",
          "## Included URLs",
          "- https://example.com",
          "",
          LINKED_QUERY_INSTRUCTION,
          "</project_context>",
        ].join("\n")
      );
    });

    it("lists the folder, tag, link and property of a project that also saved file-type patterns and exclusions, and ignores those two kinds https://github.com/Brevilabs/obsidian-copilot-private/issues/841", () => {
      getRecord.mockReturnValue(
        record({
          inclusions: "%23launch,*.pdf,%5Btopic%3Aphysics%5D,Research",
          exclusions: "*.tmp,Research%2FPrivate",
          webUrls: "https://example.com/spec",
        })
      );
      indexFile.mockImplementation(jest.requireActual<typeof import("@/search/searchUtils")>("@/search/searchUtils").shouldIndexFile); // prettier-ignore
      const app = fakeApp(
        [
          { path: "Research/Private/secret.md", ext: "md" },
          { path: "Docs/manual.pdf", ext: "pdf" },
        ],
        ["Research"]
      );

      const block = buildProjectContext(app, "p1");

      expect(block).toContain(
        [
          "Context sources for this project.",
          "",
          "## Included folders",
          "- `/vault/Research`",
          "",
          "## Included properties",
          "- [topic:physics]",
          "",
          "## Included tags",
          "- #launch",
          "",
          "## Included URLs",
          "- https://example.com/spec",
          "",
          LINKED_QUERY_INSTRUCTION,
          "</project_context>",
        ].join("\n")
      );
      expect(block).not.toContain("pdf");
      expect(block).not.toContain("tmp");
      expect(block).not.toContain("Private");
    });

    it("treats a project whose only saved patterns are file types and exclusions as having no context sources https://github.com/Brevilabs/obsidian-copilot-private/issues/841", () => {
      getRecord.mockReturnValue(record({ inclusions: "*.pdf", exclusions: "Archive" }));
      const app = fakeApp([{ path: "Docs/manual.pdf", ext: "pdf" }]);

      expect(buildProjectContext(app, "p1")).toContain("No context sources are configured");
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

      const block = buildProjectContext(fakeApp([{ path: "Notes/Cooking.md", ext: "md" }]), "p1"); // prettier-ignore

      expect(block).toContain("<project_context>");
      expect(block).toContain("## Included properties\n- [Topics:Physics]");
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

    it("tells the agent once how to find the notes of linked tags and properties, after the listing and ahead of the overflow note, without spending an entry of the cap — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
      const folders = Array.from({ length: MAX_MANIFEST_ENTRIES + 5 }, (_, i) => abs(`F${i}`));
      const md = buildProjectContextBlock(
        sources({ folders, tags: ["#launch"], properties: ["[status:active]"] })
      );

      expect(md.split(LINKED_QUERY_INSTRUCTION)).toHaveLength(2);
      expect(md).toContain(
        `\n\n${LINKED_QUERY_INSTRUCTION}\n\n> 7 more sources are not listed; search the sources above for them.\n</project_context>`
      );
    });

    it("gives the instruction for a property even when the project links no tag — https://github.com/Brevilabs/obsidian-copilot-private/issues/838", () => {
      const md = buildProjectContextBlock(sources({ properties: ["[status:active]"] }));

      expect(md).toContain(
        `## Included properties\n- [status:active]\n\n${LINKED_QUERY_INSTRUCTION}\n</project_context>`
      );
    });

    it("leaves out the instruction when the project links no tag or property", () => {
      const md = buildProjectContextBlock(
        sources({ folders: [abs("Papers", "/vault/Papers")], webUrls: ["https://a.com"] })
      );

      expect(md).not.toContain(LINKED_QUERY_INSTRUCTION);
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
          notes: [abs("Notes/Spec.md", "/vault/Notes/Spec.md")],
        })
      );

      expect(md).toContain("## Included folders");
      expect(md).toContain("`/vault/Papers`");
      expect(md).toContain("## Included notes");
      expect(md).toContain("`/vault/Notes/Spec.md`");
      expect(md).toContain("## Included tags");
      expect(md).toContain("#research");
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

    it("keeps every declared source when document file rows overflow the entry cap", () => {
      const many = Array.from({ length: MAX_MANIFEST_ENTRIES + 20 }, (_, i) => abs(`p${i}.pdf`));
      const md = buildProjectContextBlock(
        sources({
          documents: many,
          properties: ["[Subject:]"],
          folders: [abs("Papers", "/vault/Papers")],
          notes: [abs("Spec.md", "/vault/Spec.md")],
          tags: ["#physics"],
          webUrls: ["https://a.com"],
          youtubeUrls: ["https://youtu.be/abc"],
        })
      );

      expect(md).toContain("[Subject:]");
      expect(md).toContain("`/vault/Papers`");
      expect(md).toContain("`/vault/Spec.md`");
      expect(md).toContain("#physics");
      expect(md).toContain("https://a.com");
      expect(md).toContain("https://youtu.be/abc");
    });

    it("spends the leftover budget on expansions and counts the trimmed ones as omitted", () => {
      const many = Array.from({ length: 120 }, (_, i) => abs(`p${i}.pdf`));
      const md = buildProjectContextBlock(
        sources({
          documents: many,
          properties: ["[Subject:]"],
          folders: [abs("Papers", "/vault/Papers")],
          tags: ["#physics"],
          webUrls: ["https://a.com"],
        })
      );

      const listed = many.filter((note) => md.includes(`\`${note.vaultPath}\``));
      expect(listed).toHaveLength(MAX_MANIFEST_ENTRIES - 4);
      expect(md).toContain("24 more sources are not listed");
    });
  });
});
