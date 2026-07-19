import type { App } from "obsidian";

import { MIYO_SEARCH_SKILL } from "./builtinSkills";
import { installMiyoSearchSkill, removeMiyoSearchSkill } from "./miyoSearchSeed";

jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn() }));

const FOLDER = "copilot/skills";
const SKILL_DIR = `${FOLDER}/${MIYO_SEARCH_SKILL.name}`;
const MD = `${SKILL_DIR}/SKILL.md`;

/** Fake Obsidian App exposing the vault adapter surface the helper touches. */
function fakeApp(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const dirs = new Set<string>();
  const adapter = {
    exists: async (p: string) => files.has(p) || dirs.has(p),
    read: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    write: async (p: string, c: string) => {
      files.set(p, c);
    },
    mkdir: async (p: string) => {
      dirs.add(p);
    },
    rmdir: async (p: string) => {
      dirs.delete(p);
      for (const key of [...files.keys()]) {
        if (key === p || key.startsWith(`${p}/`)) files.delete(key);
      }
    },
  };
  const app = { vault: { adapter } } as unknown as App;
  return { app, adapter, files, dirs };
}

describe("installMiyoSearchSkill", () => {
  it("writes the skill and reports 'installed' on a fresh vault", async () => {
    const { app, files } = fakeApp();
    expect(await installMiyoSearchSkill(app, FOLDER)).toBe("installed");
    expect(files.get(MD)).toContain('copilot-builtin-version: "');
    // The OS wrapper scripts land next to SKILL.md.
    for (const file of MIYO_SEARCH_SKILL.files) {
      expect(files.has(`${SKILL_DIR}/${file.path}`)).toBe(true);
    }
  });

  it("reports 'installed' when the current version is already on disk (idempotent)", async () => {
    const { app } = fakeApp();
    await installMiyoSearchSkill(app, FOLDER);
    // A second run seeds nothing new but must still report success from disk
    // truth (the seed return value would be an empty array here).
    expect(await installMiyoSearchSkill(app, FOLDER)).toBe("installed");
  });

  it("reports 'collision' and preserves a user-authored same-named skill", async () => {
    const userContent = "---\nname: miyo-search\ndescription: mine\n---\ncustom body";
    const { app, files } = fakeApp({ [MD]: userContent });
    expect(await installMiyoSearchSkill(app, FOLDER)).toBe("collision");
    // Left untouched — never claim success over the user's file.
    expect(files.get(MD)).toBe(userContent);
  });

  it("reports 'failed' when the marker is current but a support script is missing", async () => {
    // A marked, current SKILL.md whose script write failed (the seeder swallows
    // the error): the marker alone would read as success, but the skill is broken.
    const { app, adapter } = fakeApp({ [MD]: MIYO_SEARCH_SKILL.skillMd });
    const realWrite = adapter.write;
    // Let SKILL.md re-write succeed but drop the script writes.
    adapter.write = async (p: string, c: string) => {
      if (p.endsWith(".sh") || p.endsWith(".cmd")) return;
      return realWrite(p, c);
    };
    expect(await installMiyoSearchSkill(app, FOLDER)).toBe("failed");
  });
});

describe("removeMiyoSearchSkill", () => {
  it("removes a seeded copy and reports 'removed'", async () => {
    const { app, files } = fakeApp();
    await installMiyoSearchSkill(app, FOLDER);
    expect(await removeMiyoSearchSkill(app, FOLDER)).toBe("removed");
    expect(files.has(MD)).toBe(false);
  });

  it("reports 'removed' when nothing is on disk (no-op)", async () => {
    const { app } = fakeApp();
    expect(await removeMiyoSearchSkill(app, FOLDER)).toBe("removed");
  });

  it("keeps a user-authored copy and reports 'collision'", async () => {
    const userContent = "---\nname: miyo-search\ndescription: mine\n---\ncustom body";
    const { app, files } = fakeApp({ [MD]: userContent });
    expect(await removeMiyoSearchSkill(app, FOLDER)).toBe("collision");
    expect(files.get(MD)).toBe(userContent);
  });

  it("reports 'failed' when the delete throws and the skill is still on disk", async () => {
    const { app, adapter, files } = fakeApp();
    await installMiyoSearchSkill(app, FOLDER);
    // The underlying rmdir fails; removeSeededBuiltin swallows it and returns
    // false, so we must classify from disk (still seeded → failed), not assume.
    adapter.rmdir = async () => {
      throw new Error("EPERM");
    };
    expect(await removeMiyoSearchSkill(app, FOLDER)).toBe("failed");
    expect(files.has(MD)).toBe(true);
  });
});
