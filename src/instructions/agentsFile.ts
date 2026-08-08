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
  const file = await resolveInstructionFile(app, agentsPath);
  if (!file) return true;
  return GENERATED_MIRROR_HEADER.test(await readFileContent(app, file));
}

/**
 * Read a folder's instruction text for editing, or an empty string when the folder has no
 * AGENTS.md.
 *
 * A legacy generated mirror's marker line is stripped, so an editor shows the instructions
 * themselves rather than Copilot's bookkeeping comment. Saving that text back through
 * {@link writeAgentsFile} then leaves an ordinary user-owned file with no marker.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 */
export async function readAgentsFile(app: App, folderPath: string): Promise<string> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  const file = await resolveInstructionFile(app, agentsPath);
  if (!file) return "";
  const content = await readFileContent(app, file);
  return content.replace(GENERATED_MIRROR_HEADER, "$1");
}

/**
 * Save edited instruction text as the folder's AGENTS.md, creating the file and its Claude
 * import when the folder has none yet.
 *
 * Blank text for a folder with no AGENTS.md writes nothing, so opening an instructions editor
 * and closing it without typing leaves the vault exactly as it was — the same "never conjure
 * a file out of nothing" rule {@link ensureAgentsFileForDiscovery} follows.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 * @param content - The text to become the whole file body
 */
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

/**
 * Delete the marker-owned AGENTS.md mirror an older build generated in `folderPath`.
 *
 * Project deletion needs this: leaving a stale mirror behind keeps the folder non-empty, and
 * a same-named project created later would convert that mirror at session start and inherit
 * the dead project's instructions. Never throws — deletion cleanup is best-effort.
 *
 * The sibling CLAUDE.md is deliberately left alone. It carries no ownership marker, so an
 * import-only body is indistinguishable from one a user wrote to share their AGENTS rules with
 * Claude — and a stale import holds no instructions, so keeping it costs nothing while deleting
 * it destroys a file we cannot prove is ours.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 */
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

/** A folder's instruction files as they stood, `null` for one that did not exist. */
export interface InstructionFilesSnapshot {
  agents: string | null;
  claude: string | null;
}

/**
 * Record a folder's instruction files so a failed edit can put them back.
 *
 * Contents alone cannot express this. A file that does not exist and one the user emptied both
 * read as `""`, and restoring the wrong one is not a cosmetic error: writing `""` where there
 * was no file leaves a blank, markerless AGENTS.md that {@link agentsFileIsUninitialized} then
 * reports as user-owned, permanently blocking the legacy `project.md` move for that project.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 */
export async function captureInstructionFiles(
  app: App,
  folderPath: string
): Promise<InstructionFilesSnapshot> {
  return {
    agents: await readIfPresent(app, childPath(folderPath, AGENTS_FILE_NAME)),
    claude: await readIfPresent(app, childPath(folderPath, CLAUDE_FILE_NAME)),
  };
}

/**
 * Put a folder's instruction files back as {@link captureInstructionFiles} found them, removing
 * any the edit created. Never throws — a failed rollback must not replace the error that
 * triggered it.
 *
 * @param app - Obsidian app that owns the target vault
 * @param folderPath - Vault-relative folder, or an empty string for the vault root
 * @param snapshot - What {@link captureInstructionFiles} recorded before the edit
 */
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

/** Trash a cached file, but hard-remove one under a dot-folder the vault never indexed. */
async function deleteInstructionFile(app: App, file: TFile): Promise<void> {
  if (isInVaultCache(app, file.path)) {
    await trashFile(app, file);
  } else {
    await app.vault.adapter.remove(file.path);
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
  await convertLegacyGeneratedFile(app, agentsFile, initialContent);
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
  // A file under a dot-folder is never in the vault cache, so `resolveInstructionFile` hands
  // back a synthetic TFile that Obsidian's editor cannot open. Report the real path instead of
  // opening an empty leaf. A cased-differently note is not this case — the resolver returns the
  // cached file for those, so they open normally.
  if (!isInVaultCache(app, file.path)) {
    throw new Error(`${file.path} is in a hidden folder Obsidian cannot open. Edit it externally.`);
  }
  await app.workspace.getLeaf(newLeaf).openFile(file);
}

function childPath(folderPath: string, fileName: string): string {
  return normalizePath(folderPath ? `${folderPath}/${fileName}` : fileName);
}

/**
 * Resolve one of this module's canonical instruction paths to the file that actually backs it.
 *
 * `resolveFileByPath` matches the vault cache exactly and otherwise falls back to a synthetic
 * adapter file for anything merely present on disk. On a case-insensitive volume a vault
 * holding `agents.md` takes that fallback for `AGENTS.md`, and every cache check downstream
 * then treats an ordinary note as an unreachable hidden-folder file: reads and writes bypass
 * Obsidian's own file state, and Open reports a folder error for a note it could have opened.
 * Matching the cache case-insensitively first lets the real file win.
 *
 * Gated on the platform, because the fold is only ever a repair. Where two spellings really are
 * two files, adopting `agents.md` as the canonical file would be a corruption: the exact-name
 * file the backends discover would never get created, and instructions edited through Copilot
 * would land somewhere no agent reads.
 *
 * The variant lookup is last on purpose: the overwhelmingly common call is a scope that has no
 * instruction file at all — session start asks on every new session — and letting
 * `resolveFileByPath` answer first turns that into a single `exists` check.
 */
async function resolveInstructionFile(app: App, filePath: string): Promise<TFile | null> {
  const cached = app.vault.getAbstractFileByPath(filePath);
  if (cached instanceof TFile) return cached;

  const resolved = await resolveFileByPath(app, filePath);
  // Nothing on disk under this name. On a case-insensitive volume `exists` already answered
  // for every spelling of it, so there is no variant left to look for.
  if (!resolved) return null;

  // Something exists that the cache missed under this exact spelling: either a dot-folder file
  // Obsidian never indexes (keep the synthetic one) or the same note under another casing.
  return findCasedSibling(app, filePath) ?? resolved;
}

/**
 * The vault-cached instruction file at `filePath`, matching the way the resolver above does so
 * that a differently-cased file is the same file to every caller.
 *
 * Cache-only and synchronous, for callers that fingerprint a file rather than read it. A miss
 * here means "not indexed", which is not the same as "absent" — a file under a dot-folder is
 * always a miss.
 */
export function findCachedInstructionFile(app: App, filePath: string): TFile | null {
  const cached = app.vault.getAbstractFileByPath(filePath);
  return cached instanceof TFile ? cached : findCasedSibling(app, filePath);
}

/**
 * A sibling of `filePath` whose name differs only in case, on a volume where that means the
 * same file. Scoped to the containing folder rather than the whole vault: these paths are built
 * from a folder Obsidian itself cased, so only the file name can disagree.
 */
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

/**
 * A file under a dot-folder is never in the vault cache, so these two route through the
 * adapter for those and through the vault for everything else. Reading or writing a cached
 * file via the adapter would bypass Obsidian's own file state and strand open editors. Both
 * key on the resolved file's own path, which is the casing on disk rather than the canonical
 * spelling the caller asked for.
 */
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

  // Keep the mirror's own body when the caller brought nothing to put in its place. The
  // mirror is generated content, but under it sits the only copy of instructions a project
  // whose `project.md` body was already consumed still has; replacing it with "" deletes them.
  const nextContent = initialContent
    ? `${match[1]}${initialContent}`
    : `${match[1]}${content.slice(match[0].length)}`;
  await writeFileContent(app, file, nextContent);
}
