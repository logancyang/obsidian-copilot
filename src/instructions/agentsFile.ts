import { isInVaultCache, resolveFileByPath } from "@/utils/vaultAdapterUtils";
import { App, normalizePath, TFile, TFolder } from "obsidian";

export const AGENTS_FILE_NAME = "AGENTS.md";
export const CLAUDE_FILE_NAME = "CLAUDE.md";
const CLAUDE_AGENTS_REFERENCE = "@AGENTS.md";

/**
 * Ensure a folder has an editable AGENTS.md and a Claude import for it.
 *
 * User-authored files are preserved. A legacy Copilot-generated mirror is converted back to
 * `initialContent`; otherwise that content is used only when AGENTS.md is absent.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 * @param initialContent - Missing-file content and legacy generated-mirror replacement
 */
export async function ensureAgentsFile(
  app: App,
  folderPath: string,
  initialContent: string
): Promise<TFile> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  const agentsFile = await ensureFile(app, agentsPath, initialContent);
  await convertLegacyGeneratedFile(app, agentsPath, agentsFile, initialContent);
  await ensureClaudeReference(app, childPath(folderPath, CLAUDE_FILE_NAME));
  return agentsFile;
}

/**
 * Open a folder's canonical instruction file in Obsidian, creating it if needed.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 * @param initialContent - Missing-file content and legacy generated-mirror replacement
 * @param newLeaf - Whether Obsidian should open the file in a new leaf
 */
export async function openAgentsFile(
  app: App,
  folderPath: string,
  initialContent: string,
  newLeaf: boolean
): Promise<void> {
  const file = await ensureAgentsFile(app, folderPath, initialContent);
  await app.workspace.getLeaf(newLeaf).openFile(file);
}

function childPath(folderPath: string, fileName: string): string {
  return normalizePath(folderPath ? `${folderPath}/${fileName}` : fileName);
}

async function ensureFile(app: App, filePath: string, content: string): Promise<TFile> {
  const existing = await resolveFileByPath(app, filePath);
  if (existing) return existing;

  const folderPath = normalizePath(filePath.split("/").slice(0, -1).join("/"));
  const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : null;
  if (!folderPath || folder instanceof TFolder) {
    return await app.vault.create(filePath, content);
  }

  await app.vault.adapter.write(filePath, content);
  const created = await resolveFileByPath(app, filePath);
  if (!created) throw new Error(`Failed to create ${filePath}`);
  return created;
}

async function ensureClaudeReference(app: App, claudePath: string): Promise<void> {
  const file = await resolveFileByPath(app, claudePath);
  if (!file) {
    await ensureFile(app, claudePath, `${CLAUDE_AGENTS_REFERENCE}\n`);
    return;
  }

  const content = isInVaultCache(app, claudePath)
    ? await app.vault.read(file)
    : await app.vault.adapter.read(claudePath);
  if (/^@AGENTS\.md\s*$/m.test(content)) return;

  const separator = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  const nextContent = `${content}${separator}${CLAUDE_AGENTS_REFERENCE}\n`;
  if (isInVaultCache(app, claudePath)) {
    await app.vault.modify(file, nextContent);
  } else {
    await app.vault.adapter.write(claudePath, nextContent);
  }
}

async function convertLegacyGeneratedFile(
  app: App,
  agentsPath: string,
  file: TFile,
  initialContent: string
): Promise<void> {
  const content = isInVaultCache(app, agentsPath)
    ? await app.vault.read(file)
    : await app.vault.adapter.read(agentsPath);
  const match = content.match(
    /^(\uFEFF?)<!-- copilot:generated-agents-mirror [^\r\n]* -->\r?\n\r?\n/
  );
  if (!match) return;

  const nextContent = `${match[1]}${initialContent}`;
  if (isInVaultCache(app, agentsPath)) {
    await app.vault.modify(file, nextContent);
  } else {
    await app.vault.adapter.write(agentsPath, nextContent);
  }
}
