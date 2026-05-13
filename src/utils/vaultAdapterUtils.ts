import { App, TAbstractFile, TFile, TFolder } from "obsidian";

/**
 * Move a file or folder to the user's configured trash via FileManager.trashFile (Obsidian 1.4+).
 * Respects the user's deletion preference (system trash / vault .trash / permanent).
 * Cast is needed because the bundled `obsidian.d.ts` doesn't yet expose this method.
 */
export async function trashFile(app: App, file: TAbstractFile): Promise<void> {
  const fileManager = app.fileManager as unknown as {
    trashFile(f: TAbstractFile): Promise<void>;
  };
  await fileManager.trashFile(file);
}

/**
 * Resolve a file path to a TFile, with adapter fallback for hidden directories.
 * Returns a real TFile if in vault cache, a synthetic TFile if only on disk, or null.
 */
export async function resolveFileByPath(app: App, filePath: string): Promise<TFile | null> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) return file;

  if (await app.vault.adapter.exists(filePath)) {
    return createSyntheticTFile(app, filePath);
  }

  return null;
}

/**
 * Check if a file path points to a real vault-cached file (not a hidden directory file).
 */
export function isInVaultCache(app: App, filePath: string): boolean {
  return app.vault.getAbstractFileByPath(filePath) != null;
}

/**
 * List markdown files in a folder, with adapter fallback for hidden directories.
 */
export async function listMarkdownFiles(app: App, folderPath: string): Promise<TFile[]> {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (folder instanceof TFolder) {
    return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder.path));
  }

  if (await app.vault.adapter.exists(folderPath)) {
    const listing = await app.vault.adapter.list(folderPath);
    const mdPaths = listing.files.filter((f) => f.endsWith(".md"));
    const result: TFile[] = [];
    for (const filePath of mdPaths) {
      result.push(await createSyntheticTFile(app, filePath));
    }
    return result;
  }

  return [];
}

/**
 * Patch frontmatter fields in a file, with adapter fallback for hidden directories.
 * Uses processFrontMatter for vault-cached files, regex-based YAML patching otherwise.
 */
export async function patchFrontmatter(
  app: App,
  filePath: string,
  updates: Record<string, string | number>
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);

  if (file instanceof TFile && app.fileManager?.processFrontMatter) {
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(updates)) {
        frontmatter[key] = value;
      }
    });
    return;
  }

  if (!(await app.vault.adapter.exists(filePath))) return;

  const raw = await app.vault.adapter.read(filePath);
  // Reason: detect line ending style to preserve consistency when appending new fields
  const lineEnding = raw.includes("\r\n") ? "\r\n" : "\n";
  const updated = raw.replace(
    /^(\uFEFF?---\r?\n[\s\S]*?\r?\n)(---)/,
    (_match, yamlBlock: string, closing: string) => {
      let patched = yamlBlock;
      for (const [key, value] of Object.entries(updates)) {
        const formattedValue =
          typeof value === "string"
            ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
            : String(value);
        const fieldRegex = new RegExp(`^${key}:\\s*.+`, "m");
        if (fieldRegex.test(patched)) {
          patched = patched.replace(fieldRegex, `${key}: ${formattedValue}`);
        } else {
          patched += `${key}: ${formattedValue}${lineEnding}`;
        }
      }
      return patched + closing;
    }
  );

  if (updated !== raw) {
    await app.vault.adapter.write(filePath, updated);
  }
}

/**
 * Read frontmatter key-value pairs from a file via adapter.
 * Used when metadataCache returns null (hidden directory files).
 * Returns null if file has no frontmatter block.
 */
export async function readFrontmatterViaAdapter(
  app: App,
  filePath: string
): Promise<Record<string, string> | null> {
  const raw = await app.vault.adapter.read(filePath);
  // Reason: strip BOM and accept CRLF line endings for Windows/external-editor compatibility
  const normalized = raw.replace(/^\uFEFF/, "");
  const yaml = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!yaml) return null;

  const result: Record<string, string> = {};
  for (const line of yaml.split(/\r?\n/)) {
    // Reason: use [\w-] instead of \w to support hyphenated YAML keys (e.g. copilot-project-last-used)
    const match = line.match(/^([\w-]+):\s*(.+)/);
    if (match) {
      result[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

/**
 * Create a synthetic TFile object from adapter stat data.
 * Used for files in hidden directories not indexed by Obsidian's vault cache.
 */
async function createSyntheticTFile(app: App, filePath: string): Promise<TFile> {
  const stat = await app.vault.adapter.stat(filePath);
  const name = filePath.split("/").pop() ?? "";
  const synthetic: TFile = Object.create(TFile.prototype);
  Object.assign(synthetic, {
    path: filePath,
    name,
    basename: name.replace(/\.md$/, ""),
    extension: "md",
    stat: stat ?? { ctime: Date.now(), mtime: Date.now(), size: 0 },
    vault: app.vault,
    parent: null,
  });
  return synthetic;
}
