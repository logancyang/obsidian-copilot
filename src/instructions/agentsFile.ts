import { logWarn } from "@/logger";
import {
  hasCaseInsensitiveFilesystem,
  isInVaultCache,
  resolveFileByPath,
  trashFile,
} from "@/utils/vaultAdapterUtils";
import { App, normalizePath, TFile, TFolder } from "obsidian";

export const AGENTS_FILE_NAME = "AGENTS.md";
export const CLAUDE_FILE_NAME = "CLAUDE.md";
const CLAUDE_AGENTS_REFERENCE = "@AGENTS.md";

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
  const file = await resolveInstructionFile(app, agentsPath);
  if (!file) return true;
  return GENERATED_MIRROR_HEADER.test(await readFileContent(app, file));
}

export async function readAgentsFile(app: App, folderPath: string): Promise<string> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  const file = await resolveInstructionFile(app, agentsPath);
  if (!file) return "";
  const content = await readFileContent(app, file);
  return content.replace(GENERATED_MIRROR_HEADER, "$1");
}

export async function writeAgentsFile(
  app: App,
  folderPath: string,
  content: string
): Promise<void> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  if (!(await resolveInstructionFile(app, agentsPath)) && !content.trim()) return;
  const file = await ensureAgentsFile(app, folderPath, content);
  if ((await readFileContent(app, file)) === content) return;
  await writeFileContent(app, file, content);
}

export async function removeGeneratedInstructionFiles(app: App, folderPath: string): Promise<void> {
  try {
    const file = await resolveInstructionFile(app, childPath(folderPath, AGENTS_FILE_NAME));
    if (!file) return;
    if (!GENERATED_MIRROR_HEADER.test(await readFileContent(app, file))) return;
    await deleteInstructionFile(app, file);
  } catch (error) {
    logWarn(
      `[Instructions] Failed to remove the generated ${AGENTS_FILE_NAME} in "${folderPath}"`,
      error
    );
  }
}

export interface InstructionFilesSnapshot {
  agents: string | null;
  claude: string | null;
}

export async function captureInstructionFiles(
  app: App,
  folderPath: string
): Promise<InstructionFilesSnapshot> {
  return {
    agents: await readIfPresent(app, childPath(folderPath, AGENTS_FILE_NAME)),
    claude: await readIfPresent(app, childPath(folderPath, CLAUDE_FILE_NAME)),
  };
}

export async function restoreInstructionFiles(
  app: App,
  folderPath: string,
  snapshot: InstructionFilesSnapshot
): Promise<void> {
  try {
    await restoreFile(app, childPath(folderPath, AGENTS_FILE_NAME), snapshot.agents);
    await restoreFile(app, childPath(folderPath, CLAUDE_FILE_NAME), snapshot.claude);
  } catch (error) {
    logWarn(`[Instructions] Failed to restore instruction files in "${folderPath}"`, error);
  }
}

async function readIfPresent(app: App, filePath: string): Promise<string | null> {
  const file = await resolveInstructionFile(app, filePath);
  return file ? await readFileContent(app, file) : null;
}

async function restoreFile(app: App, filePath: string, previous: string | null): Promise<void> {
  const file = await resolveInstructionFile(app, filePath);
  if (previous === null) {
    if (file) await deleteInstructionFile(app, file);
    return;
  }
  if (!file) {
    await ensureFile(app, filePath, previous);
    return;
  }
  if ((await readFileContent(app, file)) !== previous) {
    await writeFileContent(app, file, previous);
  }
}

async function deleteInstructionFile(app: App, file: TFile): Promise<void> {
  if (isInVaultCache(app, file.path)) {
    await trashFile(app, file);
  } else {
    await app.vault.adapter.remove(file.path);
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
  await ensureClaudeReference(app, childPath(folderPath, CLAUDE_FILE_NAME));
  return agentsFile;
}

export async function ensureAgentsFileForDiscovery(
  app: App,
  folderPath: string,
  initialContent: string
): Promise<void> {
  try {
    const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
    const existing = await resolveInstructionFile(app, agentsPath);
    if (!existing && !initialContent.trim()) return;
    await ensureAgentsFile(app, folderPath, initialContent);
  } catch (error) {
    logWarn(
      `[Instructions] Failed to ensure AGENTS.md for "${folderPath || "<vault root>"}"`,
      error
    );
  }
}

export async function openAgentsFile(
  app: App,
  folderPath: string,
  initialContent: string,
  newLeaf: boolean
): Promise<void> {
  const file = await ensureAgentsFile(app, folderPath, initialContent);
  if (!isInVaultCache(app, file.path)) {
    throw new Error(`${file.path} is in a hidden folder Obsidian cannot open. Edit it externally.`);
  }
  await app.workspace.getLeaf(newLeaf).openFile(file);
}

function childPath(folderPath: string, fileName: string): string {
  return normalizePath(folderPath ? `${folderPath}/${fileName}` : fileName);
}

async function resolveInstructionFile(app: App, filePath: string): Promise<TFile | null> {
  const cached = app.vault.getAbstractFileByPath(filePath);
  if (cached instanceof TFile) return cached;

  const resolved = await resolveFileByPath(app, filePath);
  if (!resolved) return null;

  return findCasedSibling(app, filePath) ?? resolved;
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

async function readFileContent(app: App, file: TFile): Promise<string> {
  return isInVaultCache(app, file.path)
    ? await app.vault.read(file)
    : await app.vault.adapter.read(file.path);
}

async function writeFileContent(app: App, file: TFile, content: string): Promise<void> {
  if (isInVaultCache(app, file.path)) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.adapter.write(file.path, content);
  }
}

async function ensureFile(app: App, filePath: string, content: string): Promise<TFile> {
  const existing = await resolveInstructionFile(app, filePath);
  if (existing) return existing;

  const folderPath = normalizePath(filePath.split("/").slice(0, -1).join("/"));
  const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : null;
  if (!folderPath || folder instanceof TFolder) {
    return await app.vault.create(filePath, content);
  }

  await app.vault.adapter.write(filePath, content);
  const created = await resolveInstructionFile(app, filePath);
  if (!created) throw new Error(`Failed to create ${filePath}`);
  return created;
}

async function ensureClaudeReference(app: App, claudePath: string): Promise<void> {
  const file = await resolveInstructionFile(app, claudePath);
  if (!file) {
    await ensureFile(app, claudePath, `${CLAUDE_AGENTS_REFERENCE}\n`);
    return;
  }

  const content = await readFileContent(app, file);
  if (CLAUDE_REFERENCE_PATTERN.test(content)) return;

  const separator = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  await writeFileContent(app, file, `${content}${separator}${CLAUDE_AGENTS_REFERENCE}\n`);
}

async function convertLegacyGeneratedFile(
  app: App,
  file: TFile,
  initialContent: string
): Promise<void> {
  const content = await readFileContent(app, file);
  const match = content.match(GENERATED_MIRROR_HEADER);
  if (!match) return;

  const nextContent = initialContent
    ? `${match[1]}${initialContent}`
    : `${match[1]}${content.slice(match[0].length)}`;
  await writeFileContent(app, file, nextContent);
}
