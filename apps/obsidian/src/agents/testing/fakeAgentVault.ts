import {
  getFrontMatterInfo,
  parseYaml,
  stringifyYaml,
  TFile,
  TFolder,
  type App,
  type EventRef,
  type TAbstractFile,
} from "obsidian";

type VaultEvent = "create" | "modify" | "delete" | "rename";
type Listener = (file: TAbstractFile, oldPath?: string) => void;

interface StoredFile {
  file: TFile;
  data: string | ArrayBuffer;
}

export interface FakeAgentVault {
  app: App;
  touchedPaths: string[];
  trashedPaths: string[];
  writeByHand(path: string, data: string | ArrayBuffer): void;
  deleteByHand(path: string): void;
  readText(path: string): string | undefined;
  readBytes(path: string): ArrayBuffer | undefined;
  listPaths(): string[];
}

export function createFakeAgentVault(): FakeAgentVault {
  const files = new Map<string, StoredFile>();
  const folders = new Map<string, TFolder>();
  const listeners = new Map<VaultEvent, Set<Listener>>();
  const touchedPaths: string[] = [];
  const trashedPaths: string[] = [];
  let mtime = 1;

  const touch = (path: string) => touchedPaths.push(path);
  const emit = (event: VaultEvent, file: TAbstractFile, oldPath?: string) =>
    listeners.get(event)?.forEach((listener) => listener(file, oldPath));
  const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
  const nameOf = (path: string) => path.split("/").pop() ?? "";
  const childrenOf = (path: string): TAbstractFile[] =>
    [...folders.values(), ...[...files.values()].map(({ file }) => file)].filter(
      (child) => child.path !== path && parentOf(child.path) === path
    );

  const ensureFolder = (path: string): void => {
    if (!path || folders.has(path)) return;
    ensureFolder(parentOf(path));
    const folder = Object.assign(new TFolder(), { path, name: nameOf(path) });
    Object.defineProperty(folder, "children", { get: () => childrenOf(path) });
    folders.set(path, folder);
    emit("create", folder);
  };

  const writeFile = (path: string, data: string | ArrayBuffer): TFile => {
    ensureFolder(parentOf(path));
    const existing = files.get(path);
    const file =
      existing?.file ??
      Object.assign(new TFile(), {
        path,
        name: nameOf(path),
        basename: nameOf(path).replace(/\.[^.]+$/, ""),
        extension: nameOf(path).split(".").pop() ?? "",
      });
    file.stat = { ctime: 0, mtime: mtime++, size: 0 };
    files.set(path, { file, data });
    emit(existing ? "modify" : "create", file);
    return file;
  };

  const removeTree = (path: string): void => {
    for (const filePath of [...files.keys()]) {
      if (filePath === path || filePath.startsWith(`${path}/`)) {
        const { file } = files.get(filePath)!;
        files.delete(filePath);
        emit("delete", file);
      }
    }
    for (const folderPath of [...folders.keys()].reverse()) {
      if (folderPath === path || folderPath.startsWith(`${path}/`)) {
        const folder = folders.get(folderPath)!;
        folders.delete(folderPath);
        emit("delete", folder);
      }
    }
  };

  const dataOf = (file: TFile) => {
    touch(file.path);
    const stored = files.get(file.path);
    if (!stored) throw new Error(`No file at ${file.path}`);
    return stored.data;
  };

  const vault = {
    getAbstractFileByPath(path: string): TAbstractFile | null {
      touch(path);
      return files.get(path)?.file ?? folders.get(path) ?? null;
    },
    async read(file: TFile): Promise<string> {
      return dataOf(file) as string;
    },
    async readBinary(file: TFile): Promise<ArrayBuffer> {
      return dataOf(file) as ArrayBuffer;
    },
    async create(path: string, text: string): Promise<TFile> {
      touch(path);
      if (files.has(path)) throw new Error("File already exists.");
      return writeFile(path, text);
    },
    async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
      touch(path);
      if (files.has(path)) throw new Error("File already exists.");
      return writeFile(path, data);
    },
    async modify(file: TFile, text: string): Promise<void> {
      touch(file.path);
      writeFile(file.path, text);
    },
    async process(file: TFile, change: (text: string) => string): Promise<string> {
      const text = change(dataOf(file) as string);
      writeFile(file.path, text);
      return text;
    },
    async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
      touch(file.path);
      writeFile(file.path, data);
    },
    getResourcePath(file: TFile): string {
      touch(file.path);
      return `app://vault/${file.path}?${file.stat.mtime}`;
    },
    on(event: VaultEvent, listener: Listener): EventRef {
      touch(`on:${event}`);
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return { event, listener };
    },
    offref(ref: EventRef): void {
      const { event, listener } = ref as unknown as { event: VaultEvent; listener: Listener };
      listeners.get(event)?.delete(listener);
    },
    adapter: {
      async mkdir(path: string): Promise<void> {
        touch(path);
        ensureFolder(path);
      },
    },
  };

  const fileManager = {
    async processFrontMatter(
      file: TFile,
      update: (frontmatter: Record<string, unknown>) => void
    ): Promise<void> {
      const content = dataOf(file) as string;
      const info = getFrontMatterInfo(content);
      const frontmatter: Record<string, unknown> =
        (info.exists ? (parseYaml(info.frontmatter) as Record<string, unknown> | null) : null) ??
        {};
      update(frontmatter);
      writeFile(
        file.path,
        `---\n${stringifyYaml(frontmatter)}---\n${content.slice(info.contentStart)}`
      );
    },
    async trashFile(file: TAbstractFile): Promise<void> {
      touch(file.path);
      trashedPaths.push(file.path);
      removeTree(file.path);
    },
  };

  return {
    app: { vault, fileManager } as unknown as App,
    touchedPaths,
    trashedPaths,
    writeByHand: writeFile,
    deleteByHand: removeTree,
    readText: (path) => files.get(path)?.data as string | undefined,
    readBytes: (path) => files.get(path)?.data as ArrayBuffer | undefined,
    listPaths: () => [...files.keys()].sort(),
  };
}
