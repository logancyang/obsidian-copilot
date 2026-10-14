import { logWarn } from "@/logger";
import { App, parseYaml, Platform, stringifyYaml, TAbstractFile, TFile, TFolder } from "obsidian";

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

function parentPath(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}

export async function readTextFile(app: App, path: string): Promise<string | null> {
  if (!(await app.vault.adapter.exists(path))) return null;
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? app.vault.read(file) : app.vault.adapter.read(path);
}

export async function writeTextFile(app: App, path: string, text: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await app.vault.modify(file, text);
    return;
  }
  const isNew = !(await app.vault.adapter.exists(path));
  if (isNew && app.vault.getAbstractFileByPath(parentPath(path)) instanceof TFolder) {
    await app.vault.create(path, text);
    return;
  }
  await app.vault.adapter.write(path, text);
}

export async function processTextFile(
  app: App,
  path: string,
  transform: (raw: string) => string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await app.vault.process(file, transform);
    return;
  }
  if (!(await app.vault.adapter.exists(path))) throw new Error(`File not found: ${path}`);
  await app.vault.adapter.write(path, transform(await app.vault.adapter.read(path)));
}

export async function renamePath(app: App, from: string, to: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(from);
  if (file) {
    await app.vault.rename(file, to);
  } else {
    await app.vault.adapter.rename(from, to);
  }
}

export async function trashPath(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file) {
    await trashFile(app, file);
    return;
  }
  if (!(await app.vault.adapter.exists(path))) return;
  if (!(await app.vault.adapter.trashSystem(path))) await app.vault.adapter.trashLocal(path);
}

export interface FrontmatterFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n(?:([\s\S]*?)\r?\n)??---(?:\r?\n|$)/;

function splitFrontmatter(raw: string): { block: string | null; body: string; bom: string } {
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = raw.slice(bom.length);
  const match = text.match(FRONTMATTER_PATTERN);
  return match
    ? { block: match[1] ?? "", body: text.slice(match[0].length), bom }
    : { block: null, body: text, bom };
}

function parseFrontmatterBlock(block: string | null): Record<string, unknown> {
  const data: unknown = block ? parseYaml(block) : null;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

function joinFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(frontmatter)}---\n${body}`;
}

export async function readFrontmatterFile(app: App, path: string): Promise<FrontmatterFile | null> {
  const raw = await readTextFile(app, path);
  if (raw === null) return null;
  const { block, body } = splitFrontmatter(raw);
  try {
    return { frontmatter: parseFrontmatterBlock(block), body };
  } catch (error) {
    logWarn(`Ignoring malformed frontmatter in ${path}`, error);
    return { frontmatter: {}, body };
  }
}

export async function updateFrontmatter(
  app: App,
  path: string,
  update: (frontmatter: Record<string, unknown>) => void,
  body?: string
): Promise<void> {
  await processTextFile(app, path, (raw) => {
    const split = splitFrontmatter(raw);
    const frontmatter = parseFrontmatterBlock(split.block);
    update(frontmatter);
    return split.bom + joinFrontmatter(frontmatter, body ?? split.body);
  });
}

export async function writeFrontmatterFile(
  app: App,
  path: string,
  frontmatter: Record<string, unknown>,
  body: string
): Promise<void> {
  await writeTextFile(app, path, joinFrontmatter(frontmatter, body));
}

// Adapter writes replace the whole file, so overlapping read-modify-write steps on one path must run one at a time or the later write restores stale text.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/700
const adapterWrites = new Map<string, Promise<void>>();

export function serializeAdapterWrite<T>(path: string, step: () => Promise<T>): Promise<T> {
  const result = (adapterWrites.get(path) ?? Promise.resolve()).then(step);
  const tail = result.then(
    () => {},
    () => {}
  );
  adapterWrites.set(path, tail);
  void tail.then(() => {
    if (adapterWrites.get(path) === tail) adapterWrites.delete(path);
  });
  return result;
}

export async function patchFrontmatter(
  app: App,
  filePath: string,
  updates: Record<string, string | number | null>
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(filePath);

  if (file instanceof TFile && app.fileManager?.processFrontMatter) {
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(updates)) {
        // A null update removes the key so a cleared flag such as an unpin leaves no stale value.
        // https://github.com/logancyang/obsidian-copilot/issues/3195
        if (value === null) delete frontmatter[key];
        else frontmatter[key] = value;
      }
    });
    return;
  }

  await serializeAdapterWrite(filePath, () => patchFrontmatterViaAdapter(app, filePath, updates));
}

async function patchFrontmatterViaAdapter(
  app: App,
  filePath: string,
  updates: Record<string, string | number | null>
): Promise<void> {
  if (!(await app.vault.adapter.exists(filePath))) return;

  const raw = await app.vault.adapter.read(filePath);
  const lineEnding = raw.includes("\r\n") ? "\r\n" : "\n";
  const updated = raw.replace(
    /^(\uFEFF?---\r?\n[\s\S]*?\r?\n)(---)/,
    (_match, yamlBlock: string, closing: string) => {
      let patched = yamlBlock;
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          patched = patched.replace(new RegExp(`^${key}:.*\\r?\\n`, "m"), "");
          continue;
        }
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
