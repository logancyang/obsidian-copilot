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

export function listMarkdownFiles(app: App, folderPath: string): TFile[] {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return [];
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder.path));
}

export async function patchFrontmatter(
  app: App,
  filePath: string,
  updates: Record<string, string | number | null>
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return;
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(updates)) {
      // A null update removes the key so a cleared flag such as an unpin leaves no stale value.
      // https://github.com/logancyang/obsidian-copilot/issues/3195
      if (value === null) delete frontmatter[key];
      else frontmatter[key] = value;
    }
  });
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
