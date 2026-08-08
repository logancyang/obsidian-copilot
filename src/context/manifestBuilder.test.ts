import type { MaterializedEntry } from "./contextCacheStore";
import {
  buildProjectContextBlock,
  MAX_MANIFEST_ENTRIES,
  type ManifestPathEntry,
  type ManifestSources,
} from "./manifestBuilder";

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
    webUrls: [],
    youtubeUrls: [],
    materialized: [],
    ...over,
  };
}

describe("buildProjectContextBlock", () => {
  it("wraps the listing in a <project_context> block", () => {
    const md = buildProjectContextBlock(sources({ tags: ["#research"] }));
    expect(md.startsWith("<project_context>")).toBe(true);
    expect(md.endsWith("</project_context>")).toBe(true);
  });

  it("lists folders and notes by absolute path without expanding members", () => {
    const materialized: MaterializedEntry[] = [
      {
        type: "web",
        source: "https://a.com",
        cacheFileName: "web-1.md",
        snapshotAbsPath: "/cache/remotes/web-1.md",
      },
    ];
    const md = buildProjectContextBlock(
      sources({
        folders: [abs("Papers", "/vault/Papers")],
        tags: ["#research"],
        extensions: ["*.pdf"],
        notes: [abs("Notes/Spec.md", "/vault/Notes/Spec.md")],
        webUrls: ["https://a.com"],
        materialized,
      })
    );

    expect(md).toContain("## Included folders");
    expect(md).toContain("`/vault/Papers`");
    expect(md).toContain("## Included notes");
    expect(md).toContain("`/vault/Notes/Spec.md`");
    expect(md).toContain("## Included tags");
    expect(md).toContain("#research");
    expect(md).toContain("`*.pdf`");
    expect(md).toContain("https://a.com → `/cache/remotes/web-1.md`");
    // No member-file expansion of the folder.
    expect(md).not.toMatch(/Papers\/\S+\.md/);
  });

  it("lists a materialized source without a pointer when it has no absolute path", () => {
    // A snapshot entry that never got an absolute path (e.g. a non-desktop build)
    // degrades to no pointer — the source stays listed, just unlinked.
    const materialized: MaterializedEntry[] = [
      { type: "web", source: "https://a.com", cacheFileName: "web-1.md" },
    ];
    const md = buildProjectContextBlock(sources({ webUrls: ["https://a.com"], materialized }));
    expect(md).toContain("https://a.com");
    expect(md).not.toContain("https://a.com → ");
  });

  it("falls back to the vault path when a source has no absolute path", () => {
    const md = buildProjectContextBlock(
      sources({ folders: [abs("Missing/")], notes: [abs("[[Ghost]]")] })
    );
    expect(md).toContain("`Missing/`");
    expect(md).toContain("`[[Ghost]]`");
  });

  it("lists a declared URL even when it has no materialized snapshot (fetch failed)", () => {
    const md = buildProjectContextBlock(
      sources({ webUrls: ["https://broken.com"], materialized: [] })
    );
    expect(md).toContain("## Included URLs");
    expect(md).toContain("https://broken.com");
    // No snapshot pointer when materialization failed.
    expect(md).not.toContain("https://broken.com → ");
  });

  it("points web and youtube rows at their own snapshots when the same URL is in both", () => {
    // parseProjectUrls keeps the same URL as both a web and a youtube source; each
    // gets its own type-keyed snapshot. The pointer lookup must be type-aware or
    // one row would resolve to the other's snapshot.
    const url = "https://youtu.be/abc";
    const materialized: MaterializedEntry[] = [
      { type: "web", source: url, cacheFileName: "web-1.md", snapshotAbsPath: "/cache/remotes/web-1.md" }, // prettier-ignore
      { type: "youtube", source: url, cacheFileName: "youtube-1.md", snapshotAbsPath: "/cache/remotes/youtube-1.md" }, // prettier-ignore
    ];
    const md = buildProjectContextBlock(
      sources({ webUrls: [url], youtubeUrls: [url], materialized })
    );

    expect(md).toContain(`${url} → \`/cache/remotes/web-1.md\``);
    expect(md).toContain(`${url} → \`/cache/remotes/youtube-1.md\``);
  });

  it("states omitted count honestly past the entry cap", () => {
    const folders = Array.from({ length: MAX_MANIFEST_ENTRIES + 25 }, (_, i) => abs(`Folder${i}`));
    const md = buildProjectContextBlock(sources({ folders }));

    expect(md).toContain(`Only the first ${MAX_MANIFEST_ENTRIES} of ${folders.length} sources`);
    expect(md).toContain("25 more are omitted");
    expect(md).toContain("Use the declared context sources above");
  });

  it("omits the truncation note when under the cap", () => {
    const md = buildProjectContextBlock(sources({ folders: [abs("A"), abs("B")] }));
    expect(md).not.toContain("omitted");
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

  it("keeps every declared source when property-matched notes overflow the entry cap", () => {
    // One `[Subject:]` enumerates every note carrying the key, which alone exhausts
    // the cap. No declared source may be pushed out by that expansion — a dropped URL
    // row loses its snapshot pointer, and that cache path appears nowhere else.
    const many = Array.from({ length: MAX_MANIFEST_ENTRIES + 20 }, (_, i) => abs(`n${i}.md`));
    const materialized: MaterializedEntry[] = [
      {
        type: "web",
        source: "https://a.com",
        cacheFileName: "web-1.md",
        snapshotAbsPath: "/cache/remotes/web-1.md",
      },
    ];
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
        materialized,
      })
    );

    expect(md).toContain("[Subject:]");
    expect(md).toContain("`/vault/Papers`");
    expect(md).toContain("`/vault/Spec.md`");
    expect(md).toContain("`*.pdf`");
    expect(md).toContain("#physics");
    expect(md).toContain("https://a.com → `/cache/remotes/web-1.md`");
    expect(md).toContain("https://youtu.be/abc");
  });

  it("keeps a declared note when materialized file rows overflow the entry cap", () => {
    // A folder inclusion over a PDF-heavy folder expands to one materialized row per
    // binary, so those rows are an expansion too and must not evict the `[[note]]`
    // the user declared by hand — off-cwd, its absolute path here is the agent's
    // only handle on it.
    const materialized: MaterializedEntry[] = Array.from(
      { length: MAX_MANIFEST_ENTRIES + 20 },
      (_, i) => ({
        type: "file" as const,
        source: `Papers/p${i}.pdf`,
        cacheFileName: `file-${i}.md`,
        snapshotAbsPath: `/cache/files/file-${i}.md`,
      })
    );
    const md = buildProjectContextBlock(
      sources({
        materialized,
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
    // 5 declared sources + 120 property matches = 125 total, so the expansion gets
    // the remaining 95 slots and the 25 it loses are what the truncation note reports.
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
