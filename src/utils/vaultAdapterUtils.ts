import { App, TFile, TFolder } from "obsidian";

/**
 * Resolve a file path to a TFile, with adapter fallback for hidden directories.
 * Returns a real TFile if in vault cache, a synthetic TFile if only on disk, or null.
 */
export async function resolveFileByPath(app: App, filePath: string): Promise<TFile | null> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file) return file as TFile;

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

  if (file && app.fileManager?.processFrontMatter) {
    await app.fileManager.processFrontMatter(file as TFile, (frontmatter) => {
      for (const [key, value] of Object.entries(updates)) {
        frontmatter[key] = value;
      }
    });
    return;
  }

  if (!(await app.vault.adapter.exists(filePath))) return;

  const raw = await app.vault.adapter.read(filePath);
  const updated = raw.replace(
    /^(---\n[\s\S]*?)(---)/,
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
          patched += `${key}: ${formattedValue}\n`;
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
  const yaml = raw.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!yaml) return null;

  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w+):\s*(.+)/);
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
  return {
    path: filePath,
    name,
    basename: name.replace(/\.md$/, ""),
    extension: "md",
    stat: stat ?? { ctime: Date.now(), mtime: Date.now(), size: 0 },
    vault: app.vault,
    parent: null,
  } as unknown as TFile;
}
