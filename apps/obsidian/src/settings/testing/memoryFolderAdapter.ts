import type { DataAdapter, ListedFiles, Stat } from "obsidian";

type EntryType = "file" | "folder";

function parentOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export class MemoryFolderAdapter implements Pick<
  DataAdapter,
  "exists" | "stat" | "list" | "rename" | "mkdir"
> {
  readonly entries = new Map<string, EntryType>();

  constructor(files: Record<string, string> = {}) {
    for (const path of Object.keys(files)) {
      this.addFolder(parentOf(path));
      this.entries.set(path, "file");
    }
  }

  get files(): string[] {
    return [...this.entries].filter(([, type]) => type === "file").map(([path]) => path);
  }

  addFolder(path: string): void {
    for (let current = path; current; current = parentOf(current)) {
      this.entries.set(current, "folder");
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.entries.has(path);
  }

  async stat(path: string): Promise<Stat | null> {
    const type = this.entries.get(path);
    return type ? { type, ctime: 0, mtime: 0, size: 0 } : null;
  }

  async list(path: string): Promise<ListedFiles> {
    const children = [...this.entries].filter(([child]) => parentOf(child) === path);
    return {
      files: children.filter(([, type]) => type === "file").map(([child]) => child),
      folders: children.filter(([, type]) => type === "folder").map(([child]) => child),
    };
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.entries.has(to)) throw new Error(`Destination exists: ${to}`);
    if (parentOf(to) && !this.entries.has(parentOf(to))) {
      throw new Error(`Missing parent: ${parentOf(to)}`);
    }
    for (const [path, type] of [...this.entries]) {
      if (path !== from && !path.startsWith(`${from}/`)) continue;
      this.entries.delete(path);
      this.entries.set(`${to}${path.slice(from.length)}`, type);
    }
  }

  async mkdir(path: string): Promise<void> {
    if (parentOf(path) && !this.entries.has(parentOf(path))) {
      throw new Error(`Missing parent: ${parentOf(path)}`);
    }
    this.entries.set(path, "folder");
  }
}
