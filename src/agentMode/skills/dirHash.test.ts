import { computeDirHash, type DirHashFs } from "./dirHash";

/**
 * Build an in-memory {@link DirHashFs} from a flat `{ absPath → file }` map.
 * Directory entries are inferred from the path hierarchy of the files.
 * Symlinks are encoded as files whose path is prefixed with `__link__:`.
 */
function makeFs(files: Record<string, string>, symlinks: ReadonlyArray<string> = []): DirHashFs {
  const fileMap = new Map<string, string>(Object.entries(files));
  const symlinkSet = new Set<string>(symlinks);
  const dirs = new Set<string>();
  for (const p of fileMap.keys()) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  for (const p of symlinkSet) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }

  return {
    async isDirectory(p) {
      // Symlinks are not directories from the fingerprint walker's POV
      // (we skip them anyway), and files aren't either.
      if (symlinkSet.has(p)) return false;
      return dirs.has(p);
    },
    async isSymlink(p) {
      return symlinkSet.has(p);
    },
    async list(p) {
      const prefix = `${p.replace(/\/+$/, "")}/`;
      const out = new Set<string>();
      for (const k of [...fileMap.keys(), ...symlinkSet, ...dirs]) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (rest.length === 0) continue;
        const first = rest.split("/")[0];
        out.add(first);
      }
      return Array.from(out);
    },
    async readFile(p) {
      const content = fileMap.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
  };
}

describe("computeDirHash", () => {
  it("returns the same hash for identical directory contents", async () => {
    const fsA = makeFs({
      "/a/SKILL.md": "---\nname: foo\n---\nbody",
      "/a/templates/note.md": "template",
    });
    const fsB = makeFs({
      "/b/SKILL.md": "---\nname: foo\n---\nbody",
      "/b/templates/note.md": "template",
    });
    const ha = await computeDirHash("/a", fsA);
    const hb = await computeDirHash("/b", fsB);
    expect(ha).toBe(hb);
  });

  it("returns different hashes when SKILL.md content differs", async () => {
    const fsA = makeFs({ "/a/SKILL.md": "body a" });
    const fsB = makeFs({ "/b/SKILL.md": "body b" });
    const ha = await computeDirHash("/a", fsA);
    const hb = await computeDirHash("/b", fsB);
    expect(ha).not.toBe(hb);
  });

  it("returns different hashes when supporting files differ", async () => {
    const fsA = makeFs({
      "/a/SKILL.md": "same",
      "/a/extra.md": "alpha",
    });
    const fsB = makeFs({
      "/b/SKILL.md": "same",
      "/b/extra.md": "beta",
    });
    expect(await computeDirHash("/a", fsA)).not.toBe(await computeDirHash("/b", fsB));
  });

  it("is invariant under list() ordering", async () => {
    const baseFs = makeFs({
      "/a/SKILL.md": "x",
      "/a/extra-1.md": "one",
      "/a/extra-2.md": "two",
    });
    // Reverse the listing for one walk; the hash must still match.
    const reverseFs: DirHashFs = {
      isDirectory: baseFs.isDirectory.bind(baseFs),
      isSymlink: baseFs.isSymlink.bind(baseFs),
      list: async (p) => (await baseFs.list(p)).slice().reverse(),
      readFile: baseFs.readFile.bind(baseFs),
    };
    expect(await computeDirHash("/a", baseFs)).toBe(await computeDirHash("/a", reverseFs));
  });

  it("ignores symlinks under the skill dir", async () => {
    const fsA = makeFs({ "/a/SKILL.md": "same" });
    const fsB = makeFs({ "/b/SKILL.md": "same" }, ["/b/dangling"]);
    expect(await computeDirHash("/a", fsA)).toBe(await computeDirHash("/b", fsB));
  });

  it("includes nested subdirectories in the hash", async () => {
    const fsA = makeFs({
      "/a/SKILL.md": "x",
      "/a/refs/note.md": "nested",
    });
    const fsB = makeFs({
      "/b/SKILL.md": "x",
      "/b/refs/note.md": "different",
    });
    expect(await computeDirHash("/a", fsA)).not.toBe(await computeDirHash("/b", fsB));
  });

  it("differentiates files with same content but different paths", async () => {
    const fsA = makeFs({
      "/a/SKILL.md": "same",
      "/a/foo.md": "extra",
    });
    const fsB = makeFs({
      "/b/SKILL.md": "same",
      "/b/bar.md": "extra",
    });
    expect(await computeDirHash("/a", fsA)).not.toBe(await computeDirHash("/b", fsB));
  });
});
