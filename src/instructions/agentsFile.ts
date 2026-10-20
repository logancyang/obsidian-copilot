import { logWarn } from "@/logger";
import { ensureFolderExists } from "@/utils";
import { hasCaseInsensitiveFilesystem, trashFile } from "@/utils/vaultAdapterUtils";
import { App, normalizePath, TFile, TFolder } from "obsidian";

export const AGENTS_FILE_NAME = "AGENTS.md";
export const CLAUDE_FILE_NAME = "CLAUDE.md";

const CLAUDE_REFERENCE_PATTERN = /^[ \t>-]*@\.?\/?AGENTS\.md[ \t]*$/im;

export function isClaudeImportOnly(content: string): boolean {
  return content
    .split(/\r?\n/)
    .every((line) => line.trim().length === 0 || CLAUDE_REFERENCE_PATTERN.test(line));
}

const GENERATED_MIRROR_HEADER =
  /^(\uFEFF?)<!-- copilot:generated-agents-mirror [^\r\n]* -->\r?\n\r?\n/;

export async function agentsFileIsUninitialized(app: App, folderPath: string): Promise<boolean> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  const file = findCachedInstructionFile(app, agentsPath);
  if (!file) return true;
  return GENERATED_MIRROR_HEADER.test(await app.vault.read(file));
}

export async function readAgentsFile(app: App, folderPath: string): Promise<string> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  const file = findCachedInstructionFile(app, agentsPath);
  if (!file) return "";
  const content = await app.vault.read(file);
  return content.replace(GENERATED_MIRROR_HEADER, "$1");
}

export async function writeAgentsFile(
  app: App,
  folderPath: string,
  content: string
): Promise<void> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  if (!findCachedInstructionFile(app, agentsPath) && !content.trim()) return;
  const file = await ensureAgentsFile(app, folderPath, content);
  if ((await app.vault.read(file)) === content) return;
  await app.vault.modify(file, content);
}

export async function removeGeneratedInstructionFiles(app: App, folderPath: string): Promise<void> {
  try {
    const file = findCachedInstructionFile(app, childPath(folderPath, AGENTS_FILE_NAME));
    if (!file) return;
    if (!GENERATED_MIRROR_HEADER.test(await app.vault.read(file))) return;
    await trashFile(app, file);
  } catch (error) {
    logWarn(
      `[Instructions] Failed to remove the generated ${AGENTS_FILE_NAME} in "${folderPath}"`,
      error
    );
  }
}

export interface InstructionFilesSnapshot {
  agents: string | null;
}

export async function captureInstructionFiles(
  app: App,
  folderPath: string
): Promise<InstructionFilesSnapshot> {
  return {
    agents: await readIfPresent(app, childPath(folderPath, AGENTS_FILE_NAME)),
  };
}

export async function restoreInstructionFiles(
  app: App,
  folderPath: string,
  snapshot: InstructionFilesSnapshot
): Promise<void> {
  try {
    await restoreFile(app, childPath(folderPath, AGENTS_FILE_NAME), snapshot.agents);
  } catch (error) {
    logWarn(`[Instructions] Failed to restore instruction files in "${folderPath}"`, error);
  }
}

async function readIfPresent(app: App, filePath: string): Promise<string | null> {
  const file = findCachedInstructionFile(app, filePath);
  return file ? await app.vault.read(file) : null;
}

async function restoreFile(app: App, filePath: string, previous: string | null): Promise<void> {
  const file = findCachedInstructionFile(app, filePath);
  if (previous === null) {
    if (file) await trashFile(app, file);
    return;
  }
  if (!file) {
    await ensureFile(app, filePath, previous);
    return;
  }
  if ((await app.vault.read(file)) !== previous) {
    await app.vault.modify(file, previous);
  }
}

export async function ensureAgentsFile(
  app: App,
  folderPath: string,
  initialContent: string
): Promise<TFile> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  const agentsFile = await ensureFile(app, agentsPath, initialContent);
  await convertLegacyGeneratedFile(app, agentsFile, initialContent);
  return agentsFile;
}

export async function ensureAgentsFileForDiscovery(app: App, folderPath: string): Promise<void> {
  try {
    const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
    const existing = findCachedInstructionFile(app, agentsPath);
    if (!existing) return;
    await ensureAgentsFile(app, folderPath, "");
  } catch (error) {
    logWarn(
      `[Instructions] Failed to ensure AGENTS.md for "${folderPath || "<vault root>"}"`,
      error
    );
  }
}

export async function openAgentsFile(app: App, folderPath: string): Promise<void> {
  const file = await ensureAgentsFile(app, folderPath, "");
  await app.workspace.getLeaf(true).openFile(file);
}

function childPath(folderPath: string, fileName: string): string {
  return normalizePath(folderPath ? `${folderPath}/${fileName}` : fileName);
}

export function findCachedInstructionFile(app: App, filePath: string): TFile | null {
  const cached = app.vault.getAbstractFileByPath(filePath);
  return cached instanceof TFile ? cached : findCasedSibling(app, filePath);
}

function findCasedSibling(app: App, filePath: string): TFile | null {
  if (!hasCaseInsensitiveFilesystem()) return null;
  const slash = filePath.lastIndexOf("/");
  const folderPath = slash === -1 ? "" : filePath.slice(0, slash);
  const name = (slash === -1 ? filePath : filePath.slice(slash + 1)).toLowerCase();
  const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : app.vault.getRoot();
  if (!(folder instanceof TFolder)) return null;
  return (
    folder.children.find(
      (child): child is TFile => child instanceof TFile && child.name.toLowerCase() === name
    ) ?? null
  );
}

async function ensureFile(app: App, filePath: string, content: string): Promise<TFile> {
  const existing = findCachedInstructionFile(app, filePath);
  if (existing) return existing;

  const folderPath = filePath.split("/").slice(0, -1).join("/");
  if (folderPath) await ensureFolderExists(app.vault, folderPath);
  return await app.vault.create(filePath, content);
}

async function convertLegacyGeneratedFile(
  app: App,
  file: TFile,
  initialContent: string
): Promise<void> {
  const content = await app.vault.read(file);
  const match = content.match(GENERATED_MIRROR_HEADER);
  if (!match) return;

  const nextContent = initialContent
    ? `${match[1]}${initialContent}`
    : `${match[1]}${content.slice(match[0].length)}`;
  await app.vault.modify(file, nextContent);
}
