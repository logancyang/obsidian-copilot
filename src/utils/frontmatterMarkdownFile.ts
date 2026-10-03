import { logWarn } from "@/logger";
import { stripFrontmatter } from "@/utils";
import { App, parseYaml, stringifyYaml, TFile } from "obsidian";
import {
  isInVaultCache,
  listMarkdownFiles,
  resolveFileByPath,
  trashFile,
} from "@/utils/vaultAdapterUtils";

export interface FrontmatterMarkdownFile {
  content: string;
  frontmatter: Record<string, unknown>;
  hasMalformedFrontmatter: boolean;
}

export async function readFrontmatterMarkdownFile(
  app: App,
  file: TFile
): Promise<FrontmatterMarkdownFile> {
  if (isInVaultCache(app, file.path)) {
    const raw = await app.vault.read(file);
    return {
      content: stripFrontmatter(raw),
      frontmatter: app.metadataCache.getFileCache(file)?.frontmatter ?? {},
      hasMalformedFrontmatter: false,
    };
  }
  const raw = await app.vault.adapter.read(file.path);
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n(?:([\s\S]*?)\r?\n)??---(?:\r?\n|$)/);
  let data: unknown = null;
  let hasMalformedFrontmatter = false;
  try {
    data = match?.[1] ? parseYaml(match[1]) : null;
  } catch (error) {
    hasMalformedFrontmatter = true;
    logWarn(`Ignoring malformed frontmatter in ${file.path}`, error);
  }
  const frontmatter =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const content = match ? normalized.slice(match[0].length).replace(/^\r?\n/, "") : normalized;
  return { content, frontmatter, hasMalformedFrontmatter };
}

export async function listFrontmatterMarkdownFiles(app: App, folderPath: string): Promise<TFile[]> {
  return listMarkdownFiles(app, folderPath);
}

export async function writeFrontmatterMarkdownFile(
  app: App,
  filePath: string,
  content: string,
  frontmatter: Record<string, unknown>
): Promise<TFile> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
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
  const current = existing ? await readFrontmatterMarkdownFile(app, existing) : null;
  const serialized = `---\n${stringifyYaml({ ...current?.frontmatter, ...frontmatter })}---\n${content}`;
  await app.vault.adapter.write(filePath, serialized);
  return existing ?? (await resolveFileByPath(app, filePath))!;
}

export async function updateFrontmatterMarkdownFile(
  app: App,
  filePath: string,
  update: (frontmatter: Record<string, unknown>) => void
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    await app.fileManager.processFrontMatter(file, update);
    return;
  }
  // Hidden files do not have metadata-cache entries, so apply the same update to serialized YAML. https://github.com/logancyang/obsidian-copilot/issues/3075
  const hiddenFile = await resolveFileByPath(app, filePath);
  if (!hiddenFile) return;
  const parsed = await readFrontmatterMarkdownFile(app, hiddenFile);
  if (parsed.hasMalformedFrontmatter) return;
  update(parsed.frontmatter);
  await app.vault.adapter.write(
    filePath,
    `---\n${stringifyYaml(parsed.frontmatter)}---\n${parsed.content}`
  );
}

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

export async function deleteFrontmatterMarkdownFile(app: App, filePath: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    await trashFile(app, file);
  } else if (await app.vault.adapter.exists(filePath)) {
    // Hidden files have no indexed TFile to pass to the configured trash handler. https://github.com/logancyang/obsidian-copilot/issues/3075
    await app.vault.adapter.remove(filePath);
  }
}
