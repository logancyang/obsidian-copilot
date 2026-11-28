import { joinPosix } from "@/utils/pathUtils";

export interface DirHashFs {
  isDirectory(absPath: string): Promise<boolean>;
  isSymlink(absPath: string): Promise<boolean>;
  list(absPath: string): Promise<string[]>;
  readFile(absPath: string): Promise<string>;
}

function fnv1aFold(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export async function computeDirHash(dirAbsPath: string, fs: DirHashFs): Promise<string> {
  const entries = await collectFiles(dirAbsPath, "", fs);
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (const entry of entries) {
    const chunk = `${entry.relPath}-${entry.content}`;
    h1 = fnv1aFold(chunk, h1);
    h2 = fnv1aFold(chunk, h2);
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

async function collectFiles(
  absPath: string,
  relPrefix: string,
  fs: DirHashFs
): Promise<Array<{ relPath: string; content: string }>> {
  let entries: string[];
  try {
    entries = await fs.list(absPath);
  } catch {
    return [];
  }

  const results: Array<{ relPath: string; content: string }> = [];
  for (const name of entries) {
    const childAbs = joinPosix(absPath, name);
    const childRel = relPrefix.length === 0 ? name : joinPosix(relPrefix, name);

    let isLink = false;
    try {
      isLink = await fs.isSymlink(childAbs);
    } catch {
      continue;
    }
    if (isLink) continue;

    let isDir = false;
    try {
      isDir = await fs.isDirectory(childAbs);
    } catch {
      isDir = false;
    }

    if (isDir) {
      const subResults = await collectFiles(childAbs, childRel, fs);
      results.push(...subResults);
      continue;
    }

    let content: string;
    try {
      content = await fs.readFile(childAbs);
    } catch {
      content = "unreadable";
    }
    results.push({ relPath: childRel, content });
  }
  return results;
}
