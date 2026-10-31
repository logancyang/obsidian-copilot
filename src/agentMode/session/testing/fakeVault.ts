import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";
import { FileSystemAdapter, type App, type TAbstractFile } from "obsidian";

type VaultEventName = "create" | "rename" | "delete";
type VaultListener = (file: TAbstractFile, oldPath?: string) => void;

function vaultEntry(path: string, isFolder: boolean): TAbstractFile {
  const name = path.split("/").pop() ?? path;
  if (isFolder) return mockTFolder({ path, name });
  const dot = name.lastIndexOf(".");
  return mockTFile({ path, name, extension: dot === -1 ? "" : name.slice(dot + 1) });
}

export function makeFakeVault(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const listeners = new Map<VaultEventName, Set<VaultListener>>();
  const adapter = new FileSystemAdapter();
  adapter.read = jest.fn((p: string) => {
    const content = files.get(p);
    return content === undefined
      ? Promise.reject(new Error(`ENOENT: ${p}`))
      : Promise.resolve(content);
  });
  const fire = (name: VaultEventName, file: TAbstractFile, oldPath?: string) => {
    for (const listener of listeners.get(name) ?? []) listener(file, oldPath);
  };
  const vault = {
    adapter,
    on: jest.fn((name: VaultEventName, listener: VaultListener) => {
      const named = listeners.get(name) ?? new Set();
      named.add(listener);
      listeners.set(name, named);
      return { name, listener };
    }),
    offref: jest.fn((ref: { name: VaultEventName; listener: VaultListener }) => {
      listeners.get(ref.name)?.delete(ref.listener);
    }),
  };
  return {
    files,
    adapter,
    app: { vault } as unknown as App,
    listenerCount: () => [...listeners.values()].reduce((sum, named) => sum + named.size, 0),
    create(path: string, content: string) {
      files.set(path, content);
      fire("create", vaultEntry(path, false));
    },
    delete(path: string) {
      files.delete(path);
      fire("delete", vaultEntry(path, false));
    },
    renameFile(oldPath: string, newPath: string) {
      files.set(newPath, files.get(oldPath) ?? "");
      files.delete(oldPath);
      fire("rename", vaultEntry(newPath, false), oldPath);
    },
    renameFolder(oldPath: string, newPath: string) {
      const moved = [...files.keys()].filter((path) => path.startsWith(`${oldPath}/`));
      for (const path of moved) {
        files.set(newPath + path.slice(oldPath.length), files.get(path) ?? "");
        files.delete(path);
      }
      fire("rename", vaultEntry(newPath, true), oldPath);
      for (const path of moved) {
        fire("rename", vaultEntry(newPath + path.slice(oldPath.length), false), path);
      }
    },
    shellMove(oldPath: string, newPath: string) {
      files.set(newPath, files.get(oldPath) ?? "");
      files.delete(oldPath);
      fire("create", vaultEntry(newPath, false));
      fire("delete", vaultEntry(oldPath, false));
    },
  };
}
