import { App, parseYaml, stringifyYaml, TFile } from "obsidian";
import {
  isInVaultCache,
  listMarkdownFiles,
  resolveFileByPath,
  trashFile,
} from "@/utils/vaultAdapterUtils";

export interface FrontmatterMarkdownFile {
  file: TFile;
  content: string;
  frontmatter: Record<string, unknown>;
}

/** Read indexed or hidden Markdown files with their body and YAML frontmatter. */
export async function readFrontmatterMarkdownFile(
  app: App,
  filePath: string
): Promise<FrontmatterMarkdownFile | null> {
  if (!app.vault.adapter?.read || !app.vault.getAbstractFileByPath) return null;
  const file = await resolveFileByPath(app, filePath);
  if (!file) return null;
  const raw = await app.vault.adapter.read(filePath);
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const data = match ? parseYaml(match[1]) : null;
  const frontmatter =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const content = match ? normalized.slice(match[0].length).replace(/^\r?\n/, "") : normalized;
  return { file, content, frontmatter };
}

/** List Markdown files directly inside a folder, including files in hidden folders. */
export async function listFrontmatterMarkdownFiles(app: App, folderPath: string): Promise<TFile[]> {
  if (!app.vault.getAbstractFileByPath) {
    return app.vault
      .getFiles()
      .filter((file) => file.path.startsWith(`${folderPath}/`) && file.extension === "md");
  }
  return listMarkdownFiles(app, folderPath);
}

/** Write a Markdown body and its frontmatter through the indexed or adapter path. */
export async function writeFrontmatterMarkdownFile(
  app: App,
  filePath: string,
  content: string,
  frontmatter: Record<string, unknown>
): Promise<TFile> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile && app.fileManager?.processFrontMatter) {
    await app.vault.modify(file, content);
    await app.fileManager.processFrontMatter(file, (current: Record<string, unknown>) => {
      Object.assign(current, frontmatter);
    });
    return file;
  }
  const folderPath = filePath.slice(0, filePath.lastIndexOf("/"));
  if (isInVaultCache(app, folderPath)) {
    const created = await app.vault.create(filePath, content);
    await app.fileManager.processFrontMatter(created, (current: Record<string, unknown>) => {
      Object.assign(current, frontmatter);
    });
    return created;
  }
  const existing = await resolveFileByPath(app, filePath);
  // Obsidian does not index dot-folders, so preserve metadata through adapter writes. https://github.com/logancyang/obsidian-copilot/issues/3075
  const current = existing ? await readFrontmatterMarkdownFile(app, filePath) : null;
  const serialized = `---\n${stringifyYaml({ ...current?.frontmatter, ...frontmatter })}---\n${content}`;
  await app.vault.adapter.write(filePath, serialized);
  return existing ?? (await resolveFileByPath(app, filePath))!;
}

/** Update frontmatter fields without changing the Markdown body. */
export async function updateFrontmatterMarkdownFile(
  app: App,
  filePath: string,
  update: (frontmatter: Record<string, unknown>) => void
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile && app.fileManager?.processFrontMatter) {
    await app.fileManager.processFrontMatter(file, update);
    return;
  }
  // Hidden files do not have metadata-cache entries, so apply the same update to serialized YAML. https://github.com/logancyang/obsidian-copilot/issues/3075
  const parsed = await readFrontmatterMarkdownFile(app, filePath);
  if (!parsed) return;
  update(parsed.frontmatter);
  await app.vault.adapter.write(
    filePath,
    `---\n${stringifyYaml(parsed.frontmatter)}---\n${parsed.content}`
  );
}

/** Rename an indexed or hidden Markdown file. */
export async function renameFrontmatterMarkdownFile(
  app: App,
  oldPath: string,
  newPath: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(oldPath);
  if (file instanceof TFile) {
    await app.vault.rename(file, newPath);
  } else {
    // Hidden files are absent from the vault index but remain addressable through the adapter. https://github.com/logancyang/obsidian-copilot/issues/3075
    await app.vault.adapter.rename(oldPath, newPath);
  }
}

/** Delete an indexed Markdown file to the configured trash, or remove its hidden path. */
export async function deleteFrontmatterMarkdownFile(app: App, filePath: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    await trashFile(app, file);
  } else if (await app.vault.adapter.exists(filePath)) {
    // Hidden files have no indexed TFile to pass to the configured trash handler. https://github.com/logancyang/obsidian-copilot/issues/3075
    await app.vault.adapter.remove(filePath);
  }
}
