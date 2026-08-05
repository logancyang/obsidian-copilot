import { logWarn } from "@/logger";
import { isInVaultCache, resolveFileByPath, trashFile } from "@/utils/vaultAdapterUtils";
import { App, normalizePath, TFile, TFolder } from "obsidian";

export const AGENTS_FILE_NAME = "AGENTS.md";
export const CLAUDE_FILE_NAME = "CLAUDE.md";
const CLAUDE_AGENTS_REFERENCE = "@AGENTS.md";

/**
 * Matches a line whose only content is a Claude import of the sibling AGENTS.md, in the
 * spellings Claude actually resolves (`@AGENTS.md` / `@./AGENTS.md`). Detection is
 * deliberately loose: a false positive skips a redundant append, while a false negative
 * appends a duplicate import to a file the user owns on EVERY open.
 */
const CLAUDE_REFERENCE_PATTERN = /^[ \t>-]*@\.?\/?AGENTS\.md[ \t]*$/im;

/**
 * Whether a CLAUDE.md body is purely the `@AGENTS.md` wiring Copilot writes — import lines
 * and blank lines, nothing the user authored. UI surfaces use this to hide the wiring file
 * while still listing a CLAUDE.md that carries the user's own rules, and it reuses the same
 * line pattern as the append guard above so the two can never disagree about what counts as
 * an import.
 *
 * @param content - The full CLAUDE.md file body
 */
export function isClaudeImportOnly(content: string): boolean {
  return content
    .split(/\r?\n/)
    .every((line) => line.trim().length === 0 || CLAUDE_REFERENCE_PATTERN.test(line));
}

/**
 * Header an older build stamped on the project AGENTS.md files it generated from `project.md`.
 * Its presence is what tells a Copilot-owned mirror apart from a file the user wrote.
 */
const GENERATED_MIRROR_HEADER =
  /^(\uFEFF?)<!-- copilot:generated-agents-mirror [^\r\n]* -->\r?\n\r?\n/;

/**
 * Whether this folder's AGENTS.md is still Copilot's to initialize: either absent, or the
 * marker-owned mirror an older build generated from `project.md`.
 *
 * Callers with legacy text to place need this because "the file exists" is not the same as
 * "the user owns it". A generated mirror is content {@link ensureAgentsFile} will replace, so
 * treating it as user-authored strands the legacy text and leaves the mirror to be blanked by
 * a later ensure that has nothing to put in it.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 */
export async function agentsFileIsUninitialized(app: App, folderPath: string): Promise<boolean> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  const file = await resolveFileByPath(app, agentsPath);
  if (!file) return true;
  const content = isInVaultCache(app, agentsPath)
    ? await app.vault.read(file)
    : await app.vault.adapter.read(agentsPath);
  return GENERATED_MIRROR_HEADER.test(content);
}

/**
 * Delete the instruction wiring Copilot itself generated in `folderPath`: a marker-owned
 * AGENTS.md mirror and an import-only CLAUDE.md. Files carrying anything the user wrote are
 * left untouched.
 *
 * Project deletion needs this: leaving a stale mirror behind keeps the folder non-empty, and
 * a same-named project created later would convert that mirror at session start and inherit
 * the dead project's instructions. Never throws — deletion cleanup is best-effort.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 */
export async function removeGeneratedInstructionFiles(app: App, folderPath: string): Promise<void> {
  const targets: Array<{ name: string; isGenerated: (content: string) => boolean }> = [
    { name: AGENTS_FILE_NAME, isGenerated: (content) => GENERATED_MIRROR_HEADER.test(content) },
    { name: CLAUDE_FILE_NAME, isGenerated: isClaudeImportOnly },
  ];
  for (const { name, isGenerated } of targets) {
    try {
      const filePath = childPath(folderPath, name);
      const file = await resolveFileByPath(app, filePath);
      if (!file) continue;
      const inCache = isInVaultCache(app, filePath);
      const content = inCache ? await app.vault.read(file) : await app.vault.adapter.read(filePath);
      if (!isGenerated(content)) continue;
      if (inCache) {
        await trashFile(app, file);
      } else {
        await app.vault.adapter.remove(filePath);
      }
    } catch (error) {
      logWarn(`[Instructions] Failed to remove generated ${name} in "${folderPath}"`, error);
    }
  }
}

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
 * Session-start counterpart to {@link ensureAgentsFile}: make a scope's instructions
 * discoverable by the backends WITHOUT conjuring files out of nothing.
 *
 * Backends read instructions from the session cwd (codex/opencode natively, Claude through
 * the sibling CLAUDE.md import), so a scope whose instructions still live only in the legacy
 * `project.md` body — every project that predates this file layout — would silently send no
 * instructions at all until the user happened to click the popover's AGENTS.md row. This runs
 * that same initialization at session start instead.
 *
 * The "don't create from nothing" rule keeps it quiet: a scope with no AGENTS.md and no legacy
 * body to migrate gets no files, so a brand-new project folder stays clean.
 *
 * Never throws — instructions are best-effort and must not block session creation.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 * @param initialContent - Legacy body to migrate; blank means "nothing to preserve"
 */
export async function ensureAgentsFileForDiscovery(
  app: App,
  folderPath: string,
  initialContent: string
): Promise<void> {
  try {
    const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
    const existing = await resolveFileByPath(app, agentsPath);
    if (!existing && !initialContent.trim()) return;
    await ensureAgentsFile(app, folderPath, initialContent);
  } catch (error) {
    logWarn(
      `[Instructions] Failed to ensure AGENTS.md for "${folderPath || "<vault root>"}"`,
      error
    );
  }
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
  // A file under a dot-folder is never in the vault cache, so `resolveFileByPath` hands back
  // a synthetic TFile that Obsidian's editor cannot open. Report the real path instead of
  // opening an empty leaf.
  if (!isInVaultCache(app, file.path)) {
    throw new Error(`${file.path} is in a hidden folder Obsidian cannot open. Edit it externally.`);
  }
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
  if (CLAUDE_REFERENCE_PATTERN.test(content)) return;

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
  const match = content.match(GENERATED_MIRROR_HEADER);
  if (!match) return;

  // Keep the mirror's own body when the caller brought nothing to put in its place. The
  // mirror is generated content, but under it sits the only copy of instructions a project
  // whose `project.md` body was already consumed still has; replacing it with "" deletes them.
  const nextContent = initialContent
    ? `${match[1]}${initialContent}`
    : `${match[1]}${content.slice(match[0].length)}`;
  if (isInVaultCache(app, agentsPath)) {
    await app.vault.modify(file, nextContent);
  } else {
    await app.vault.adapter.write(agentsPath, nextContent);
  }
}
