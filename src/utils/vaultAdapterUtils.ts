import { App, Platform, TAbstractFile, TFile, TFolder } from "obsidian";

export function hasCaseInsensitiveFilesystem(): boolean {
  return Platform.isWin || Platform.isMacOS || Platform.isIosApp;
}

export async function trashFile(app: App, file: TAbstractFile): Promise<void> {
  const fileManager = app.fileManager as unknown as {
    trashFile(f: TAbstractFile): Promise<void>;
  };
  await fileManager.trashFile(file);
}

export async function resolveFileByPath(app: App, filePath: string): Promise<TFile | null> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) return file;

  if (await app.vault.adapter.exists(filePath)) {
    return createSyntheticTFile(app, filePath);
  }

  return null;
}

export function isInVaultCache(app: App, filePath: string): boolean {
  return app.vault.getAbstractFileByPath(filePath) != null;
}

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

export async function patchFrontmatter(
  app: App,
  filePath: string,
  updates: Record<string, string | number>
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);

  if (file instanceof TFile && app.fileManager?.processFrontMatter) {
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(updates)) {
        frontmatter[key] = value;
      }
    });
    return;
  }

  if (!(await app.vault.adapter.exists(filePath))) return;

  const raw = await app.vault.adapter.read(filePath);
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

export async function readFrontmatterViaAdapter(
  app: App,
  filePath: string
): Promise<Record<string, string> | null> {
  const raw = await app.vault.adapter.read(filePath);
  const normalized = raw.replace(/^\uFEFF/, "");
  const yaml = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!yaml) return null;

  const result: Record<string, string> = {};
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([\w-]+):\s*(.+)/);
    if (match) {
      result[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

export function isFileAlreadyExistsError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return message.toLowerCase().includes("already exists");
}

export function isNameTooLongError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  const normalized = message.toLowerCase();
  return normalized.includes("enametoolong") || normalized.includes("name too long");
}

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
