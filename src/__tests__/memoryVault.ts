import type { App } from "obsidian";

/**
 * In-memory vault for a hidden Copilot folder. Like Obsidian, it does not index dot-folders:
 * `getAbstractFileByPath` returns null and only the adapter works.
 * https://github.com/logancyang/obsidian-copilot/issues/3075
 */
export function createMemoryVault(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const trashed: string[] = [];
  const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));
  const adapter = {
    exists: async (path: string) =>
      files.has(path) || [...files.keys()].some((p) => p.startsWith(`${path}/`)),
    read: async (path: string) => files.get(path) ?? "",
    write: async (path: string, text: string) => void files.set(path, text),
    rename: async (from: string, to: string) => {
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
    stat: async () => ({ ctime: 1, mtime: 1, size: 0 }),
    list: async (folder: string) => ({
      files: [...files.keys()].filter((p) => parentOf(p) === folder),
      folders: [],
    }),
    mkdir: async () => {},
    trashSystem: async (path: string) => {
      trashed.push(path);
      files.delete(path);
      return true;
    },
  };
  const vault = { getAbstractFileByPath: () => null, adapter };
  return { app: { vault } as unknown as App, files, trashed };
}
