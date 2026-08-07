import { type MaterializedEntry, type MaterializedSourceType } from "./contextCacheStore";

/**
 * Hard cap on listed context entries. Past this, the block states how many were
 * omitted and how to find them — never silently truncating (design §4.4.1).
 */
export const MAX_MANIFEST_ENTRIES = 100;

/**
 * A folder/note source resolved for the context block. `absPath` lets the agent
 * reach sources that live OUTSIDE the session cwd (the whole reason the block
 * lists absolute paths); it is absent when the pattern resolves to no on-disk
 * file/folder (e.g. a not-yet-created note, or a glob), in which case the
 * user-facing `vaultPath` is listed so the source is never dropped.
 */
export interface ManifestPathEntry {
  vaultPath: string;
  absPath?: string;
}

/**
 * The user's declared context *sources* — never the files a folder/tag expands
 * to (design §4.1). URLs/YouTube links are always listed even when their fetch
 * failed (the source is still part of the project); a materialized snapshot
 * pointer is appended only when one exists.
 */
export interface ManifestSources {
  folders: ManifestPathEntry[];
  /** Notes the user declared one at a time as `[[title]]` inclusions. */
  notes: ManifestPathEntry[];
  extensions: string[];
  tags: string[];
  /**
   * Property inclusion patterns (e.g. `[Topics:Physics]`), listed as source
   * labels. The notes they match arrive separately in {@link propertyNotes},
   * which a broad property can push past the entry cap; the label ensures the
   * agent still knows which frontmatter query produced them even when cut.
   */
  properties: string[];
  /**
   * Notes enumerated from {@link properties}, kept apart from the declared
   * `notes` because they are an EXPANSION — one pattern yields as many entries
   * as the vault happens to match. See the entry-cap note in
   * {@link buildProjectContextBlock}.
   */
  propertyNotes: ManifestPathEntry[];
  webUrls: string[];
  youtubeUrls: string[];
  /** Present cache files, used to resolve snapshot pointers + list file snapshots. */
  materialized: MaterializedEntry[];
}

interface ManifestLine {
  /** Section heading the line belongs under. */
  section: string;
  text: string;
}

/**
 * Render the `<project_context>` block inlined into a session's first user
 * prompt: a short, honest map of the project's context sources with absolute
 * folder/note paths so every backend can reach them (the manifest is inlined
 * into the prompt, not written as a sidecar cache file the ACP backends would
 * never discover). Lists at most {@link MAX_MANIFEST_ENTRIES} entries and, when more
 * exist, says exactly how many were omitted so the agent never mistakes a
 * partial list for a complete one.
 */
export function buildProjectContextBlock(sources: ManifestSources): string {
  // Pointer = the snapshot's ABSOLUTE path (the shared cache is off-vault, outside
  // every project cwd, so a relative pointer wouldn't resolve for any backend). An
  // entry without an absolute path (e.g. a non-desktop build that never filled it)
  // degrades to no pointer — the source is still listed, just unlinked.
  // Keyed by `${type}:${source}`, not source alone: the same URL can be configured
  // as BOTH a web link and a YouTube link (parseProjectUrls keeps both), and each
  // gets its own type-keyed snapshot — a source-only key would collide and point
  // one row at the other's snapshot.
  const snapshotBySource = new Map(
    sources.materialized
      .filter((e): e is typeof e & { snapshotAbsPath: string } => Boolean(e.snapshotAbsPath))
      .map((e) => [`${e.type}:${e.source}`, e.snapshotAbsPath])
  );
  const withPointer = (type: MaterializedSourceType, source: string): string => {
    const absPath = snapshotBySource.get(`${type}:${source}`);
    return absPath ? `${source} → \`${absPath}\`` : source;
  };
  // Prefer the absolute path (reachable from anywhere); fall back to the vault
  // pattern when the source didn't resolve to a real on-disk path.
  const pathText = (entry: ManifestPathEntry): string => `\`${entry.absPath ?? entry.vaultPath}\``;

  // ORDER IS LOAD-BEARING — every DECLARED source comes before every EXPANDED one,
  // because the entry-cap slice below simply takes the first MAX_MANIFEST_ENTRIES.
  // A declared section grows one line per source the user added by hand, so it can
  // only overflow deliberately. An expanded section grows with the vault: one
  // property pattern yields a line per matching note, and one folder yields a line
  // per PDF/image under it. Listing expansions last means neither can push a source
  // the user actually declared out of the block. Losing one costs the agent its only
  // handle on that source — a note or snapshot outside the session cwd is reachable
  // ONLY through the absolute path in its row here.
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
