import { App } from "obsidian";
import {
  ensureAgentsMirror,
  isGeneratedAgentsMirrorContent,
  MIRROR_MARKER_PREFIX,
  removeAgentsMirror,
} from "@/projects/ensureAgentsMirror";
import {
  BUILTIN_PROJECT_SYSTEM_PROMPT,
  composeProjectInstructions,
} from "@/projects/projectSystemPrompt";
import { ProjectFileRecord } from "@/projects/type";
import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "copilot-projects" })),
}));

jest.mock("@/projects/state", () => ({
  addPendingFileWrite: jest.fn(),
  removePendingFileWrite: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const FOLDER = "copilot-projects/Foo";
const MIRROR_PATH = `${FOLDER}/AGENTS.md`;

/**
 * Minimal in-memory vault: tracks on-disk content per path plus which paths the vault has
 * indexed as TFiles (vs. hidden-folder files only visible through the adapter).
 */
class FakeVault {
  files = new Map<string, string>();
  cached = new Set<string>();
  folders = new Set<string>([FOLDER]);

  // Spy hooks
  modify = jest.fn(async (file: { path: string }, content: string) => {
    this.files.set(file.path, content);
  });
  create = jest.fn(async (path: string, content: string) => {
    this.files.set(path, content);
    this.cached.add(path);
    return mockTFile({ path, name: path.split("/").pop(), extension: "md" });
  });
  trash = jest.fn(async (file: { path: string }) => {
    this.files.delete(file.path);
    this.cached.delete(file.path);
  });

  getAbstractFileByPath = (path: string) => {
    if (this.folders.has(path)) return mockTFolder({ name: path.split("/").pop(), children: [] });
    if (this.cached.has(path) && this.files.has(path)) {
      return mockTFile({ path, name: path.split("/").pop(), extension: "md" });
    }
    return null;
  };
  read = (file: { path: string }) => Promise.resolve(this.files.get(file.path) ?? "");

  adapter = {
    exists: jest.fn((path: string) => Promise.resolve(this.files.has(path))),
    read: jest.fn((path: string) => Promise.resolve(this.files.get(path) ?? "")),
    write: jest.fn(async (path: string, content: string) => {
      this.files.set(path, content);
    }),
    remove: jest.fn(async (path: string) => {
      this.files.delete(path);
    }),
  };

  /** Seed a file as already on disk and indexed by the vault cache. */
  seedCached(path: string, content: string) {
    this.files.set(path, content);
    this.cached.add(path);
  }
}

function makeApp(vault: FakeVault): App {
  return {
    vault,
    fileManager: { trashFile: (file: { path: string }) => vault.trash(file) },
  } as unknown as App;
}

function makeRecord(systemPrompt: string, extra?: Record<string, unknown>): ProjectFileRecord {
  return {
    project: {
      id: "p1",
      name: "Foo",
      systemPrompt,
      contextSource: {},
      ...extra,
    } as unknown as ProjectFileRecord["project"],
    filePath: `${FOLDER}/project.md`,
    folderName: "Foo",
  };
}

describe("ensureAgentsMirror", () => {
  it("generates a marker'd mirror whose payload is exactly the composed instructions", async () => {
    const vault = new FakeVault();
    await ensureAgentsMirror(makeApp(vault), makeRecord("Be concise."));

    const written = vault.files.get(MIRROR_PATH)!;
    expect(written).toBeDefined();
    // The whole file is one marker line + one blank line + the composed body, byte-exact.
    const [markerLine] = written.split("\n", 1);
    expect(markerLine.startsWith(MIRROR_MARKER_PREFIX)).toBe(true);
    expect(written).toBe(`${markerLine}\n\n${composeProjectInstructions("Be concise.")}`);
  });

  it("cheap-skips when the instruction body is unchanged (even if other config fields change)", async () => {
    const vault = new FakeVault();
    const app = makeApp(vault);
    await ensureAgentsMirror(app, makeRecord("Body A", { contextSource: { inclusions: "a/" } }));
    vault.modify.mockClear();
    vault.create.mockClear();
    vault.adapter.write.mockClear();

    // Same body, different context → must NOT rewrite the mirror.
    await ensureAgentsMirror(app, makeRecord("Body A", { contextSource: { inclusions: "b/" } }));
    expect(vault.modify).not.toHaveBeenCalled();
    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.adapter.write).not.toHaveBeenCalled();
  });

  it("rewrites the mirror when the instruction body changes", async () => {
    const vault = new FakeVault();
    const app = makeApp(vault);
    await ensureAgentsMirror(app, makeRecord("Body A"));
    await ensureAgentsMirror(app, makeRecord("Body B"));
    expect(vault.files.get(MIRROR_PATH)!.endsWith("Body B")).toBe(true);
  });

  it("NEVER overwrites a user-authored AGENTS.md with no marker", async () => {
    const vault = new FakeVault();
    const userContent = "# My own agents file\nHand written, no marker.";
    vault.seedCached(MIRROR_PATH, userContent);

    await ensureAgentsMirror(makeApp(vault), makeRecord("Plugin instructions"));

    expect(vault.files.get(MIRROR_PATH)).toBe(userContent);
    expect(vault.modify).not.toHaveBeenCalled();
  });

  it("keeps a marker'd mirror carrying the built-in policy when the user body becomes empty", async () => {
    const vault = new FakeVault();
    const app = makeApp(vault);
    await ensureAgentsMirror(app, makeRecord("Something"));
    expect(vault.files.get(MIRROR_PATH)).toContain("Something");

    // Emptying the user's project.md body no longer deletes the mirror: the composed body still
    // carries the built-in project policy, so the file is rewritten to that policy alone.
    await ensureAgentsMirror(app, makeRecord(""));
    const written = vault.files.get(MIRROR_PATH);
    expect(written).toContain(BUILTIN_PROJECT_SYSTEM_PROMPT);
    expect(written).not.toContain("Something");
  });

  it("leaves a no-marker user file untouched — so codex/opencode get no built-in layer there (known exception)", async () => {
    const vault = new FakeVault();
    vault.seedCached(MIRROR_PATH, "user file, no marker");
    // A user who removed the marker owns the file; we never overwrite it. The trade-off is that
    // this project's codex/opencode sessions don't receive the built-in policy via the mirror
    // (Claude still does, via getProjectProfile). Intentional — it matches AGENTS.md precedence,
    // where user/local content wins.
    await ensureAgentsMirror(makeApp(vault), makeRecord("anything"));
    expect(vault.files.get(MIRROR_PATH)).toBe("user file, no marker");
  });
});

describe("removeAgentsMirror", () => {
  it("deletes only a marker'd mirror", async () => {
    const vault = new FakeVault();
    const app = makeApp(vault);
    await ensureAgentsMirror(app, makeRecord("body"));
    expect(vault.files.has(MIRROR_PATH)).toBe(true);

    await removeAgentsMirror(app, makeRecord("body"));
    expect(vault.files.has(MIRROR_PATH)).toBe(false);
  });

  it("leaves a user-authored AGENTS.md (no marker) untouched", async () => {
    const vault = new FakeVault();
    vault.seedCached(MIRROR_PATH, "user content");
    await removeAgentsMirror(makeApp(vault), makeRecord("body"));
    expect(vault.files.get(MIRROR_PATH)).toBe("user content");
  });
});

describe("isGeneratedAgentsMirrorContent", () => {
  it("is true for content carrying the generated marker envelope", async () => {
    // Build a real mirror via ensureAgentsMirror so the marker matches exactly.
    const vault = new FakeVault();
    await ensureAgentsMirror(makeApp(vault), makeRecord("Be concise."));
    const generated = vault.files.get(MIRROR_PATH)!;
    expect(isGeneratedAgentsMirrorContent(generated)).toBe(true);
  });

  it("is false for a user-authored file and for empty content", () => {
    expect(isGeneratedAgentsMirrorContent("# My own agents file\nno marker")).toBe(false);
    expect(isGeneratedAgentsMirrorContent("")).toBe(false);
  });
});

describe("marker prefix recognition", () => {
  // An older/alternate marker wording that still shares the stable machine prefix and a
  // well-formed envelope — recognition must accept it (the whole point of keying off the prefix
  // rather than the full line, so the human-facing tail can evolve without orphaning files).
  const oldTail = `${MIRROR_MARKER_PREFIX} v1 — DO NOT EDIT. Older wording. -->`;

  const BOM = String.fromCharCode(0xfeff); // U+FEFF byte-order mark

  it("recognizes an older marker wording sharing the stable prefix (LF, CRLF, BOM)", () => {
    expect(isGeneratedAgentsMirrorContent(`${oldTail}\n\nbody`)).toBe(true);
    expect(isGeneratedAgentsMirrorContent(`${oldTail}\r\n\r\nbody`)).toBe(true);
    expect(isGeneratedAgentsMirrorContent(`${BOM}${oldTail}\n\nbody`)).toBe(true);
  });

  it("rejects malformed or look-alike first lines (treated as user files)", () => {
    // No blank line between marker and body.
    expect(isGeneratedAgentsMirrorContent(`${oldTail}\nbody`)).toBe(false);
    // Mixed newline styles across the envelope (only consistent `\n\n` / `\r\n\r\n` is ours).
    expect(isGeneratedAgentsMirrorContent(`${oldTail}\r\n\nbody`)).toBe(false);
    expect(isGeneratedAgentsMirrorContent(`${oldTail}\n\r\nbody`)).toBe(false);
    // First line never closes the HTML comment.
    expect(isGeneratedAgentsMirrorContent(`${MIRROR_MARKER_PREFIX} v1 unterminated\n\nbody`)).toBe(
      false
    );
    // Prefix with no space boundary (e.g. `…generated-agents-mirrorish`).
    expect(isGeneratedAgentsMirrorContent(`${MIRROR_MARKER_PREFIX}ish v1 -->\n\nbody`)).toBe(false);
  });
});
