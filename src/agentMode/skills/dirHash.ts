import { joinPosix } from "@/utils/pathUtils";

/**
 * Minimal FS surface for {@link computeDirHash}. Modeled as a leaf
 * adapter so tests can supply an in-memory FS without touching disk.
 *
 * Paths are absolute throughout. Symlinks are listed by `list` like any
 * other entry; the caller distinguishes via {@link DirHashFs.isSymlink}.
 */
export interface DirHashFs {
  /** Whether the path is a directory (real or junction, follows symlinks). */
  isDirectory(absPath: string): Promise<boolean>;
  /** Whether the path itself is a symlink/junction (does not follow). */
  isSymlink(absPath: string): Promise<boolean>;
  /** List immediate entry names (files + dirs + symlinks) under `absPath`. */
  list(absPath: string): Promise<string[]>;
  /** Read a UTF-8 file at the given absolute path. */
  readFile(absPath: string): Promise<string>;
}

/**
 * One FNV-1a fold of `value` continued from `seed`. Returns the raw 32-bit
 * state (unsigned) so callers can keep folding across chunks. Passing the
 * prior chunk's result as the next `seed` makes the whole stream order- and
 * content-sensitive.
 */
function fnv1aFold(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Compute a recursive POSIX-stable content hash of a skill directory.
 *
 * The hash covers every regular file under `dirAbsPath`: filename
 * (relative POSIX path from the root) + content. Entries are visited in
 * a sort-stable order so two physically distinct directories with the
 * same files end up with the same hash regardless of FS list order.
 *
 * Symlinks are ignored (we never want to follow them when fingerprinting
 * a real skill directory — they would either escape to canonical or
 * loop). Subdirectories that are themselves symlinks are skipped too.
 *
 * Pure function over an injected FS adapter. Returns a 16-hex-char string.
 */
export async function computeDirHash(dirAbsPath: string, fs: DirHashFs): Promise<string> {
  const entries = await collectFiles(dirAbsPath, "", fs);
  // Sort by relative POSIX path to make the hash deterministic.
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

  // Fold two independent FNV-1a streams (distinct seeds) across the
  // entries, continuing each stream's state as the next seed. Every field
  // is framed with NUL (\u0000, impossible inside a filename) and a record
  // separator (\u001e) so distinct (relPath, content) sets can never
  // serialize to the same byte stream. Two 32-bit streams give a ~64-bit
  // digest, keeping the collision probability negligible for the
  // destructive same-name/same-hash merge in mergeDiscovery.
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (const entry of entries) {
    const chunk = `${entry.relPath}-${entry.content}`;
    h1 = fnv1aFold(chunk, h1);
    h2 = fnv1aFold(chunk, h2);
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Walk `absPath` recursively, returning every regular file as
 * `{ relPath, content }`. `relPath` is POSIX-joined from the original
 * root, so the result is invariant under absolute-path changes.
 */
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

    // Skip symlinks at any depth — we never follow them while hashing.
    let isLink = false;
    try {
      isLink = await fs.isSymlink(childAbs);
    } catch {
      // Treat unreadable lstat as "skip" — safer than guessing.
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
      // Unreadable file — record presence so the hash still differs
      // from a directory without that file. Use a sentinel marker.
      content = "unreadable";
    }
    results.push({ relPath: childRel, content });
  }
  return results;
}
