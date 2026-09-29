import { type MaterializedEntry, type MaterializedSourceType } from "./contextCacheStore";

export const MAX_MANIFEST_ENTRIES = 100;

export interface ManifestPathEntry {
  vaultPath: string;
  absPath?: string;
}

export interface ManifestSources {
  folders: ManifestPathEntry[];
  notes: ManifestPathEntry[];
  extensions: string[];
  tags: string[];
  properties: string[];
  propertyNotes: ManifestPathEntry[];
  webUrls: string[];
  youtubeUrls: string[];
  materialized: MaterializedEntry[];
}

interface ManifestLine {
  section: string;
  text: string;
}

export function buildProjectContextBlock(sources: ManifestSources): string {
  const snapshotBySource = new Map(
    sources.materialized
      .filter((e): e is typeof e & { snapshotAbsPath: string } => Boolean(e.snapshotAbsPath))
      .map((e) => [`${e.type}:${e.source}`, e.snapshotAbsPath])
  );
  const withPointer = (type: MaterializedSourceType, source: string): string => {
    const absPath = snapshotBySource.get(`${type}:${source}`);
    return absPath ? `${source} → \`${absPath}\`` : source;
  };
  const pathText = (entry: ManifestPathEntry): string => `\`${entry.absPath ?? entry.vaultPath}\``;

  const declared: ManifestLine[] = [
    ...sources.folders.map((e) => line("Included folders", pathText(e))),
    ...sources.properties.map((p) => line("Included properties", p)),
    ...sources.notes.map((e) => line("Included notes", pathText(e))),
    ...sources.extensions.map((p) => line("Included file types", `\`${p}\``)),
    ...sources.tags.map((t) => line("Included tags", t)),
    ...sources.webUrls.map((u) => line("Included URLs", withPointer("web", u))),
    ...sources.youtubeUrls.map((u) => line("Included YouTube", withPointer("youtube", u))),
  ];
  const expanded: ManifestLine[] = [
    ...sources.materialized
      .filter((e) => e.type === "file")
      .map((e) => line("Materialized files", withPointer(e.type, e.source))),
    ...sources.propertyNotes.map((e) => line("Notes matching an included property", pathText(e))),
  ];
  const lines: ManifestLine[] = [...declared, ...expanded];

  const total = lines.length;
  const shown = lines.slice(0, MAX_MANIFEST_ENTRIES);
  const omitted = total - shown.length;

  const out: string[] = [
    "<project_context>",
    "Context sources for this project, with absolute paths. Folders and tags are",
    "listed as sources, not expanded into member files — use your own search",
    "(grep/glob/read) to enumerate them. Properties are listed as source labels and",
    'also expanded into the notes they match, under "Notes matching an included',
    'property" (the label is listed first so it survives the entry cap).',
    "Materialized snapshots of URLs, YouTube transcripts, and PDFs/images are shown",
    "inline as an absolute path after the source, formatted `<source> → <absolute path>`",
    "— read that path directly. A source with no path isn't cached (not yet converted",
    "or conversion failed); use the source itself.",
  ];

  let currentSection = "";
  for (const item of shown) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      out.push("", `## ${currentSection}`);
    }
    out.push(`- ${item.text}`);
  }

  if (omitted > 0) {
    out.push(
      "",
      `> Only the first ${shown.length} of ${total} sources are listed; ${omitted} more are omitted. ` +
        `Use the declared context sources above with grep/glob/read to find the rest.`
    );
  }
  out.push("</project_context>");
  return out.join("\n");
}

function line(section: string, text: string): ManifestLine {
  return { section, text };
}
